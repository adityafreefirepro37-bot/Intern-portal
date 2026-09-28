import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/common/page-header'
import { config } from '@/lib/config'
import { ComponentGallery } from './gallery'

export const metadata: Metadata = { title: 'Component gallery' }

/** Development-only showcase of the design system. 404 in production. */
export default function ComponentsPage() {
  if (config.isProduction) notFound()
  return (
    <>
      <PageHeader
        title="Component gallery"
        description="Design-system components with sample content, for development and accessibility checks. Not available in production."
        breadcrumbs={[{ label: 'Overview', href: '/' }, { label: 'Component gallery' }]}
      />
      <ComponentGallery maxUploadBytes={config.storage.maxUploadBytes} />
    </>
  )
}
