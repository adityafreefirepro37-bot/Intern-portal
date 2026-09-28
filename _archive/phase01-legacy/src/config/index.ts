export const config = {
  app: {
    name: 'Ayava Intern OS',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },
  database: {
    url: process.env.DATABASE_URL,
  },
  auth: {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    jwtSecret: process.env.JWT_SECRET,
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    path: process.env.STORAGE_PATH || './uploads',
  },
} as const;