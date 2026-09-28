import type { Metadata } from 'next'
import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { PhasePlaceholder } from '@/components/common/phase-placeholder'
import { AccessDenied } from '@/components/common/states'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'AYAVA AI' }

export default async function Page() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'ai.use')) return <AccessDenied what="AYAVA AI" />

  return (
    <>
      <PageHeader title="AYAVA AI" />
      <PhasePlaceholder
        icon={Sparkles}
        phase="07"
        title="AYAVA AI"
        description="An assistant that knows Ayava’s processes and your work."
        planned={[
          'Chat with conversation history',
          'Answers grounded in the knowledge base (RAG)',
          'Help drafting reports and check-ins',
          'Admin controls for models and sources',
        ]}
        foundation={[
          'ai_conversations, ai_messages and knowledge_documents tables',
          'AI provider settings in environment configuration',
          'ai.use / ai.manage and knowledge permissions',
        ]}
      />
    </>
  )
}
