import { redirect } from 'next/navigation'

/** /dashboard is an alias for the role-aware overview at /. */
export default function DashboardAlias() {
  redirect('/')
}
