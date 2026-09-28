import { z } from 'zod'

/**
 * Centralized, validated server configuration.
 *
 * Only this module reads `process.env` for server settings. Secrets never leave
 * the server: nothing here is prefixed NEXT_PUBLIC_ except the app URL.
 */

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined))

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: optionalString,
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  DEFAULT_ORGANIZATION_SLUG: z.string().min(1).default('ayava-creatives'),

  AUTH_REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(64).default(10),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),

  SUPABASE_URL: optionalString,
  // Legacy names (anon / service_role) and the newer key names (publishable / secret) are both accepted.
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_SECRET_KEY: optionalString,

  STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./.local/uploads'),
  STORAGE_MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),

  AI_PROVIDER: optionalString,
  AI_API_KEY: optionalString,

  EMAIL_PROVIDER: z
    .enum(['', 'resend'])
    .optional()
    .transform((value) => value || undefined),
  EMAIL_API_KEY: optionalString,
  EMAIL_FROM: optionalString,

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Shared secret for scheduled job endpoints (/api/jobs/*). Jobs are disabled without it. */
  CRON_SECRET: optionalString.pipe(z.string().min(24).optional()),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`)
  }
  return result.data
}

function buildConfig(env: Env) {
  const isProduction = env.NODE_ENV === 'production'
  return {
    env: env.NODE_ENV,
    isProduction,
    app: {
      name: 'AYAVA INTERN OS',
      url: env.NEXT_PUBLIC_APP_URL,
      defaultOrganizationSlug: env.DEFAULT_ORGANIZATION_SLUG,
    },
    database: {
      configured: Boolean(env.DATABASE_URL),
    },
    auth: {
      /** Require a confirmed email address before granting application access. */
      requireEmailVerification: env.AUTH_REQUIRE_EMAIL_VERIFICATION,
      passwordMinLength: env.AUTH_PASSWORD_MIN_LENGTH,
      invitationTtlMs: env.INVITATION_TTL_HOURS * 60 * 60 * 1000,
      /** Supabase Auth is the identity provider; without it nobody can sign in. */
      configured: Boolean(env.SUPABASE_URL && (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)),
    },
    supabase: {
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
    },
    storage: {
      provider: env.STORAGE_PROVIDER,
      localPath: env.STORAGE_LOCAL_PATH,
      maxUploadBytes: Math.floor(env.STORAGE_MAX_UPLOAD_MB * 1024 * 1024),
    },
    ai: {
      provider: env.AI_PROVIDER,
      apiKey: env.AI_API_KEY,
    },
    email: {
      provider: env.EMAIL_PROVIDER,
      apiKey: env.EMAIL_API_KEY,
      from: env.EMAIL_FROM,
    },
    logging: {
      level: env.LOG_LEVEL,
    },
    jobs: {
      cronSecret: env.CRON_SECRET,
    },
  } as const
}

export type AppConfig = ReturnType<typeof buildConfig>

export const config: AppConfig = buildConfig(parseEnv(process.env))
