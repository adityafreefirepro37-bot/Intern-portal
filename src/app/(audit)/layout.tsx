/** A business's private audit page: no portal chrome, no sign-in. */
export default function AuditLayout({ children }: LayoutProps<'/'>) {
  return <main className="min-h-dvh bg-muted/40 px-4 py-8 sm:py-12">{children}</main>
}
