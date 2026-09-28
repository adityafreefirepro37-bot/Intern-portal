# AYAVA INTERN OS

Internal operations system for Ayava Creatives intern management.

## Project Overview

AYAVA INTERN OS is a comprehensive internal management system designed for Ayava Creatives to manage interns, projects, tasks, learning, performance, and organizational operations. This foundation provides the architecture for a 10-phase implementation plan.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **Database**: PostgreSQL with Prisma ORM
- **UI Components**: Radix UI primitives
- **Validation**: Zod
- **Authentication**: Foundation for NextAuth.js (Phase 02)
- **Storage**: Foundation for local/cloud storage (Phase 07)
- **Testing**: Jest, ts-jest

## Architecture

### Folder Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Authentication routes (Phase 02)
│   ├── (dashboard)/       # Protected dashboard routes
│   ├── api/               # API routes
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Dashboard home
│   └── globals.css        # Global styles
│
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   ├── layout/           # Layout components (Sidebar, Topbar, AppShell)
│   ├── navigation/       # Navigation components
│   ├── forms/            # Form components
│   ├── tables/           # Table components
│   ├── feedback/         # Feedback components
│   └── common/           # Common components (StatCard, EmptyState, LoadingState)
│
├── features/             # Feature-specific modules
│   ├── auth/            # Authentication (Phase 02)
│   ├── users/           # User management (Phase 03)
│   ├── interns/        # Intern management (Phase 03)
│   ├── projects/        # Project management (Phase 04)
│   ├── tasks/           # Task management (Phase 04)
│   ├── attendance/      # Attendance tracking (Phase 05)
│   ├── leave/           # Leave management (Phase 05)
│   ├── learning/        # Learning management (Phase 05)
│   ├── performance/     # Performance reviews (Phase 06)
│   ├── notifications/   # Notifications (Phase 06)
│   ├── documents/       # Document management (Phase 05)
│   ├── certificates/    # Certificate generation (Phase 08)
│   ├── ai/              # AI features (Phase 07)
│   └── audit/           # Audit logging (Phase 09)
│
├── lib/                  # Utility libraries
│   ├── db/              # Database client
│   ├── auth/            # Authentication utilities (Phase 02)
│   ├── permissions/     # Permission utilities (Phase 02)
│   ├── validation/      # Zod schemas
│   ├── storage/         # Storage abstraction
│   ├── utils/           # General utilities
│   ├── logging/         # Logging utilities
│   └── config/          # Configuration
│
├── server/               # Server-side code
│   ├── services/        # Business logic services
│   ├── repositories/     # Data access layer
│   └── actions/         # Server actions
│
├── types/                # TypeScript type definitions
└── config/               # Configuration files
```

## Environment Setup

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

### Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp env.example .env
```

4. Configure your `.env` file:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/ayava_intern_os?schema=public"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Database Setup

### Run Migrations

```bash
npm run db:migrate
```

### Seed Database

```bash
npm run db:seed
```

### Open Prisma Studio

```bash
npm run db:studio
```

### Reset Database

```bash
npm run db:reset
```

## Local Development

### Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
```

### Start Production Server

```bash
npm start
```

## Testing

### Run Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

## Code Quality

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
npm run lint
```

## Development Accounts

The seed script creates the following development accounts:

- **admin@ayavacreatives.com** (SUPER_ADMIN)
- **hr@ayavacreatives.com** (HR)
- **manager@ayavacreatives.com** (MANAGER)
- **mentor@ayavacreatives.com** (MENTOR)
- **intern@ayavacreatives.com** (INTERN)

**Password**: `DevPassword123!`

⚠️ **Important**: These are development credentials only. Never use these in production.

## Security

- Environment variables for sensitive configuration
- Password hashing with bcrypt
- Foundation for role-based access control (RBAC)
- Audit logging architecture
- Input validation with Zod
- SQL injection prevention via Prisma
- No secrets committed to repository

## Deployment

### Environment Variables Required

- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_APP_URL` - Application URL
- Additional variables for AI, storage, email (future phases)

### Deployment Platforms

The application is designed to deploy to:
- Vercel (recommended for Next.js)
- Railway
- Render
- Any platform supporting Node.js and PostgreSQL

## Phase Implementation Plan

This foundation supports the following implementation phases:

- **Phase 01**: Foundation (Current) - Database, UI, Architecture
- **Phase 02**: Authentication & Authorization
- **Phase 03**: Intern Management
- **Phase 04**: Tasks & Projects
- **Phase 05**: HR Operations (Attendance, Leave, Documents, Learning)
- **Phase 06**: Communication & Performance
- **Phase 07**: AI & Knowledge Base
- **Phase 08**: Analytics & Certificates
- **Phase 09**: System Administration
- **Phase 10**: Polish & Launch

## Documentation

- [Architecture Documentation](docs/architecture.md)
- [Database Documentation](docs/database.md)
- [Security Documentation](docs/security.md)
- [Development Guide](docs/development.md)

## Contributing

This is an internal project for Ayava Creatives. Follow the established coding standards and commit conventions.

## License

Internal use only - Ayava Creatives

## Support

For internal support, contact the development team.
