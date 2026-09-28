<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AYAVA INTERN OS - Development Notes

## Project Status

Phase 01 Foundation - COMPLETE

## Quick Start Commands

```bash
# Install dependencies
npm install

# Set up database (requires PostgreSQL)
cp env.example .env
# Edit .env with your DATABASE_URL
npm run db:migrate
npm run db:seed

# Development
npm run dev

# Build
npm run build

# Type checking
npm run typecheck

# Linting
npm run lint

# Testing
npm test
```

## Important Notes

- This is a multi-tenant system with organization isolation
- All database queries must be scoped to organization_id
- Use the audit service for logging important actions
- Never hard-code user data - use the database seed
- UI components should use the design system tokens
- Follow the established folder structure

## Development Credentials

Seed data creates these accounts (development only):
- admin@ayavacreatives.com (SUPER_ADMIN)
- hr@ayavacreatives.com (HR)
- manager@ayavacreatives.com (MANAGER)
- mentor@ayavacreatives.com (MENTOR)
- intern@ayavacreatives.com (INTERN)

Password: DevPassword123!

⚠️ NEVER use these in production!
