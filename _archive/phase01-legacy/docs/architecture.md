# AYAVA INTERN OS - Architecture Documentation

## Overview

AYAVA INTERN OS follows a clean architecture pattern with clear separation of concerns between UI, business logic, and data access layers.

## Architecture Principles

1. **Separation of Concerns**: UI, business logic, and data access are clearly separated
2. **Service-Oriented**: Business logic lives in services, not controllers or components
3. **Type Safety**: TypeScript throughout with strict mode enabled
4. **Validation**: All inputs validated using Zod schemas
5. **Security First**: Authorization-ready architecture with audit logging
6. **Scalability**: Designed for multi-organization support
7. **Testability**: Clean interfaces and dependency injection ready

## Layer Architecture

```
┌─────────────────────────────────────────────┐
│           Presentation Layer                  │
│  (Next.js App Router + React Components)     │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│           API Layer                          │
│      (Next.js API Routes + Actions)          │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│           Service Layer                      │
│      (Business Logic + Validation)           │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│           Repository Layer                   │
│      (Data Access + Prisma)                 │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│           Database Layer                     │
│      (PostgreSQL + Prisma ORM)              │
└─────────────────────────────────────────────┘
```

## Component Architecture

### UI Components

**Location**: `src/components/`

- **ui/** - Reusable UI primitives (Button, Card, Input, etc.)
- **layout/** - Layout components (Sidebar, Topbar, AppShell)
- **navigation/** - Navigation and routing components
- **forms/** - Form components with validation
- **tables/** - Data table components
- **feedback/** - Feedback components (toasts, alerts)
- **common/** - Shared components (StatCard, EmptyState, LoadingState)

### Feature Modules

**Location**: `src/features/`

Each feature module contains:
- Components specific to the feature
- Feature-specific services
- Feature-specific validation schemas
- Feature-specific types

### Services

**Location**: `src/server/services/`

Services contain business logic:
- `audit.service.ts` - Audit logging
- `auth.service.ts` - Authentication (Phase 02)
- `user.service.ts` - User management (Phase 03)
- `intern.service.ts` - Intern management (Phase 03)
- `task.service.ts` - Task management (Phase 04)
- `project.service.ts` - Project management (Phase 04)

### Libraries

**Location**: `src/lib/`

- `db/` - Database client and configuration
- `auth/` - Authentication utilities (Phase 02)
- `permissions/` - Permission checks (Phase 02)
- `validation/` - Zod validation schemas
- `storage/` - Storage abstraction
- `utils/` - General utilities
- `logging/` - Logging utilities
- `config/` - Configuration management

## Data Flow

### Read Operation Flow

```
User Action → Component → API Route → Service → Repository → Database
              ↓              ↓           ↓          ↓
            UI           Validation   Business   Data Access
                          Logic       Logic
```

### Write Operation Flow

```
User Action → Component → API Route → Service → Repository → Database
              ↓              ↓           ↓          ↓
            UI           Validation   Business   Data Access
                          Logic       Logic       ↓
                                        Audit Log
```

## Security Architecture

### Authentication (Phase 02)

- Session-based authentication
- Secure cookie handling
- Password hashing with bcrypt
- Email verification flow

### Authorization (Phase 02)

- Role-based access control (RBAC)
- Permission-based access
- Organization isolation
- Row-level security via Prisma

### Audit Logging

- All important actions logged
- Actor tracking
- Resource tracking
- Metadata storage
- Non-blocking implementation

## Multi-Tenancy

### Organization Isolation

- Every table includes `organization_id`
- Queries always scoped to organization
- No cross-organization data access
- Separate seed data per organization

### Data Architecture

```
Organization (1) ──┬──> Users (N)
                   ├──> Departments (N)
                   ├──> Teams (N)
                   ├──> Projects (N)
                   ├──> Tasks (N)
                   └──> ... all other entities
```

## Performance Considerations

### Database Optimization

- Indexed fields on foreign keys and frequently queried columns
- Pagination for large datasets
- Selective field loading
- Connection pooling via Prisma

### Frontend Optimization

- Server components where appropriate
- Lazy loading for heavy components
- Optimized images
- Code splitting by route

### Caching Strategy (Future)

- API response caching
- Static data caching
- Session caching
- Database query caching

## Error Handling

### Error Boundaries

- Global error boundary for React errors
- Route-specific error handling
- API error standardization

### Error Format

```typescript
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid input",
    fields: {
      email: "Invalid email format"
    }
  }
}
```

## State Management

### Client State

- React Server Components by default
- Client Components for interactivity
- React Context for global state
- URL-based state where appropriate

### Server State

- Server Actions for mutations
- API routes for complex operations
- Database as single source of truth

## File Upload Architecture

### Storage Abstraction

```typescript
interface StorageService {
  upload(file: FileUpload): Promise<UploadedFile>
  download(path: string): Promise<Buffer>
  delete(path: string): Promise<void>
  getSignedUrl(path: string): Promise<string>
  validate(file: File): { valid: boolean; error?: string }
}
```

### Implementation Options

- Local storage (development)
- Supabase Storage (production)
- AWS S3 (production)
- Azure Blob Storage (production)

## API Design

### RESTful Conventions

- Resource-based URLs
- HTTP method semantics
- Consistent response format
- Proper status codes

### Response Format

```typescript
// Success
{
  success: true,
  data: { ... }
}

// Error
{
  success: false,
  error: {
    code: "ERROR_CODE",
    message: "Human readable message",
    fields?: { ... }
  }
}
```

## Testing Strategy

### Unit Tests

- Validation schemas
- Utility functions
- Business logic functions
- Services

### Integration Tests

- Database operations
- API endpoints
- Service integration
- Authorization checks

### End-to-End Tests

- Critical user flows
- Authentication
- CRUD operations
- Cross-feature workflows

## Deployment Architecture

### Environment Strategy

- Development: Local PostgreSQL
- Staging: Managed PostgreSQL (Railway/Render)
- Production: Managed PostgreSQL (Supabase/Railway)

### Build Process

1. TypeScript compilation
2. Next.js build
3. Asset optimization
4. Database migrations
5. Seed data (development only)

## Monitoring & Observability (Future)

- Application logging
- Error tracking (Sentry)
- Performance monitoring
- Database monitoring
- API analytics

## Scalability Considerations

### Horizontal Scaling

- Stateless application design
- Database connection pooling
- Session storage (Redis)
- CDN for static assets

### Vertical Scaling

- Optimized database queries
- Efficient component rendering
- Code splitting
- Lazy loading

## Future Enhancements

- Real-time features (WebSockets)
- Advanced caching
- CDN integration
- API rate limiting
- Advanced monitoring
- Automated backups
- Disaster recovery
