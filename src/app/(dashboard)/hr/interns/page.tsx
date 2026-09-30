import { redirect } from 'next/navigation'

/** The HR directory is the intern directory (/interns), which carries the HR filters and columns. */
export default async function HrInternsPage({ searchParams }: PageProps<'/hr/interns'>) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  ).toString()
  redirect(params ? `/interns?${params}` : '/interns')
}
