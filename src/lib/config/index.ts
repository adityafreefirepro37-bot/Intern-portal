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

/**
 * A setting with fixed options (e.g. STORAGE_PROVIDER). Hosting dashboards make
 * it easy to paste `"supabase"` with its quotes or a trailing space, so values
 * are trimmed, unquoted and lower-cased first. Blank or missing means
 * `fallback` (or "not set" when there is none). Errors name the allowed options
 * and the value received (these are never secrets).
 */
/** Removes surrounding whitespace and one pair of matching quotes: ` "465" ` → `465`. */
function unquote(value: string): string {
  return value
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim()
}

function choice<const T extends readonly [string, ...string[]]>(options: T): z.ZodType<T[number] | undefined>
function choice<const T extends readonly [string, ...string[]]>(options: T, fallback: T[number]): z.ZodType<T[number]>
function choice<const T extends readonly [string, ...string[]]>(options: T, fallback?: T[number]) {
  return z
    .preprocess(
      (value) => {
        if (typeof value !== 'string') return value
        const cleaned = unquote(value).toLowerCase()
        return cleaned === '' ? undefined : cleaned
      },
      z
        .enum(options, {
          error: (issue) => `must be one of ${options.join(', ')} (got ${JSON.stringify(issue.input)})`,
        })
        .optional(),
    )
    .transform((value) => value ?? fallback)
}

const envSchema = z.object({
  NODE_ENV: choice(['development', 'test', 'production'], 'development'),
  DATABASE_URL: optionalString,
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  DEFAULT_ORGANIZATION_SLUG: z.string().min(1).default('ayava-creatives'),

  AUTH_REQUIRE_EMAIL_VERIFICATION: choice(['true', 'false'], 'true').transform((value) => value === 'true'),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(64).default(10),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),

  SUPABASE_URL: optionalString,
  // Legacy names (anon / service_role) and the newer key names (publishable / secret) are both accepted.
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_SECRET_KEY: optionalString,

  STORAGE_PROVIDER: choice(['local', 'supabase'], 'local'),
  STORAGE_LOCAL_PATH: z.string().default('./.local/uploads'),
  STORAGE_MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),

  AI_PROVIDER: optionalString,
  AI_API_KEY: optionalString,

  EMAIL_PROVIDER: choice(['resend', 'smtp']),
  EMAIL_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  // SMTP (EMAIL_PROVIDER=smtp), e.g. Hostinger: smtp.hostinger.com, port 465.
  SMTP_HOST: optionalString,
  SMTP_PORT: optionalString
    .transform((value) => (value === undefined ? undefined : unquote(value)))
    .pipe(
      z
        .string()
        .regex(/^\d{1,5}$/, {
          error: (issue) => `must be a port number such as 465 or 587 (got ${JSON.stringify(issue.input)})`,
        })
        .transform(Number)
        .pipe(z.number().int().min(1).max(65535))
        .optional(),
    ),
  /** TLS from the first byte (port 465). Defaults to true on 465, STARTTLS otherwise. */
  SMTP_SECURE: choice(['true', 'false']).transform((value) => (value === undefined ? undefined : value === 'true')),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,

  LOG_LEVEL: choice(['debug', 'info', 'warn', 'error'], 'info'),

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
      smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 465,
        secure: env.SMTP_SECURE ?? (env.SMTP_PORT ?? 465) === 465,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      },
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
