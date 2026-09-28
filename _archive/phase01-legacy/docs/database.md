# AYAVA INTERN OS - Database Documentation

## Overview

AYAVA INTERN OS uses PostgreSQL as the primary database with Prisma ORM for type-safe database access.

## Database Schema

### Core Tables

#### Organization
Multi-tenant root entity. All other tables are scoped to an organization.

```prisma
model Organization {
  id        String   @id @default(uuid())
  name      String   @unique
  slug      String   @unique
  domain    String?
  logo_url  String?
  settings  Json?
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
}
```

#### User
System users with roles and organization membership.

```prisma
model User {
  id               String   @id @default(uuid())
  organization_id  String
  email            String
  password_hash    String
  first_name       String
  last_name        String
  avatar_url       String?
  phone            String?
  role             Role     @default(INTERN)
  is_active        Boolean  @default(true)
  email_verified   DateTime?
  last_login_at    DateTime?
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt
  deleted_at       DateTime?
}
```

**Roles**: SUPER_ADMIN, ADMIN, HR, MANAGER, MENTOR, INTERN

#### Department
Organizational departments.

```prisma
model Department {
  id              String   @id @default(uuid())
  organization_id String
  name            String
  slug            String
  description     String?
  head_id         String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### Team
Cross-functional teams within departments.

```prisma
model Team {
  id              String   @id @default(uuid())
  organization_id String
  department_id   String?
  name            String
  slug            String
  description     String?
  lead_id         String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### Position
Job positions within departments.

```prisma
model Position {
  id              String   @id @default(uuid())
  organization_id String
  department_id   String?
  title           String
  slug            String
  description     String?
  level           String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

### Intern Management

#### Intern
Extended profile for intern users.

```prisma
model Intern {
  id              String   @id @default(uuid())
  user_id         String   @unique
  organization_id String
  start_date      DateTime
  end_date        DateTime?
  status          String   @default("ACTIVE")
  notes           String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### Internship
Internship programs/tiers.

```prisma
model Internship {
  id              String   @id @default(uuid())
  organization_id String
  title           String
  slug            String
  description     String?
  duration_weeks  Int?
  requirements    Json?
  status          String   @default("ACTIVE")
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

### Projects & Tasks

#### Project
Project tracking and management.

```prisma
model Project {
  id              String   @id @default(uuid())
  organization_id String
  title           String
  slug            String
  description     String?
  status          String   @default("ACTIVE")
  priority        String   @default("MEDIUM")
  start_date      DateTime?
  end_date        DateTime?
  created_by      String
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### Task
Individual task tracking.

```prisma
model Task {
  id              String   @id @default(uuid())
  organization_id String
  project_id      String?
  title           String
  description     String?
  status          String   @default("TODO")
  priority        String   @default("MEDIUM")
  due_date        DateTime?
  assigned_to     String?
  created_by      String
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

### HR Operations

#### Attendance
Daily attendance tracking.

```prisma
model Attendance {
  id              String   @id @default(uuid())
  organization_id String
  user_id         String
  intern_id       String?
  date            DateTime
  check_in        DateTime?
  check_out       DateTime?
  status          String   @default("PRESENT")
  notes           String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### LeaveRequest
Leave request management.

```prisma
model LeaveRequest {
  id              String      @id @default(uuid())
  organization_id String
  user_id         String
  intern_id       String?
  leave_type_id   String?
  start_date      DateTime
  end_date        DateTime
  reason          String?
  attachment_path String?
  status          LeaveStatus @default(PENDING)
  reviewed_by     String?
  reviewed_at     DateTime?
  review_comment  String?
  created_at      DateTime    @default(now())
  updated_at      DateTime    @updatedAt
}
```

**Leave Status**: PENDING, APPROVED, REJECTED, CANCELLED

### Learning Management

#### Course
Learning courses.

```prisma
model Course {
  id          String       @id @default(uuid())
  organization_id String
  title       String
  slug        String
  description String?
  thumbnail_url String?
  status      CourseStatus @default(DRAFT)
  created_by  String
  created_at  DateTime     @default(now())
  updated_at  DateTime     @updatedAt
}
```

**Course Status**: DRAFT, PUBLISHED, ARCHIVED

#### Lesson
Course lessons.

```prisma
model Lesson {
  id               String   @id @default(uuid())
  course_id        String
  title            String
  description      String?
  content          String?
  video_url        String?
  sort_order       Int
  estimated_minutes Int?
  created_at       DateTime @default(now())
  updated_at       DateTime @updatedAt
}
```

#### Quiz
Lesson quizzes.

```prisma
model Quiz {
  id             String   @id @default(uuid())
  lesson_id      String
  title          String
  passing_score  Int      @default(70)
  created_at     DateTime @default(now())
  updated_at     DateTime @updatedAt
}
```

#### LearningProgress
User learning progress.

```prisma
model LearningProgress {
  id               String       @id @default(uuid())
  user_id          String
  course_id        String
  lesson_id        String?
  status           LessonStatus @default(NOT_STARTED)
  progress_percent Int          @default(0)
  completed_at     DateTime?
  updated_at       DateTime     @updatedAt
}
```

**Lesson Status**: NOT_STARTED, IN_PROGRESS, COMPLETED

### Communication

#### Announcement
Company announcements.

```prisma
model Announcement {
  id              String   @id @default(uuid())
  organization_id String
  title           String
  body            String
  priority        String   @default("NORMAL")
  published_by    String
  published_at    DateTime @default(now())
  expires_at      DateTime?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### Notification
User notifications.

```prisma
model Notification {
  id                  String   @id @default(uuid())
  organization_id     String
  user_id             String
  type                String
  title               String
  body                String
  read_at             DateTime?
  related_entity_type String?
  related_entity_id   String?
  created_at          DateTime @default(now())
}
```

#### Channel
Communication channels.

```prisma
model Channel {
  id              String       @id @default(uuid())
  organization_id String
  name            String
  slug            String
  description     String?
  channel_type    ChannelType @default(GENERAL)
  created_by      String
  created_at      DateTime     @default(now())
  updated_at      DateTime     @updatedAt
}
```

**Channel Type**: GENERAL, PROJECT, TEAM, ANNOUNCEMENTS, DIRECT

#### Message
Channel messages.

```prisma
model Message {
  id          String   @id @default(uuid())
  channel_id  String
  sender_id   String
  body        String
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
  deleted_at  DateTime?
}
```

### Performance

#### Feedback
User feedback.

```prisma
model Feedback {
  id              String   @id @default(uuid())
  organization_id String
  from_user_id    String
  to_user_id      String
  intern_id       String?
  category        String
  body            String
  visibility      String   @default("PRIVATE")
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### WeeklyCheckin
Weekly intern check-ins.

```prisma
model WeeklyCheckin {
  id              String   @id @default(uuid())
  intern_id       String
  week_start      DateTime
  accomplishments String?
  current_work    String?
  blockers        String?
  learning        String?
  support_needed  String?
  submitted_at    DateTime?
  reviewed_by     String?
  reviewed_at     DateTime?
}
```

#### PerformanceReview
Performance reviews.

```prisma
model PerformanceReview {
  id                    String   @id @default(uuid())
  organization_id       String
  intern_id             String
  reviewer_id           String
  review_period_start   DateTime
  review_period_end     DateTime
  technical_skills      Int?
  communication         Int?
  ownership             Int?
  quality               Int?
  reliability           Int?
  teamwork              Int?
  learning              Int?
  problem_solving       Int?
  overall_comments      String?
  status                String   @default("DRAFT")
  submitted_at          DateTime?
  created_at            DateTime @default(now())
  updated_at            DateTime @updatedAt
}
```

### Certificates

#### Certificate
Generated certificates.

```prisma
model Certificate {
  id                  String           @id @default(uuid())
  organization_id     String
  intern_id           String
  internship_id       String?
  certificate_number  String           @unique
  certificate_type    CertificateType
  issued_at           DateTime         @default(now())
  file_path           String?
  status              CertificateStatus @default(ACTIVE)
  created_at          DateTime         @default(now())
  updated_at          DateTime         @updatedAt
}
```

**Certificate Type**: COMPLETION, EXCELLENCE, ATTENDANCE, MILESTONE
**Certificate Status**: ACTIVE, REVOKED, EXPIRED

#### CertificateVerification
Certificate verification tracking.

```prisma
model CertificateVerification {
  id                  String   @id @default(uuid())
  certificate_id      String
  verification_code   String   @unique
  verification_count Int      @default(0)
  last_verified_at   DateTime?
  created_at          DateTime @default(now())
}
```

### AI & Knowledge

#### AIConversation
AI chat conversations.

```prisma
model AIConversation {
  id              String   @id @default(uuid())
  organization_id String
  user_id         String
  title           String?
  context_type    String?
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

#### AIMessage
AI conversation messages.

```prisma
model AIMessage {
  id              String      @id @default(uuid())
  conversation_id String
  role            MessageRole
  content         String
  model           String?
  created_at      DateTime    @default(now())
}
```

**Message Role**: USER, ASSISTANT, SYSTEM, TOOL

#### KnowledgeDocument
Knowledge base documents.

```prisma
model KnowledgeDocument {
  id              String         @id @default(uuid())
  organization_id String
  title           String
  description     String?
  file_name       String
  storage_path    String
  mime_type       String
  status          DocumentStatus @default(ACTIVE)
  uploaded_by     String
  created_at      DateTime       @default(now())
  updated_at      DateTime       @updatedAt
}
```

**Document Status**: ACTIVE, ARCHIVED, DELETED

### System

#### AuditLog
System audit trail.

```prisma
model AuditLog {
  id                String   @id @default(uuid())
  organization_id   String
  actor_user_id     String?
  action            String
  resource_type     String
  resource_id       String?
  metadata          Json?
  ip_address        String?
  user_agent        String?
  created_at        DateTime @default(now())
}
```

#### Setting
Organization settings.

```prisma
model Setting {
  id              String   @id @default(uuid())
  organization_id String
  key             String
  value           String
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt
}
```

## Database Indexes

### Performance Indexes

The following indexes are created for query optimization:

- `organization_id` on all tables (multi-tenancy)
- `user_id` on user-related tables
- `intern_id` on intern-related tables
- `project_id` on task tables
- `status` on workflow tables
- `due_date` on task tables
- `created_at` on audit and notification tables
- `email` on user table
- `slug` on slugged entities
- `certificate_number` on certificates
- `verification_code` on certificate verifications

### Unique Constraints

- `organization_id + email` on users
- `organization_id + slug` on organizations, departments, teams, positions, projects, courses
- `user_id` on intern profile
- `user_id + date` on attendance
- `intern_id + week_start` on weekly check-ins
- `certificate_number` on certificates
- `verification_code` on certificate verifications
- `organization_id + key` on settings

## Database Relationships

### Cascade Behavior

- **CASCADE**: Used for non-critical relationships (e.g., user → notifications)
- **RESTRICT**: Used for critical relationships (e.g., historical records)
- **SET NULL**: Used for optional relationships

### Historical Records

The following tables do not cascade delete to preserve history:

- Attendance
- Performance reviews
- Audit logs
- Certificates
- Learning progress

## Database Migrations

### Creating Migrations

```bash
npm run db:migrate
```

### Resetting Database

```bash
npm run db:reset
```

### Migration Best Practices

1. Always review generated migrations
2. Test migrations on staging first
3. Never modify existing migrations
4. Use descriptive migration names
5. Back up production database before migrations

## Seed Data

### Development Seed

The seed script creates:

- 1 organization (Ayava Creatives)
- 5 departments
- 7 positions
- 5 development users with different roles
- 1 intern profile
- 3 sample projects
- 3 sample courses
- 1 announcement

### Running Seed

```bash
npm run db:seed
```

### Seed Credentials

- Email: `intern@ayavacreatives.com`
- Password: `DevPassword123!`

⚠️ **Never use seed credentials in production**

## Database Security

### Access Control

- Application uses single database user
- Connection via environment variable
- No direct database access from frontend
- Prisma handles SQL injection prevention

### Data Encryption

- Passwords hashed with bcrypt
- Sensitive data in environment variables
- SSL for database connections (production)

### Backup Strategy (Future)

- Daily automated backups
- Point-in-time recovery
- Cross-region replication
- Backup retention policy

## Database Performance

### Query Optimization

- Use indexes on frequently queried columns
- Selective field loading with Prisma
- Pagination for large datasets
- Connection pooling

### Monitoring (Future)

- Slow query logging
- Query performance metrics
- Connection pool monitoring
- Database size tracking

## Database Maintenance

### Regular Tasks

- Vacuum and analyze tables
- Rebuild indexes
- Update statistics
- Clean up old data

### Data Retention

- Audit logs: 1 year
- Notifications: 90 days
- Deleted records: 30 days
- Certificate verifications: indefinite
