'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FormField } from '@/components/forms/form-field'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { Input, inputClassName, Textarea } from '@/components/ui/input'
import { saveGrowthSettingsAction, saveIndustryAction } from '@/server/actions/leads'

export interface GrowthSettingsValue {
  enabled: boolean
  cities: string[]
  tomtomEnabled: boolean
  tomtomDailyCap: number
  tomtomMonthlyCap: number
  googleEnabled: boolean
  osmEnabled: boolean
  placesDailyCap: number
  placesMonthlyCap: number
  newLeadsDailyCap: number
  siteSearchEnabled: boolean
  siteSearchDailyCap: number
  siteSearchMonthlyCap: number
  requireEmail: boolean
  aiSummaries: boolean
  proof: string[]
  auditPageDays: number
}

function lines(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-small font-medium">{label}</span>
        {hint && <span className="block text-caption text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

export function GrowthSettingsForm({
  initial,
  googleConfigured,
  tomtomConfigured,
  webSearchConfigured,
}: {
  initial: GrowthSettingsValue
  googleConfigured: boolean
  tomtomConfigured: boolean
  webSearchConfigured: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [s, setS] = React.useState(initial)
  const [cities, setCities] = React.useState(initial.cities.join('\n'))
  const [proof, setProof] = React.useState(initial.proof.join('\n'))
  const [busy, setBusy] = React.useState(false)
  const set = (patch: Partial<GrowthSettingsValue>) => setS((v) => ({ ...v, ...patch }))

  async function save() {
    setBusy(true)
    const result = await saveGrowthSettingsAction({ ...s, cities: lines(cities), proof: lines(proof) })
    setBusy(false)
    toast({ title: result.message ?? 'Could not save', variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') router.refresh()
  }

  return (
    <div className="grid gap-5">
      <Toggle
        label="Find and audit new businesses automatically"
        hint="The worker searches a few industry × city combinations every few minutes, inside the limits below."
        checked={s.enabled}
        onChange={(enabled) => set({ enabled })}
      />
      <FormField label="Cities" hint="One per line. Every active industry is searched in every city.">
        <Textarea rows={5} value={cities} onChange={(e) => setCities(e.target.value)} />
      </FormField>
      <div className="grid gap-3">
        <Toggle
          label="TomTom"
          hint={tomtomConfigured ? 'Free developer key: name, phone, website, up to 100 businesses per search.' : 'Add TOMTOM_API_KEY to the environment to use TomTom (free, no card).'}
          checked={s.tomtomEnabled}
          onChange={(tomtomEnabled) => set({ tomtomEnabled })}
        />
        <Toggle
          label="Google Places"
          hint={googleConfigured ? 'Best data (website, phone, rating). Free within the limits below.' : 'Add GOOGLE_MAPS_API_KEY to the environment to use Google.'}
          checked={s.googleEnabled}
          onChange={(googleEnabled) => set({ googleEnabled })}
        />
        <Toggle label="OpenStreetMap" hint="Completely free; fewer businesses in smaller towns." checked={s.osmEnabled} onChange={(osmEnabled) => set({ osmEnabled })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="TomTom searches per day" hint="Each returns up to 100 businesses">
          <Input type="number" min={0} max={2000} value={s.tomtomDailyCap} onChange={(e) => set({ tomtomDailyCap: Number(e.target.value) })} />
        </FormField>
        <FormField label="TomTom searches per month" hint="Keep inside your TomTom free allowance">
          <Input type="number" min={0} max={50000} value={s.tomtomMonthlyCap} onChange={(e) => set({ tomtomMonthlyCap: Number(e.target.value) })} />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Google searches per day" hint="Each returns up to 20 businesses">
          <Input type="number" min={0} max={200} value={s.placesDailyCap} onChange={(e) => set({ placesDailyCap: Number(e.target.value) })} />
        </FormField>
        <FormField label="Google searches per month" hint="Free allowance: 1,000 (keep below)">
          <Input type="number" min={0} max={5000} value={s.placesMonthlyCap} onChange={(e) => set({ placesMonthlyCap: Number(e.target.value) })} />
        </FormField>
        <FormField label="New leads per day" hint="Stops importing after this many">
          <Input type="number" min={0} max={5000} value={s.newLeadsDailyCap} onChange={(e) => set({ newLeadsDailyCap: Number(e.target.value) })} />
        </FormField>
      </div>
      <div className="grid gap-3">
        <Toggle
          label="Find websites listings don’t have"
          hint={
            webSearchConfigured
              ? 'Likely addresses are tried first (free), then a Brave web search. A site is used only when it shows the business’s name with its phone number or city.'
              : 'Likely addresses are tried (free). Add BRAVE_SEARCH_API_KEY to the environment to also search the web; until then “No website found” is never claimed.'
          }
          checked={s.siteSearchEnabled}
          onChange={(siteSearchEnabled) => set({ siteSearchEnabled })}
        />
        <Toggle
          label="Keep only leads with a published email address"
          hint="Outreach is automatic, by email. Only addresses the business publishes itself (on its own website or listing) are used."
          checked={s.requireEmail}
          onChange={(requireEmail) => set({ requireEmail })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Web searches per day" hint="Brave Search, for websites listings don’t have">
          <Input type="number" min={0} max={2000} value={s.siteSearchDailyCap} onChange={(e) => set({ siteSearchDailyCap: Number(e.target.value) })} />
        </FormField>
        <FormField label="Web searches per month" hint="Brave’s free monthly credit covers about 1,000 (keep below)">
          <Input type="number" min={0} max={50000} value={s.siteSearchMonthlyCap} onChange={(e) => set({ siteSearchMonthlyCap: Number(e.target.value) })} />
        </FormField>
      </div>
      <Toggle label="AI summaries" hint="AYAVA AI words the top three problems for each Hot and Warm lead." checked={s.aiSummaries} onChange={(aiSummaries) => set({ aiSummaries })} />
      <FormField label="Verified proof about Ayava" hint="One fact per line (results, clients). The AI may cite these and nothing else. Leave empty until figures are confirmed.">
        <Textarea rows={4} value={proof} onChange={(e) => setProof(e.target.value)} />
      </FormField>
      <FormField label="Audit page stays open for (days)">
        <Input type="number" min={7} max={365} value={s.auditPageDays} onChange={(e) => set({ auditPageDays: Number(e.target.value) })} />
      </FormField>
      <div>
        <Button onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </div>
  )
}

export function IndustryRow({ industry }: { industry: { id: string; name: string; active: boolean; priority: number; search_terms: string[]; leads: number } }) {
  const router = useRouter()
  const { toast } = useToast()
  const [active, setActive] = React.useState(industry.active)
  const [priority, setPriority] = React.useState(industry.priority)
  const [terms, setTerms] = React.useState(industry.search_terms.join(', '))
  const [busy, setBusy] = React.useState(false)
  const dirty = active !== industry.active || priority !== industry.priority || terms !== industry.search_terms.join(', ')

  async function save() {
    setBusy(true)
    const result = await saveIndustryAction({ industryId: industry.id, active, priority, terms: terms.split(',').map((t) => t.trim()).filter(Boolean) })
    setBusy(false)
    toast({ title: result.message ?? 'Could not save', variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') router.refresh()
  }

  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} aria-label={`Search ${industry.name}`} />
          <span className={active ? 'font-medium' : 'text-muted-foreground'}>{industry.name}</span>
        </label>
        <span className="ml-6 text-caption text-muted-foreground">{industry.leads} leads</span>
      </td>
      <td className="px-3 py-2">
        <select aria-label={`Priority of ${industry.name}`} className={`${inputClassName} h-8 w-24`} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          <option value={1}>High</option>
          <option value={2}>Normal</option>
          <option value={3}>Low</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <Input aria-label={`Search terms for ${industry.name}`} className="h-8" value={terms} onChange={(e) => setTerms(e.target.value)} />
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="outline" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </td>
    </tr>
  )
}
