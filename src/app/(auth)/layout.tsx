import { Brand } from '@/components/layout/brand'

/** Layout for sign-in and account pages: a single focused card. */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-[26rem]">
        <div className="mb-6 flex justify-center">
          <Brand organizationName="Intern OS" />
        </div>
        <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">{children}</div>
        <p className="mt-6 text-center text-caption text-muted-foreground">Ayava Creatives · Internal use only</p>
      </div>
    </main>
  )
}
