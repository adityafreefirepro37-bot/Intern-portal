import 'server-only'
import type { KnowledgeCategory, KnowledgeVisibility, Prisma } from '@prisma/client'
import { z } from 'zod'
import { chunkDocument, embeddingText, normalizeText, type SourceSection } from '@/lib/ai/chunk'
import { prisma } from '@/lib/db/client'
import { NotFoundError, ValidationError } from '@/lib/errors'
import { parseDateOnly } from '@/lib/interns/dates'
import { logger } from '@/lib/logging'
import { getStorageService } from '@/lib/storage'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from '../services/audit-actions'
import { auditService } from '../services/audit.service'
import { authorizationService } from '../services/authorization.service'
import { optionalText, optionalUuid } from '../services/hr-shared'
import { rateLimitService } from '../services/rate-limit.service'
import { extractSections, KNOWLEDGE_MIME_TYPES, sectionsToText } from './extract'
import { AIProviderError, getAIProvider } from './provider'
import { aiSettingsService } from './settings.service'

/**
 * AYAVA knowledge base: documents, versions, processing and retrieval.
 *
 * Visibility is enforced in the database query that selects candidate
 * documents, BEFORE any chunk is scored or sent to a model:
 *
 *   ORGANIZATION  everyone with knowledge.read
 *   DEPARTMENT    interns placed in it, its head, leads of its teams
 *   TEAM          interns placed in it and its lead
 *   ROLE          holders of that role
 *   PROJECT       the project's owner, manager and members
 *   PRIVATE       the uploader
 *
 * knowledge.manage holders see every document (they administer the base).
 * Only the current, READY version of a document is retrieved.
 */

export const KNOWLEDGE_CATEGORIES = [
  'HR', 'ONBOARDING', 'POLICIES', 'SOP', 'SECURITY', 'BRAND', 'MARKETING', 'ENGINEERING', 'DESIGN', 'LEARNING', 'PROJECT', 'GENERAL',
] as const satisfies readonly KnowledgeCategory[]
export const KNOWLEDGE_VISIBILITIES = ['ORGANIZATION', 'DEPARTMENT', 'TEAM', 'ROLE', 'PROJECT', 'PRIVATE'] as const satisfies readonly KnowledgeVisibility[]

const metadataSchema = z.strictObject({
  title: z.string().trim().min(2, 'Enter a title').max(200),
  description: optionalText(1000),
  category: z.enum(KNOWLEDGE_CATEGORIES).default('GENERAL'),
  visibility: z.enum(KNOWLEDGE_VISIBILITIES).default('ORGANIZATION'),
  departmentId: optionalUuid,
  teamId: optionalUuid,
  roleId: optionalUuid,
  projectId: optionalUuid,
  effectiveDate: isoDateSchema.optional().or(z.literal('').transform(() => undefined)),
})

const textSchema = z.string().trim().min(20, 'Enter at least a few sentences').max(500_000)

export interface KnowledgeFile {
  name: string
  type: string
  bytes: Uint8Array
}

export interface RetrievedChunk {
  n: number
  chunkId: string
  documentId: string
  title: string
  version: number
  category: KnowledgeCategory
  heading: string | null
  page: number | null
  content: string
  effectiveDate: string | null
  updatedAt: string
  href: string
  score: number
}

const EXTENSION_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
}

/** Browsers often send "" or octet-stream for .md / .html; trust the extension then (storage re-validates). */
function mimeFor(file: KnowledgeFile) {
  const ext = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
  const declared = file.type.toLowerCase().split(';')[0].trim()
  if (declared && declared in KNOWLEDGE_MIME_TYPES) return declared
  return EXTENSION_TYPES[ext] ?? declared
}

const STOP = new Set(
  'a an and are as at be by can do does for from has have how i in is it its me my of on or our should the this to was what when where which who why will with you your about into than then there these those'.split(' '),
)

/** Words that describe the kind of document rather than its subject; they can't be the only match. */
const GENERIC = new Set(
  'policy policies document documents doc docs guideline guidelines rule rules procedure procedures process handbook sop find show tell company ayava please need know'.split(' '),
)

/**
 * OR-query of the question's subject words (alphanumeric only — safe for
 * to_tsquery). "leave policy" searches for "leave": otherwise every policy would
 * match "policy on flying zeppelins" and an unanswerable question would look answered.
 */
export function keywordQuery(question: string): string | null {
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])].filter((w) => !STOP.has(w))
  const subject = words.filter((w) => !GENERIC.has(w))
  const chosen = (subject.length ? subject : words).slice(0, 12)
  return chosen.length ? chosen.join(' | ') : null
}

/** Departments, teams, roles and projects that make documents visible to this user. */
async function audienceFacts(ctx: RequestContext) {
  const me = ctx.actor.userId
  const [placement, ledTeams, projects] = await Promise.all([
    prisma.intern.findFirst({
      where: { organization_id: ctx.organization.id, user_id: me, deleted_at: null },
      select: { department_id: true, team_id: true },
    }),
    ctx.actor.ledTeamIds.length
      ? prisma.team.findMany({ where: { id: { in: [...ctx.actor.ledTeamIds] } }, select: { department_id: true } })
      : Promise.resolve([]),
    prisma.project.findMany({
      where: {
        organization_id: ctx.organization.id,
        deleted_at: null,
        OR: [{ owner_id: me }, { manager_id: me }, { members: { some: { user_id: me } } }],
      },
      select: { id: true },
      take: 500,
    }),
  ])
  const departments = new Set<string>([...ctx.actor.headedDepartmentIds])
  if (placement?.department_id) departments.add(placement.department_id)
  for (const team of ledTeams) if (team.department_id) departments.add(team.department_id)
  const teams = new Set<string>([...ctx.actor.ledTeamIds])
  if (placement?.team_id) teams.add(placement.team_id)
  return {
    departments: [...departments],
    teams: [...teams],
    roles: ctx.actor.roles.map((r) => r.id),
    projects: projects.map((p) => p.id),
  }
}

export const knowledgeService = {
  /** Documents this user may read (null = no knowledge access). Applied before retrieval. */
  async visibleWhere(ctx: RequestContext): Promise<Prisma.KnowledgeDocumentWhereInput | null> {
    if (!authorizationService.can(ctx, 'knowledge.read')) return null
    const base: Prisma.KnowledgeDocumentWhereInput = { organization_id: ctx.organization.id }
    if (authorizationService.can(ctx, 'knowledge.manage')) return base
    const facts = await audienceFacts(ctx)
    return {
      ...base,
      OR: [
        { visibility: 'ORGANIZATION' },
        { visibility: 'PRIVATE', uploaded_by: ctx.actor.userId },
        ...(facts.departments.length ? [{ visibility: 'DEPARTMENT' as const, department_id: { in: facts.departments } }] : []),
        ...(facts.teams.length ? [{ visibility: 'TEAM' as const, team_id: { in: facts.teams } }] : []),
        ...(facts.roles.length ? [{ visibility: 'ROLE' as const, role_id: { in: facts.roles } }] : []),
        ...(facts.projects.length ? [{ visibility: 'PROJECT' as const, project_id: { in: facts.projects } }] : []),
      ],
    }
  },

  /**
   * Hybrid retrieval over visible, current, READY documents: semantic (cosine
   * over embeddings) and keyword (full text) rankings fused with reciprocal
   * rank fusion. Returns at most `limit` chunks, numbered for citation.
   */
  async retrieve(
    ctx: RequestContext,
    question: string,
    options: { limit?: number; documentId?: string; signal?: AbortSignal } = {},
  ): Promise<{ chunks: RetrievedChunk[]; usage?: { model: string; tokens: number } }> {
    const visible = await this.visibleWhere(ctx)
    if (!visible) return { chunks: [] }
    const limit = options.limit ?? 6
    const allowed = await prisma.knowledgeDocument.findMany({
      where: {
        AND: [
          visible,
          { is_current: true, status: 'READY', archived_at: null },
          ...(options.documentId ? [{ id: options.documentId }] : []),
        ],
      },
      select: { id: true },
      orderBy: { updated_at: 'desc' },
      take: 2000,
    })
    if (!allowed.length) return { chunks: [] }
    const ids = allowed.map((d) => d.id)
    const org = ctx.organization.id

    const provider = getAIProvider()
    let semantic: { id: string; score: number }[] = []
    let usage: { model: string; tokens: number } | undefined
    if (provider?.embeddingModel) {
      try {
        const { vectors, model, usage: u } = await provider.embed([question.slice(0, 2000)], 'query', options.signal)
        usage = { model, tokens: u.input }
        semantic = await prisma.$queryRaw<{ id: string; score: number }[]>`
          SELECT id, ayava_cosine_similarity(embedding, ${vectors[0]}::real[]) AS score
          FROM knowledge_chunks
          WHERE organization_id = ${org}::uuid AND document_id = ANY(${ids}::uuid[]) AND embedding_model = ${model}
          ORDER BY score DESC NULLS LAST
          LIMIT 20`
        // Below this, a passage is rarely about the question: better "not found" than a weak citation.
        semantic = semantic.filter((row) => row.score !== null && row.score >= 0.35)
      } catch (error) {
        // Keyword search still answers when the embedding call fails.
        logger.warn('Knowledge semantic search failed; using keyword search', {
          code: error instanceof AIProviderError ? error.code : 'UNKNOWN',
        })
      }
    }
    const tsq = keywordQuery(question)
    const keyword = tsq
      ? await prisma.$queryRaw<{ id: string; score: number }[]>`
          SELECT id, ts_rank_cd(search, to_tsquery('english', ${tsq})) AS score
          FROM knowledge_chunks
          WHERE organization_id = ${org}::uuid AND document_id = ANY(${ids}::uuid[])
            AND search @@ to_tsquery('english', ${tsq})
          ORDER BY score DESC
          LIMIT 20`
      : []

    // Reciprocal rank fusion: robust to the two scores' different scales.
    const fused = new Map<string, number>()
    semantic.forEach((row, rank) => fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (60 + rank)))
    keyword.forEach((row, rank) => fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (60 + rank)))
    if (!fused.size) return { chunks: [], usage }
    const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)

    const rows = await prisma.knowledgeChunk.findMany({
      where: { id: { in: ranked.map(([id]) => id) }, organization_id: org },
      select: {
        id: true,
        heading: true,
        page: true,
        content: true,
        document: {
          select: { id: true, title: true, version: true, category: true, effective_date: true, updated_at: true },
        },
      },
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    const perDocument = new Map<string, number>()
    const chunks: RetrievedChunk[] = []
    for (const [id, score] of ranked) {
      const row = byId.get(id)
      if (!row) continue
      // Diversity: at most three chunks from one document.
      const count = perDocument.get(row.document.id) ?? 0
      if (count >= 3) continue
      perDocument.set(row.document.id, count + 1)
      chunks.push({
        n: chunks.length + 1,
        chunkId: row.id,
        documentId: row.document.id,
        title: row.document.title,
        version: row.document.version,
        category: row.document.category,
        heading: row.heading,
        page: row.page,
        content: row.content,
        effectiveDate: row.document.effective_date?.toISOString().slice(0, 10) ?? null,
        updatedAt: row.document.updated_at.toISOString().slice(0, 10),
        href: `/knowledge/${row.document.id}`,
        score,
      })
      if (chunks.length >= limit) break
    }
    return { chunks, usage }
  },

  /** The knowledge library: visible documents (current versions) with filters. */
  async list(ctx: RequestContext, query: { q?: string; category?: string; departmentId?: string; type?: string; visibility?: string; status?: string; updatedSince?: string }) {
    const visible = await this.visibleWhere(ctx)
    if (!visible) return null
    const manage = authorizationService.can(ctx, 'knowledge.manage')
    const category = KNOWLEDGE_CATEGORIES.find((c) => c === query.category)
    const visibility = KNOWLEDGE_VISIBILITIES.find((v) => v === query.visibility)
    const since = query.updatedSince && /^\d{4}-\d{2}-\d{2}$/.test(query.updatedSince) ? parseDateOnly(query.updatedSince) : undefined
    const term = query.q?.trim().slice(0, 200)
    let matchingIds: string[] | undefined
    if (term) {
      const tsq = keywordQuery(term)
      const hits = tsq
        ? await prisma.$queryRaw<{ document_id: string }[]>`
            SELECT DISTINCT document_id FROM knowledge_chunks
            WHERE organization_id = ${ctx.organization.id}::uuid AND search @@ to_tsquery('english', ${tsq})
            LIMIT 500`
        : []
      matchingIds = hits.map((h) => h.document_id)
    }
    const statusFilter: Prisma.KnowledgeDocumentWhereInput = manage
      ? query.status === 'ARCHIVED'
        ? { archived_at: { not: null } }
        : { archived_at: null }
      : { status: 'READY', archived_at: null }
    return prisma.knowledgeDocument.findMany({
      where: {
        AND: [
          visible,
          statusFilter,
          { is_current: true },
          ...(category ? [{ category }] : []),
          ...(visibility && manage ? [{ visibility }] : []),
          ...(query.departmentId && /^[0-9a-f-]{36}$/.test(query.departmentId) ? [{ department_id: query.departmentId }] : []),
          ...(query.type === 'TEXT' ? [{ source_type: 'TEXT' as const }] : []),
          ...(query.type && query.type in KNOWLEDGE_MIME_TYPES ? [{ mime_type: query.type }] : []),
          ...(since ? [{ updated_at: { gte: since } }] : []),
          ...(term
            ? [
                {
                  OR: [
                    { title: { contains: term, mode: 'insensitive' as const } },
                    { description: { contains: term, mode: 'insensitive' as const } },
                    ...(matchingIds?.length ? [{ id: { in: matchingIds } }] : []),
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 200,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        visibility: true,
        status: true,
        version: true,
        source_type: true,
        mime_type: true,
        file_name: true,
        chunk_count: true,
        error_message: true,
        effective_date: true,
        updated_at: true,
        archived_at: true,
        department: { select: { name: true } },
        team: { select: { name: true } },
        role: { select: { name: true } },
        project: { select: { name: true } },
      },
    })
  },

  /** One document the user may read (any version for managers; current READY for others). */
  async get(ctx: RequestContext, documentId: string) {
    const id = parseInput(z.uuid(), documentId)
    const visible = await this.visibleWhere(ctx)
    if (!visible) throw new NotFoundError('Document')
    const manage = authorizationService.can(ctx, 'knowledge.manage')
    const document = await prisma.knowledgeDocument.findFirst({
      where: { AND: [visible, { id }, ...(manage ? [] : [{ status: 'READY' as const, archived_at: null }])] },
      include: {
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        uploader: { select: { first_name: true, last_name: true, display_name: true } },
        updater: { select: { first_name: true, last_name: true, display_name: true } },
      },
    })
    if (!document) throw new NotFoundError('Document')
    const versions = await prisma.knowledgeDocument.findMany({
      where: { family_id: document.family_id, organization_id: ctx.organization.id, ...(manage ? {} : { is_current: true }) },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, is_current: true, created_at: true, file_name: true },
    })
    return { document, versions, can: { manage } }
  },

  /** Original file bytes for a document the user may read (served as a download). */
  async file(ctx: RequestContext, documentId: string) {
    const { document } = await this.get(ctx, documentId)
    if (!document.storage_path || !document.mime_type) throw new NotFoundError('File')
    const bytes = await getStorageService().download(document.storage_path)
    return { bytes, fileName: document.file_name ?? 'document', mimeType: document.mime_type }
  },

  /** Choices for the document form (organization-scoped). */
  async formOptions(ctx: RequestContext) {
    authorizationService.require(ctx, 'knowledge.manage')
    const org = ctx.organization.id
    const [departments, teams, roles, projects] = await Promise.all([
      prisma.department.findMany({ where: { organization_id: org, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.team.findMany({ where: { organization_id: org, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.role.findMany({ where: { organization_id: org }, orderBy: { rank: 'desc' }, select: { id: true, name: true } }),
      prisma.project.findMany({ where: { organization_id: org, deleted_at: null }, orderBy: { name: 'asc' }, select: { id: true, name: true }, take: 300 }),
    ])
    return { departments, teams, roles, projects }
  },

  /** Validates metadata and that the audience record belongs to this organization. */
  async metadata(ctx: RequestContext, input: unknown) {
    const data = parseInput(metadataSchema, input)
    const org = ctx.organization.id
    const need = {
      DEPARTMENT: ['departmentId', () => prisma.department.count({ where: { id: data.departmentId, organization_id: org } })],
      TEAM: ['teamId', () => prisma.team.count({ where: { id: data.teamId, organization_id: org } })],
      ROLE: ['roleId', () => prisma.role.count({ where: { id: data.roleId, organization_id: org } })],
      PROJECT: ['projectId', () => prisma.project.count({ where: { id: data.projectId, organization_id: org, deleted_at: null } })],
    } as const
    const rule = need[data.visibility as keyof typeof need]
    if (rule) {
      const [field, check] = rule
      if (!data[field] || !(await check())) {
        throw new ValidationError(`Choose the ${field.replace('Id', '')} who may see this document`, { [field]: 'Required for this visibility' })
      }
    }
    return {
      title: data.title,
      description: data.description ?? null,
      category: data.category,
      visibility: data.visibility,
      department_id: data.visibility === 'DEPARTMENT' ? data.departmentId! : null,
      team_id: data.visibility === 'TEAM' ? data.teamId! : null,
      role_id: data.visibility === 'ROLE' ? data.roleId! : null,
      project_id: data.visibility === 'PROJECT' ? data.projectId! : null,
      effective_date: data.effectiveDate ? parseDateOnly(data.effectiveDate) : null,
    }
  },

  /** Adds a document (file or typed text). Processing runs separately (see process). */
  async create(ctx: RequestContext, input: Record<string, string>, file?: KnowledgeFile) {
    authorizationService.require(ctx, 'knowledge.manage')
    await rateLimitService.consume('aiIngest', ctx.actor.userId)
    const meta = await this.metadata(ctx, {
      title: input.title,
      description: input.description,
      category: input.category,
      visibility: input.visibility,
      departmentId: input.departmentId,
      teamId: input.teamId,
      roleId: input.roleId,
      projectId: input.projectId,
      effectiveDate: input.effectiveDate,
    })
    const source = await this.storeSource(ctx, input.text, file)
    const document = await prisma.knowledgeDocument.create({
      data: { ...meta, ...source, organization_id: ctx.organization.id, uploaded_by: ctx.actor.userId, updated_by: ctx.actor.userId },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.KNOWLEDGE_DOCUMENT_ADDED,
      resourceType: 'knowledge_document',
      resourceId: document.id,
      metadata: { title: meta.title, visibility: meta.visibility, category: meta.category, source: source.source_type },
    })
    return document
  },

  /** A new version of an existing document; it becomes current only once processed. */
  async addVersion(ctx: RequestContext, documentId: string, input: Record<string, string>, file?: KnowledgeFile) {
    authorizationService.require(ctx, 'knowledge.manage')
    await rateLimitService.consume('aiIngest', ctx.actor.userId)
    const previous = await this.managed(ctx, documentId)
    const latest = await prisma.knowledgeDocument.findFirst({
      where: { family_id: previous.family_id },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const source = await this.storeSource(ctx, input.text, file)
    const document = await prisma.knowledgeDocument.create({
      data: {
        ...source,
        organization_id: ctx.organization.id,
        family_id: previous.family_id,
        version: (latest?.version ?? previous.version) + 1,
        is_current: false,
        title: previous.title,
        description: input.changeNote?.trim() ? input.changeNote.trim().slice(0, 1000) : previous.description,
        category: previous.category,
        visibility: previous.visibility,
        department_id: previous.department_id,
        team_id: previous.team_id,
        role_id: previous.role_id,
        project_id: previous.project_id,
        effective_date: input.effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate) ? parseDateOnly(input.effectiveDate) : previous.effective_date,
        uploaded_by: ctx.actor.userId,
        updated_by: ctx.actor.userId,
      },
      select: { id: true, version: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_ADDED,
      resourceType: 'knowledge_document',
      resourceId: document.id,
      metadata: { familyId: previous.family_id, version: document.version, previousId: previous.id },
    })
    return document
  },

  async storeSource(ctx: RequestContext, text: string | undefined, file?: KnowledgeFile) {
    if (file && file.bytes.byteLength > 0) {
      const mimeType = mimeFor(file)
      if (!(mimeType in KNOWLEDGE_MIME_TYPES)) {
        throw new ValidationError('Upload a PDF, Word (.docx), text, Markdown or HTML file', { file: 'Unsupported file type' })
      }
      const stored = await getStorageService().upload({
        organizationId: ctx.organization.id,
        category: 'knowledge',
        fileName: file.name,
        mimeType,
        data: file.bytes,
      })
      return {
        source_type: 'UPLOAD' as const,
        file_name: stored.fileName,
        storage_path: stored.storagePath,
        mime_type: stored.mimeType,
        file_size: stored.fileSize,
        content: null,
        status: 'PENDING' as const,
      }
    }
    if (text?.trim()) {
      return {
        source_type: 'TEXT' as const,
        content: normalizeText(parseInput(textSchema, text)),
        file_name: null,
        storage_path: null,
        mime_type: null,
        file_size: null,
        status: 'PENDING' as const,
      }
    }
    throw new ValidationError('Upload a file or paste the document text', { file: 'Choose a file or enter text' })
  },

  async managed(ctx: RequestContext, documentId: string) {
    authorizationService.require(ctx, 'knowledge.manage')
    const id = parseInput(z.uuid(), documentId)
    const document = await prisma.knowledgeDocument.findFirst({ where: { id, organization_id: ctx.organization.id } })
    if (!document) throw new NotFoundError('Document')
    return document
  },

  /**
   * Extract → normalize → chunk → embed → store. Marks the document READY (or
   * FAILED with a readable error). Without an embedding model the document is
   * still searchable by keyword.
   */
  async process(ctx: RequestContext, documentId: string) {
    const document = await this.managed(ctx, documentId)
    if (document.status === 'ARCHIVED' || document.archived_at) return { status: 'ARCHIVED' as const }
    const started = Date.now()
    await prisma.knowledgeDocument.update({ where: { id: document.id }, data: { status: 'PROCESSING', error_message: null } })
    try {
      let sections: SourceSection[]
      let content: string
      if (document.source_type === 'UPLOAD') {
        if (!document.storage_path || !document.mime_type) throw new ValidationError('The file for this document is missing')
        const bytes = await getStorageService().download(document.storage_path)
        sections = await extractSections(bytes, document.mime_type)
        content = sectionsToText(sections)
      } else {
        content = normalizeText(document.content ?? '')
        sections = [{ text: content }]
      }
      const chunks = chunkDocument(sections)
      if (!chunks.length) throw new ValidationError('No text found in this document')

      const provider = getAIProvider()
      let vectors: number[][] | null = null
      let embeddingModel: string | null = null
      let warning: string | null = null
      if (provider?.embeddingModel) {
        try {
          vectors = []
          let tokens = 0
          for (let i = 0; i < chunks.length; i += 16) {
            const batch = chunks.slice(i, i + 16).map((c) => embeddingText(c, document.title))
            const result = await provider.embed(batch, 'passage')
            vectors.push(...result.vectors)
            tokens += result.usage.input
            embeddingModel = result.model
          }
          await aiSettingsService.record(ctx, {
            feature: 'EMBEDDING',
            provider: provider.name,
            model: embeddingModel,
            tokensInput: tokens,
            latencyMs: Date.now() - started,
            success: true,
          })
        } catch (error) {
          vectors = null
          embeddingModel = null
          warning = 'Semantic index unavailable (the embedding service failed); keyword search still works. Reprocess to retry.'
          const code = error instanceof AIProviderError ? error.code : 'UNKNOWN'
          logger.warn('Knowledge embedding failed', { documentId: document.id, code })
          await aiSettingsService.record(ctx, { feature: 'EMBEDDING', provider: provider.name, success: false, errorCode: code })
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.knowledgeChunk.deleteMany({ where: { document_id: document.id } })
        await tx.knowledgeChunk.createMany({
          data: chunks.map((chunk, i) => ({
            organization_id: document.organization_id,
            document_id: document.id,
            chunk_index: chunk.index,
            heading: chunk.heading,
            page: chunk.page,
            content: chunk.content,
            token_count: chunk.tokenCount,
            embedding: vectors?.[i] ?? [],
            embedding_model: vectors ? embeddingModel : null,
          })),
        })
        await tx.knowledgeDocument.update({
          where: { id: document.id },
          data: {
            status: 'READY',
            content,
            chunk_count: chunks.length,
            embedding_model: embeddingModel,
            processed_at: new Date(),
            error_message: warning,
          },
        })
        // A processed new version replaces the current one; older versions stay as history.
        if (!document.is_current) {
          await tx.knowledgeDocument.updateMany({
            where: { family_id: document.family_id, id: { not: document.id } },
            data: { is_current: false },
          })
          await tx.knowledgeDocument.update({ where: { id: document.id }, data: { is_current: true } })
        }
      })
      await aiSettingsService.record(ctx, { feature: 'INGESTION', latencyMs: Date.now() - started, success: true })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.KNOWLEDGE_DOCUMENT_PROCESSED,
        resourceType: 'knowledge_document',
        resourceId: document.id,
        metadata: { chunks: chunks.length, semantic: Boolean(vectors), ms: Date.now() - started },
      })
      return { status: 'READY' as const, chunks: chunks.length, semantic: Boolean(vectors), warning }
    } catch (error) {
      const message =
        error instanceof ValidationError ? error.message : 'Processing failed. Check the file and try again.'
      logger.error('Knowledge processing failed', { documentId: document.id, error })
      await prisma.knowledgeDocument.update({ where: { id: document.id }, data: { status: 'FAILED', error_message: message } })
      await aiSettingsService.record(ctx, { feature: 'INGESTION', latencyMs: Date.now() - started, success: false, errorCode: 'PROCESSING_FAILED' })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.KNOWLEDGE_DOCUMENT_PROCESSED,
        resourceType: 'knowledge_document',
        resourceId: document.id,
        status: 'FAILURE',
        metadata: { error: message },
      })
      return { status: 'FAILED' as const, error: message }
    }
  },

  async reprocess(ctx: RequestContext, documentId: string) {
    await rateLimitService.consume('aiIngest', ctx.actor.userId)
    return this.process(ctx, documentId)
  },

  async updateMetadata(ctx: RequestContext, documentId: string, input: unknown) {
    const document = await this.managed(ctx, documentId)
    const meta = await this.metadata(ctx, input)
    // Audience and labels apply to every version of the document.
    await prisma.knowledgeDocument.updateMany({
      where: { family_id: document.family_id, organization_id: ctx.organization.id },
      data: { ...meta, updated_by: ctx.actor.userId },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.KNOWLEDGE_DOCUMENT_UPDATED,
      resourceType: 'knowledge_document',
      resourceId: document.id,
      metadata: {
        before: { title: document.title, visibility: document.visibility, category: document.category },
        after: { title: meta.title, visibility: meta.visibility, category: meta.category },
      },
    })
  },

  async setArchived(ctx: RequestContext, documentId: string, archived: boolean) {
    const document = await this.managed(ctx, documentId)
    await prisma.knowledgeDocument.updateMany({
      where: { family_id: document.family_id, organization_id: ctx.organization.id },
      data: { archived_at: archived ? new Date() : null, updated_by: ctx.actor.userId },
    })
    await auditService.logForContext(ctx, {
      action: archived ? AUDIT_ACTIONS.KNOWLEDGE_DOCUMENT_ARCHIVED : AUDIT_ACTIONS.KNOWLEDGE_DOCUMENT_RESTORED,
      resourceType: 'knowledge_document',
      resourceId: document.id,
      metadata: { title: document.title },
    })
  },

  /** Deletes a document with all its versions, chunks and files. */
  async remove(ctx: RequestContext, documentId: string) {
    const document = await this.managed(ctx, documentId)
    const versions = await prisma.knowledgeDocument.findMany({
      where: { family_id: document.family_id, organization_id: ctx.organization.id },
      select: { id: true, storage_path: true },
    })
    await prisma.knowledgeDocument.deleteMany({ where: { id: { in: versions.map((v) => v.id) } } })
    const storage = getStorageService()
    for (const version of versions) {
      if (version.storage_path) {
        await storage.delete(version.storage_path).catch((error: unknown) => logger.warn('Could not delete knowledge file', { error }))
      }
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.KNOWLEDGE_DOCUMENT_DELETED,
      resourceType: 'knowledge_document',
      resourceId: document.id,
      metadata: { title: document.title, versions: versions.length },
    })
  },
}
