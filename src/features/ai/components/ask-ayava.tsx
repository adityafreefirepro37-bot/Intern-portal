'use client'

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AiContextKind } from '@/lib/ai/router'
import { AiChat } from './ai-chat'

/**
 * "Ask AYAVA AI" on a task, project, lesson, review or document page. The
 * browser only passes the record's id; the server re-checks access on every
 * question and uses only that record's authorized data.
 */
export function AskAyava({
  contextType,
  contextId,
  label,
  suggestions,
  allowStudyMode = false,
}: {
  contextType: AiContextKind
  contextId: string
  label: string
  suggestions: string[]
  allowStudyMode?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Sparkles aria-hidden /> Ask AYAVA AI
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent side="right" className="flex h-dvh w-full max-w-lg flex-col gap-3 p-4 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask AYAVA AI</DialogTitle>
            <DialogDescription className="truncate">{label}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {/* Mounted only while open; each opening starts a fresh, private conversation. */}
            {open && <AiChat compact contextType={contextType} contextId={contextId} suggestions={suggestions} allowStudyMode={allowStudyMode} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
