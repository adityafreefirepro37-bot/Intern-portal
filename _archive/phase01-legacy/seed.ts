import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/lib/auth/permissions'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Starting seed...')

  // Create Organization
  const organization = await prisma.organization.upsert({
    where: { slug: 'ayava-creatives' },
    update: {},
    create: {
      name: 'Ayava Creatives',
      slug: 'ayava-creatives',
      domain: 'ayavacreatives.com',
    },
  })
  console.log(`✅ Created organization: ${organization.name}`)

  // Create Permissions
  console.log('📝 Creating permissions...')
  for (const permission of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { name: permission },
      update: {},
      create: {
        name: permission,
        description: permission.replace(/\./g, ' ').replace(/_/g, ' '),
      },
    })
  }
  console.log(`✅ Created ${Object.keys(PERMISSIONS).length} permissions`)

  // Create Role Permissions
  console.log('📝 Creating role permissions...')
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of permissions) {
      const permissionRecord = await prisma.permission.findUnique({
        where: { name: permission },
      })

      if (permissionRecord) {
        await prisma.rolePermission.upsert({
          where: {
            role_permission_id: {
              role: role as any,
              permission_id: permissionRecord.id,
            },
          },
          update: {},
          create: {
            role: role as any,
            permission_id: permissionRecord.id,
          },
        })
      }
    }
  }
  console.log(`✅ Created role permissions`)

  // Create Departments
  const departments = await Promise.all([
    prisma.department.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'marketing' } },
      update: {},
      create: {
        organization_id: organization.id,
        name: 'Marketing',
        slug: 'marketing',
        description: 'Marketing and advertising department',
      },
    }),
    prisma.department.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'design' } },
      update: {},
      create: {
        organization_id: organization.id,
        name: 'Design',
        slug: 'design',
        description: 'Creative design department',
      },
    }),
    prisma.department.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'development' } },
      update: {},
      create: {
        organization_id: organization.id,
        name: 'Development',
        slug: 'development',
        description: 'Software development department',
      },
    }),
    prisma.department.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'hr' } },
      update: {},
      create: {
        organization_id: organization.id,
        name: 'HR',
        slug: 'hr',
        description: 'Human Resources department',
      },
    }),
    prisma.department.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'operations' } },
      update: {},
      create: {
        organization_id: organization.id,
        name: 'Operations',
        slug: 'operations',
        description: 'Operations and logistics department',
      },
    }),
  ])
  console.log(`✅ Created ${departments.length} departments`)

  // Create Positions
  const positions = await Promise.all([
    prisma.position.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'digital-marketing-intern' } },
      update: {},
      create: {
        organization_id: organization.id,
        department_id: departments[0].id,
        title: 'Digital Marketing Intern',
        slug: 'digital-marketing-intern',
        level: 'Intern',
      },
    }),
    prisma.position.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'social-media-intern' } },
      update: {},
      create: {
        organization_id: organization.id,
        department_id: departments[0].id,
        title: 'Social Media Intern',
        slug: 'social-media-intern',
        level: 'Intern',
      },
    }),
    prisma.position.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'graphic-design-intern' } },
      update: {},
      create: {
        organization_id: organization.id,
        department_id: departments[1].id,
        title: 'Graphic Design Intern',
        slug: 'graphic-design-intern',
        level: 'Intern',
      },
    }),
    prisma.position.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'ui-ux-intern' } },
      update: {},
      create: {
        organization_id: organization.id,
        department_id: departments[1].id,
        title: 'UI/UX Intern',
        slug: 'ui-ux-intern',
        level: 'Intern',
      },
    }),
    prisma.position.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'web-development-intern' } },
      update: {},
      create: {
        organization_id: organization.id,
        department_id: departments[2].id,
        title: 'Web Development Intern',
        slug: 'web-development-intern',
        level: 'Intern',
      },
    }),
    prisma.position.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'ai-ml-intern' } },
      update: {},
      create: {
        organization_id: organization.id,
        department_id: departments[2].id,
        title: 'AI/ML Intern',
        slug: 'ai-ml-intern',
        level: 'Intern',
      },
    }),
    prisma.position.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'content-writing-intern' } },
      update: {},
      create: {
        organization_id: organization.id,
        department_id: departments[0].id,
        title: 'Content Writing Intern',
        slug: 'content-writing-intern',
        level: 'Intern',
      },
    }),
  ])
  console.log(`✅ Created ${positions.length} positions`)

  // Create Development Users
  const passwordHash = await bcrypt.hash('DevPassword123!', 10)
  
  const adminUser = await prisma.user.upsert({
    where: { organization_id_email: { organization_id: organization.id, email: 'admin@ayavacreatives.com' } },
    update: {},
    create: {
      organization_id: organization.id,
      email: 'admin@ayavacreatives.com',
      passwordHash: passwordHash,
      first_name: 'Admin',
      last_name: 'User',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      is_active: true,
    },
  })

  const hrUser = await prisma.user.upsert({
    where: { organization_id_email: { organization_id: organization.id, email: 'hr@ayavacreatives.com' } },
    update: {},
    create: {
      organization_id: organization.id,
      email: 'hr@ayavacreatives.com',
      passwordHash: passwordHash,
      first_name: 'HR',
      last_name: 'Manager',
      role: 'HR',
      department_id: departments[3].id,
      status: 'ACTIVE',
      is_active: true,
    },
  })

  const managerUser = await prisma.user.upsert({
    where: { organization_id_email: { organization_id: organization.id, email: 'manager@ayavacreatives.com' } },
    update: {},
    create: {
      organization_id: organization.id,
      email: 'manager@ayavacreatives.com',
      passwordHash: passwordHash,
      first_name: 'Team',
      last_name: 'Manager',
      role: 'MANAGER',
      department_id: departments[0].id,
      status: 'ACTIVE',
      is_active: true,
    },
  })

  const mentorUser = await prisma.user.upsert({
    where: { organization_id_email: { organization_id: organization.id, email: 'mentor@ayavacreatives.com' } },
    update: {},
    create: {
      organization_id: organization.id,
      email: 'mentor@ayavacreatives.com',
      passwordHash: passwordHash,
      first_name: 'Senior',
      last_name: 'Mentor',
      role: 'MENTOR',
      department_id: departments[2].id,
      status: 'ACTIVE',
      is_active: true,
    },
  })

  const internUser = await prisma.user.upsert({
    where: { organization_id_email: { organization_id: organization.id, email: 'intern@ayavacreatives.com' } },
    update: {},
    create: {
      organization_id: organization.id,
      email: 'intern@ayavacreatives.com',
      passwordHash: passwordHash,
      first_name: 'Test',
      last_name: 'Intern',
      role: 'INTERN',
      department_id: departments[2].id,
      position_id: positions[4].id,
      status: 'ACTIVE',
      is_active: true,
    },
  })

  console.log(`✅ Created 5 development users`)
  console.log(`   - admin@ayavacreatives.com (SUPER_ADMIN)`)
  console.log(`   - hr@ayavacreatives.com (HR)`)
  console.log(`   - manager@ayavacreatives.com (MANAGER)`)
  console.log(`   - mentor@ayavacreatives.com (MENTOR)`)
  console.log(`   - intern@ayavacreatives.com (INTERN)`)
  console.log(`   Password: DevPassword123!`)

  // Create Intern Profile
  const internProfile = await prisma.intern.upsert({
    where: { user_id: internUser.id },
    update: {},
    create: {
      user_id: internUser.id,
      organization_id: organization.id,
      start_date: new Date(),
      end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      status: 'ACTIVE',
    },
  })
  console.log(`✅ Created intern profile`)

  // Create Projects
  const projects = await Promise.all([
    prisma.project.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'ayava-website-revamp' } },
      update: {},
      create: {
        organization_id: organization.id,
        title: 'Ayava Website Revamp',
        slug: 'ayava-website-revamp',
        description: 'Complete redesign and development of the company website',
        status: 'ACTIVE',
        priority: 'HIGH',
        start_date: new Date(),
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        created_by: managerUser.id,
      },
    }),
    prisma.project.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'social-media-growth-campaign' } },
      update: {},
      create: {
        organization_id: organization.id,
        title: 'Social Media Growth Campaign',
        slug: 'social-media-growth-campaign',
        description: 'Strategy and execution for social media growth',
        status: 'ACTIVE',
        priority: 'MEDIUM',
        start_date: new Date(),
        end_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        created_by: managerUser.id,
      },
    }),
    prisma.project.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'brand-content-system' } },
      update: {},
      create: {
        organization_id: organization.id,
        title: 'Brand Content System',
        slug: 'brand-content-system',
        description: 'Develop a comprehensive brand content management system',
        status: 'PLANNING',
        priority: 'MEDIUM',
        start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        end_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        created_by: managerUser.id,
      },
    }),
  ])
  console.log(`✅ Created ${projects.length} projects`)

  // Create Courses
  const courses = await Promise.all([
    prisma.course.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'ayava-orientation' } },
      update: {},
      create: {
        organization_id: organization.id,
        title: 'Ayava Orientation',
        slug: 'ayava-orientation',
        description: 'Company orientation and onboarding course',
        status: 'PUBLISHED',
        created_by: hrUser.id,
      },
    }),
    prisma.course.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'digital-marketing-fundamentals' } },
      update: {},
      create: {
        organization_id: organization.id,
        title: 'Digital Marketing Fundamentals',
        slug: 'digital-marketing-fundamentals',
        description: 'Introduction to digital marketing concepts and strategies',
        status: 'PUBLISHED',
        created_by: hrUser.id,
      },
    }),
    prisma.course.upsert({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'creative-agency-workflow' } },
      update: {},
      create: {
        organization_id: organization.id,
        title: 'Creative Agency Workflow',
        slug: 'creative-agency-workflow',
        description: 'Understanding workflows in a creative agency environment',
        status: 'PUBLISHED',
        created_by: hrUser.id,
      },
    }),
  ])
  console.log(`✅ Created ${courses.length} courses`)

  // Create Announcement
  await prisma.announcement.upsert({
    where: { id: 'dev-announcement-1' },
    update: {},
    create: {
      id: 'dev-announcement-1',
      organization_id: organization.id,
      title: 'Welcome to AYAVA INTERN OS',
      body: 'This is a development environment. All data here is for testing purposes only.',
      priority: 'NORMAL',
      published_by: adminUser.id,
    },
  })
  console.log(`✅ Created announcement`)

  console.log('🎉 Seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
