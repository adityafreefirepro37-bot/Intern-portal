# AYAVA INTERN OS - Development Guide

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn
- Git

### Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd ayava-intern-os
```

2. **Install dependencies**
```bash
npm install
```

3. **Set up environment variables**
```bash
cp env.example .env
```

Edit `.env` with your configuration:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/ayava_intern_os?schema=public"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

4. **Set up the database**
```bash
npm run db:migrate
npm run db:seed
```

5. **Start development server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Development Workflow

### Branch Strategy

- `main` - Production code
- `develop` - Integration branch
- `feature/*` - Feature branches
- `bugfix/*` - Bug fix branches
- `hotfix/*` - Production hotfixes

### Commit Conventions

Follow conventional commits:

```
feat: add user profile page
fix: resolve login authentication error
docs: update API documentation
style: format code with prettier
refactor: simplify user service
test: add unit tests for validation
chore: update dependencies
```

### Code Review Process

1. Create feature branch
2. Make changes with tests
3. Ensure tests pass
4. Create pull request
5. Request review
6. Address feedback
7. Merge after approval

## Coding Standards

### TypeScript

- Use strict mode
- Avoid `any` types
- Use interfaces for object shapes
- Use type aliases for unions
- Provide return types for public functions

### React

- Use functional components
- Use hooks for state
- Prefer server components
- Use TypeScript for props
- Keep components small and focused

### CSS/Tailwind

- Use design tokens from CSS variables
- Avoid arbitrary values
- Use utility classes first
- Extract repeated patterns to components
- Follow mobile-first responsive design

### Database

- Use Prisma for all database operations
- Always use transactions for multi-step operations
- Use indexes on frequently queried fields
- Validate data before database operations
- Handle errors appropriately

## File Naming Conventions

### Components
- PascalCase: `UserProfile.tsx`
- Test files: `UserProfile.test.tsx`
- Stories: `UserProfile.stories.tsx`

### Utilities
- camelCase: `formatDate.ts`
- Test files: `formatDate.test.ts`

### Services
- camelCase with `.service` suffix: `userService.ts`

### Types
- camelCase: `userTypes.ts` or use `types/index.ts`

## Project Structure

### Adding a New Feature

1. **Create feature directory**
```bash
mkdir -p src/features/your-feature
```

2. **Add components**
```bash
mkdir -p src/features/your-feature/components
```

3. **Add services**
```bash
mkdir -p src/features/your-feature/services
```

4. **Add types**
```bash
mkdir -p src/features/your-feature/types
```

5. **Add tests**
```bash
mkdir -p src/features/your-feature/__tests__
```

### Adding a New UI Component

1. Create component in `src/components/ui/`
2. Export from `src/components/ui/index.ts`
3. Add tests in `src/components/ui/__tests__/`
4. Document usage with comments

## Database Migrations

### Creating a Migration

```bash
npm run db:migrate
```

This creates a new migration based on schema changes.

### Modifying Schema

1. Edit `prisma/schema.prisma`
2. Run `npm run db:migrate`
3. Review generated migration
4. Test migration locally

### Resetting Database

```bash
npm run db:reset
```

⚠️ **Warning**: This deletes all data!

## Testing

### Unit Tests

Test individual functions and components:

```typescript
// __tests__/utils.test.ts
import { formatDate } from '@/lib/utils/date'

describe('formatDate', () => {
  it('should format date correctly', () => {
    const result = formatDate(new Date('2024-01-01'))
    expect(result).toBe('January 1, 2024')
  })
})
```

### Integration Tests

Test database operations and API endpoints:

```typescript
// __tests__/api/users.test.ts
import { POST } from '@/app/api/users/route'

describe('POST /api/users', () => {
  it('should create a new user', async () => {
    const response = await POST(request)
    expect(response.status).toBe(201)
  })
})
```

### Running Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Debugging

### VS Code Debugging

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug server-side",
      "type": "node-terminal",
      "request": "launch",
      "command": "npm run dev"
    },
    {
      "name": "Next.js: debug client-side",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:3000"
    }
  ]
}
```

### Console Logging

Use the structured logger:

```typescript
import { logger } from '@/lib/logging'

logger.info('User created', { userId: '123' })
logger.error('Database error', { error })
```

### Database Debugging

Use Prisma Studio:

```bash
npm run db:studio
```

## Performance Optimization

### Frontend

- Use server components where possible
- Implement code splitting
- Optimize images
- Lazy load components
- Use React.memo for expensive components

### Backend

- Use database indexes
- Implement pagination
- Cache frequently accessed data
- Optimize database queries
- Use connection pooling

### Monitoring

- Monitor build times
- Track API response times
- Monitor database query performance
- Track bundle sizes

## Common Tasks

### Adding a New Page

1. Create route in `src/app/your-page/page.tsx`
2. Use `AppShell` for layout
3. Add navigation in sidebar
4. Test responsive design

### Adding API Endpoint

1. Create route in `src/app/api/your-endpoint/route.ts`
2. Implement GET/POST/PUT/DELETE
3. Add validation with Zod
4. Add error handling
5. Write tests

### Adding Database Field

1. Update `prisma/schema.prisma`
2. Run migration
3. Update TypeScript types
4. Update services
5. Update UI components

### Adding Environment Variable

1. Add to `env.example`
2. Add to `.env` (local)
3. Add to production environment
4. Update `src/lib/config/index.ts`
5. Document in README

## Troubleshooting

### Build Errors

- Check TypeScript errors: `npm run typecheck`
- Check lint errors: `npm run lint`
- Clear cache: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm install`

### Database Errors

- Check connection string in `.env`
- Verify PostgreSQL is running
- Check migrations: `npm run db:migrate`
- Reset database: `npm run db:reset`

### Dependency Issues

- Clear npm cache: `npm cache clean --force`
- Delete node_modules: `rm -rf node_modules`
- Reinstall: `npm install`
- Check for conflicts: `npm ls`

## Best Practices

### Code Quality

- Write self-documenting code
- Add comments for complex logic
- Keep functions small
- Follow DRY principle
- Use meaningful variable names

### Security

- Never commit secrets
- Validate all inputs
- Use parameterized queries
- Implement proper error handling
- Log security events

### Performance

- Optimize database queries
- Use appropriate data structures
- Implement caching where beneficial
- Monitor performance metrics
- Profile before optimizing

### Testing

- Write tests for new features
- Maintain test coverage
- Test edge cases
- Mock external dependencies
- Keep tests fast

## Resources

### Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Radix UI Documentation](https://www.radix-ui.com/docs)
- [TypeScript Documentation](https://www.typescriptlang.org/docs)

### Tools

- [Prisma Studio](https://www.prisma.io/studio)
- [Next.js Dev Tools](https://github.com/vercel/next.js/tree/canary/packages/next-dev-tools)
- [React Dev Tools](https://react.dev/learn/react-developer-tools)

### Learning

- [React Patterns](https://reactpatterns.com/)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [Prisma Best Practices](https://www.prisma.io/docs/guides/performance-and-optimization)

## Getting Help

### Internal Resources

- Team chat channel
- Code review process
- Weekly standup meetings
- Documentation repository

### External Resources

- Stack Overflow
- GitHub Issues
- Community forums
- Official documentation

## Contributing

### Before Contributing

1. Read this guide
2. Set up development environment
3. Understand the codebase
4. Check existing issues
5. Discuss changes with team

### Submitting Changes

1. Create feature branch
2. Make changes with tests
3. Update documentation
4. Ensure tests pass
5. Create pull request
6. Address feedback
7. Merge after approval

### Code Review Guidelines

- Be constructive
- Focus on code quality
- Explain your reasoning
- Suggest improvements
- Ask questions
