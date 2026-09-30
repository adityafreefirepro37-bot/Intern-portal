import type { Prisma, WorkMode } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { DEFAULT_ATTENDANCE_RULES, type AttendanceRules } from '@/lib/hr/attendance'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'

/**
 * Organization settings (non-secret, JSON values in the `settings` table).
 * Typed getters with defaults so features work before an admin configures them.
 */
async function read(organizationId: string, key: string): Promise<unknown> {
  const row = await prisma.setting.findUnique({
    where: { organization_id_key: { organization_id: organizationId, key } },
    select: { value: true },
  })
  return row?.value
}

export const SETTING_KEYS = {
  endingSoonDays: 'internship.ending_soon_days',
  employeeCodePrefix: 'intern.employee_code_prefix',
  defaultWorkMode: 'internship.default_work_mode',
  attendanceRules: 'attendance.rules',
  leavePolicy: 'leave.policy',
  documentExpiryWarningDays: 'documents.expiry_warning_days',
  offboardingItems: 'offboarding.default_items',
} as const

export interface LeavePolicy {
  /** How many days back a leave request may start (e.g. sick leave reported late). */
  backdateDays: number
  /** Longest single request, in calendar days. */
  maxRequestDays: number
}

export const DEFAULT_LEAVE_POLICY: LeavePolicy = { backdateDays: 7, maxRequestDays: 30 }

export const DEFAULT_OFFBOARDING_ITEMS = [
  'Confirm final task handover',
  'Collect exit feedback',
  'Return company equipment and revoke access',
  'Prepare experience letter',
  'Issue completion certificate',
]

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)')
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max)

const attendanceRulesSchema = z
  .object({
    workStart: clock,
    graceMinutes: int(0, 180),
    fullDayMinutes: int(60, 960),
    halfDayMinutes: int(30, 720),
    workingDays: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'Choose at least one working day').max(7),
  })
  .refine((rules) => rules.halfDayMinutes < rules.fullDayMinutes, {
    message: 'A half day must be shorter than a full day',
    path: ['halfDayMinutes'],
  })

const leavePolicySchema = z.object({ backdateDays: int(0, 60), maxRequestDays: int(1, 180) })

/** Validated read with fallback: a malformed stored value never breaks a page. */
function readAs<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value)
  return result.success ? result.data : fallback
}

// Parsers turn stored JSON into typed values, falling back to defaults.
const parse = {
  endingSoonDays(value: unknown): number {
    const days = Number((value as { days?: unknown } | undefined)?.days)
    return Number.isInteger(days) && days >= 1 && days <= 90 ? days : 14
  },
  defaultWorkMode(value: unknown): WorkMode {
    const mode = (value as { mode?: unknown } | undefined)?.mode
    return mode === 'HYBRID' || mode === 'ONSITE' ? mode : 'REMOTE'
  },
  attendanceRules(value: unknown): AttendanceRules {
    return readAs(attendanceRulesSchema, value, { ...DEFAULT_ATTENDANCE_RULES })
  },
  leavePolicy(value: unknown): LeavePolicy {
    return readAs(leavePolicySchema, value, DEFAULT_LEAVE_POLICY)
  },
  documentExpiryWarningDays(value: unknown): number {
    const days = Number((value as { days?: unknown } | undefined)?.days)
    return Number.isInteger(days) && days >= 1 && days <= 180 ? days : 30
  },
  offboardingItems(value: unknown): string[] {
    const raw = (value as { items?: unknown } | undefined)?.items
    const items = Array.isArray(raw) ? raw.filter((i): i is string => typeof i === 'string') : []
    return items.length ? items : DEFAULT_OFFBOARDING_ITEMS
  },
}

export const settingsService = {
  /** Days before the expected end date when an internship becomes ENDING_SOON (default 14). */
  async endingSoonDays(organizationId: string): Promise<number> {
    return parse.endingSoonDays(await read(organizationId, SETTING_KEYS.endingSoonDays))
  },

  /** Prefix for generated intern employee codes (default AYV-INT-). */
  async employeeCodePrefix(organizationId: string): Promise<string> {
    const value = (await read(organizationId, SETTING_KEYS.employeeCodePrefix)) as { prefix?: unknown } | undefined
    const prefix = typeof value?.prefix === 'string' ? value.prefix : ''
    return /^[A-Z0-9-]{1,16}$/.test(prefix) ? prefix : 'AYV-INT-'
  },

  async defaultWorkMode(organizationId: string): Promise<WorkMode> {
    return parse.defaultWorkMode(await read(organizationId, SETTING_KEYS.defaultWorkMode))
  },

  async attendanceRules(organizationId: string): Promise<AttendanceRules> {
    return parse.attendanceRules(await read(organizationId, SETTING_KEYS.attendanceRules))
  },

  async leavePolicy(organizationId: string): Promise<LeavePolicy> {
    return parse.leavePolicy(await read(organizationId, SETTING_KEYS.leavePolicy))
  },

  async documentExpiryWarningDays(organizationId: string): Promise<number> {
    return parse.documentExpiryWarningDays(await read(organizationId, SETTING_KEYS.documentExpiryWarningDays))
  },

  async offboardingItems(organizationId: string): Promise<string[]> {
    return parse.offboardingItems(await read(organizationId, SETTING_KEYS.offboardingItems))
  },

  /** All HR settings in one query (the HR dashboard and settings page need several at once). */
  async hrSettings(organizationId: string) {
    const rows = await prisma.setting.findMany({
      where: { organization_id: organizationId, key: { in: Object.values(SETTING_KEYS) } },
      select: { key: true, value: true },
    })
    const value = (key: string) => rows.find((row) => row.key === key)?.value
    return {
      attendance: parse.attendanceRules(value(SETTING_KEYS.attendanceRules)),
      leave: parse.leavePolicy(value(SETTING_KEYS.leavePolicy)),
      endingSoonDays: parse.endingSoonDays(value(SETTING_KEYS.endingSoonDays)),
      defaultWorkMode: parse.defaultWorkMode(value(SETTING_KEYS.defaultWorkMode)),
      expiryWarningDays: parse.documentExpiryWarningDays(value(SETTING_KEYS.documentExpiryWarningDays)),
      offboardingItems: parse.offboardingItems(value(SETTING_KEYS.offboardingItems)),
    }
  },
}

export type HrSettings = Awaited<ReturnType<typeof settingsService.hrSettings>>

// ── Updates (hr_settings.update) ─────────────────────────────────────────────

const generalSchema = z.strictObject({
  section: z.literal('general'),
  endingSoonDays: int(1, 90),
  defaultWorkMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']),
  expiryWarningDays: int(1, 180),
})
const attendanceSchema = z.strictObject({
  section: z.literal('attendance'),
  workStart: clock,
  graceMinutes: int(0, 180),
  fullDayMinutes: int(60, 960),
  halfDayMinutes: int(30, 720),
  workingDays: z.string().default(''),
})
const leaveSchema = z.strictObject({
  section: z.literal('leave'),
  backdateDays: int(0, 60),
  maxRequestDays: int(1, 180),
})
const offboardingSchema = z.strictObject({
  section: z.literal('offboarding'),
  items: z.string().max(4000),
})
const updateSchema = z.discriminatedUnion('section', [generalSchema, attendanceSchema, leaveSchema, offboardingSchema])

async function write(tx: Prisma.TransactionClient, organizationId: string, key: string, value: Prisma.InputJsonValue) {
  await tx.setting.upsert({
    where: { organization_id_key: { organization_id: organizationId, key } },
    create: { organization_id: organizationId, key, value },
    update: { value },
  })
}

export const hrSettingsService = {
  async get(ctx: RequestContext) {
    authorizationService.require(ctx, 'hr_settings.update')
    return settingsService.hrSettings(ctx.organization.id)
  },

  /** Saves one section; the audit entry records before/after values. */
  async update(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'hr_settings.update')
    const data = parseInput(updateSchema, input)
    const org = ctx.organization.id
    const before = await settingsService.hrSettings(org)
    let after: Record<string, unknown>
    let previous: Record<string, unknown>

    await prisma.$transaction(async (tx) => {
      switch (data.section) {
        case 'general':
          previous = {
            endingSoonDays: before.endingSoonDays,
            defaultWorkMode: before.defaultWorkMode,
            expiryWarningDays: before.expiryWarningDays,
          }
          after = {
            endingSoonDays: data.endingSoonDays,
            defaultWorkMode: data.defaultWorkMode,
            expiryWarningDays: data.expiryWarningDays,
          }
          await write(tx, org, SETTING_KEYS.endingSoonDays, { days: data.endingSoonDays })
          await write(tx, org, SETTING_KEYS.defaultWorkMode, { mode: data.defaultWorkMode })
          await write(tx, org, SETTING_KEYS.documentExpiryWarningDays, { days: data.expiryWarningDays })
          break
        case 'attendance': {
          const rules = parseInput(attendanceRulesSchema, {
            ...data,
            workingDays: data.workingDays.split(',').filter(Boolean),
          })
          previous = { ...before.attendance }
          after = { ...rules }
          await write(tx, org, SETTING_KEYS.attendanceRules, { ...rules, workingDays: [...rules.workingDays].sort() })
          break
        }
        case 'leave':
          previous = { ...before.leave }
          after = { backdateDays: data.backdateDays, maxRequestDays: data.maxRequestDays }
          await write(tx, org, SETTING_KEYS.leavePolicy, after as Prisma.InputJsonValue)
          break
        case 'offboarding': {
          const items = data.items
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 20)
            .map((line) => line.slice(0, 160))
          previous = { items: before.offboardingItems }
          after = { items }
          await write(tx, org, SETTING_KEYS.offboardingItems, { items })
          break
        }
      }
    })

    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.HR_SETTING_UPDATED,
      resourceType: 'settings',
      resourceId: null,
      metadata: { section: data.section, before: previous!, after: after! },
    })
  },
}
