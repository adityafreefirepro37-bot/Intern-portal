import type { PrismaClient, QuizQuestionType, ReviewRespondent } from '@prisma/client'
import { evaluateCompletion } from '../../src/lib/learning/rules'
import { weekStart } from '../../src/lib/performance/rules'
import { dateFrom, daysFrom, seedId } from './ids'

/**
 * DEVELOPMENT / DEMO DATA — learning and performance (Phase 06): categories,
 * eight courses with modules, lessons, quizzes and assignments, four learning
 * paths, required training, enrollments whose progress is computed with the
 * same completion rule the app uses, goals with evidence, weekly check-ins,
 * feedback in every visibility, a review template, an open mid-point cycle
 * with reviews at different stages and a development plan. Idempotent: rows
 * use deterministic ids and are upserted (or replaced by id).
 */

type Key = string

interface Input {
  organizationId: string
  userIds: Record<Key, string>
  internIds: Record<Key, string>
  departmentIds: Record<Key, string>
  positionIds: Record<Key, string>
  now: Date
}

interface QuestionSeed {
  q: string
  type: QuizQuestionType
  options?: string[]
  correct?: number[]
  accepted?: string[]
  explanation?: string
}

interface CourseSeed {
  key: string
  title: string
  category: string
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'
  description: string
  required?: boolean
  modules: { title: string; lessons: { title: string; minutes: number; text: string; link?: string }[] }[]
  quiz: { title: string; passing: number; attempts: number | null; minutes: number | null; questions: QuestionSeed[] }
  assignment?: { title: string; instructions: string; points: number | null; rubric?: string; dueDays: number }
}

const CATEGORIES = [
  ['engineering', 'Engineering', 'Code, tools and technical foundations.'],
  ['communication', 'Communication', 'Writing, meetings and working with people.'],
  ['marketing', 'Marketing', 'Digital marketing, SEO and content.'],
  ['ai', 'AI & Data', 'Machine learning and AI concepts.'],
  ['security', 'Security', 'Keeping people, clients and data safe.'],
] as const

const COURSES: CourseSeed[] = [
  {
    key: 'git',
    title: 'Git & GitHub Fundamentals',
    category: 'engineering',
    difficulty: 'BEGINNER',
    description: 'Version control for everyday work: commits, branches, pull requests and reviews.',
    modules: [
      {
        title: 'Version control basics',
        lessons: [
          {
            title: 'Why version control',
            minutes: 10,
            text: '# Why version control\nGit records every change to a project as a snapshot called a commit. You can see who changed what, when and why, and you can always go back.\n\n- Work safely: mistakes can be undone\n- Work together: changes from several people are merged\n- Explain your work: commit messages tell the story',
          },
          {
            title: 'Commits and good messages',
            minutes: 15,
            text: '# Commits\nStage the files you changed with git add, then record them with git commit.\n\nA good message has a short summary line (under 60 characters) written as an instruction, e.g. "Add contact form validation", followed by a blank line and a short explanation of why.',
          },
        ],
      },
      {
        title: 'Collaborating on GitHub',
        lessons: [
          {
            title: 'Branches and pull requests',
            minutes: 15,
            text: '# Branches\nCreate a branch for each piece of work so main always stays deployable.\n\n# Pull requests\nPush your branch and open a pull request. Describe what changed and how to test it. A teammate reviews it before it is merged.',
          },
          {
            title: 'Reviewing code',
            minutes: 10,
            text: 'Good reviews are specific and kind. Comment on the code, not the person, explain why a change helps, and approve when it is good enough — not perfect.',
            link: 'https://docs.github.com/en/pull-requests',
          },
        ],
      },
    ],
    quiz: {
      title: 'Git check',
      passing: 70,
      attempts: 3,
      minutes: 10,
      questions: [
        { q: 'What does a commit record?', type: 'MULTIPLE_CHOICE', options: ['A snapshot of staged changes', 'A deployment', 'A chat message'], correct: [0] },
        { q: 'Work for a new feature should happen on its own branch.', type: 'TRUE_FALSE', correct: [0] },
        { q: 'Which git command records staged changes?', type: 'SHORT_ANSWER', accepted: ['git commit', 'commit'], explanation: 'git commit records what you staged with git add.' },
      ],
    },
    assignment: {
      title: 'Open your first pull request',
      instructions: 'Create a small repository, add a README on a branch and open a pull request against main.\n\n- Link the pull request in your submission\n- Use a clear commit message',
      points: 10,
      rubric: '4 points: working branch and pull request\n3 points: clear commit messages\n3 points: helpful pull request description',
      dueDays: 7,
    },
  },
  {
    key: 'communication',
    title: 'Professional Communication',
    category: 'communication',
    difficulty: 'BEGINNER',
    required: true,
    description: 'Clear updates, effective meetings and asking for help early.',
    modules: [
      {
        title: 'Writing at work',
        lessons: [
          {
            title: 'Writing clear updates',
            minutes: 12,
            text: '# Lead with the point\nStart with what the reader needs: the status, the decision or the question. Then add detail.\n\n- Done: what you finished\n- Next: what you are working on\n- Blocked: what you need and from whom',
          },
          {
            title: 'Email and chat etiquette',
            minutes: 10,
            text: 'Use a specific subject line, keep messages short and reply within one working day. Move long discussions to a call and write down the outcome.',
          },
        ],
      },
      {
        title: 'Working with people',
        lessons: [
          {
            title: 'Meetings that work',
            minutes: 12,
            text: 'Come prepared, know the goal of the meeting and leave with clear next steps and owners. If you were not needed, it is fine to say so next time.',
          },
          {
            title: 'Asking for help',
            minutes: 8,
            text: 'Ask early. Share what you tried, what you expected and what happened instead. Asking good questions is a skill, not a weakness.',
          },
        ],
      },
    ],
    quiz: {
      title: 'Communication check',
      passing: 70,
      attempts: null,
      minutes: null,
      questions: [
        { q: 'What should a status update start with?', type: 'MULTIPLE_CHOICE', options: ['The main point or status', 'A long background', 'An apology'], correct: [0] },
        { q: 'It is better to wait until you are completely stuck before asking for help.', type: 'TRUE_FALSE', correct: [1] },
        { q: 'Which belong in a good help request? (choose all)', type: 'MULTIPLE_CHOICE', options: ['What you tried', 'What you expected', 'What happened instead', 'Your favourite colour'], correct: [0, 1, 2] },
      ],
    },
    assignment: {
      title: 'Write a weekly status update',
      instructions: 'Write a short update for your manager using the Done / Next / Blocked format.',
      points: null,
      dueDays: 5,
    },
  },
  {
    key: 'digital-marketing',
    title: 'Introduction to Digital Marketing',
    category: 'marketing',
    difficulty: 'BEGINNER',
    description: 'Channels, audiences, campaigns and the metrics that matter.',
    modules: [
      {
        title: 'Foundations',
        lessons: [
          { title: 'The marketing funnel', minutes: 15, text: 'Awareness, consideration, conversion and loyalty. Each stage needs different content and different measures.' },
          { title: 'Knowing your audience', minutes: 15, text: 'Write down who the customer is, what problem they have and where they spend time online. Every campaign starts here.' },
        ],
      },
      {
        title: 'Channels and measurement',
        lessons: [
          { title: 'Choosing channels', minutes: 15, text: '- Search: people looking for a solution\n- Social: discovery and community\n- Email: relationships with people who opted in' },
          { title: 'Metrics that matter', minutes: 15, text: 'Prefer outcome metrics (leads, sales, sign-ups) over vanity metrics (likes). Always compare against a goal.' },
        ],
      },
    ],
    quiz: {
      title: 'Digital marketing check',
      passing: 70,
      attempts: 3,
      minutes: 15,
      questions: [
        { q: 'Which is an outcome metric?', type: 'MULTIPLE_CHOICE', options: ['Likes', 'Qualified leads', 'Impressions'], correct: [1] },
        { q: 'Every campaign should start from a clear audience.', type: 'TRUE_FALSE', correct: [0] },
        { q: 'Name the first stage of the marketing funnel.', type: 'SHORT_ANSWER', accepted: ['awareness'] },
      ],
    },
  },
  {
    key: 'ai',
    title: 'AI Fundamentals',
    category: 'ai',
    difficulty: 'INTERMEDIATE',
    description: 'What machine learning is, how models learn, and how to use AI responsibly.',
    modules: [
      {
        title: 'How machines learn',
        lessons: [
          { title: 'What is machine learning', minutes: 20, text: 'Machine learning finds patterns in examples instead of following hand-written rules. A model is trained on data and then makes predictions on new data.' },
          { title: 'Training and evaluation', minutes: 20, text: 'Split data into training and test sets. A model that does well on training data but badly on test data is overfitting.' },
        ],
      },
      {
        title: 'Using AI responsibly',
        lessons: [
          { title: 'Bias and fairness', minutes: 15, text: 'Models learn the biases in their data. Check results across different groups and keep a human in the loop for important decisions.' },
          { title: 'Working with AI assistants', minutes: 15, text: 'Treat AI output as a draft: check facts, never paste confidential client data into public tools, and say when AI helped.' },
        ],
      },
    ],
    quiz: {
      title: 'AI fundamentals check',
      passing: 70,
      attempts: 3,
      minutes: 15,
      questions: [
        { q: 'A model that is great on training data but poor on new data is…', type: 'MULTIPLE_CHOICE', options: ['Overfitting', 'Underfitting', 'Perfect'], correct: [0] },
        { q: 'It is fine to paste confidential client data into any public AI tool.', type: 'TRUE_FALSE', correct: [1] },
        { q: 'Data used to check a model after training is called the … set.', type: 'SHORT_ANSWER', accepted: ['test', 'test set', 'validation'] },
      ],
    },
  },
  {
    key: 'frontend',
    title: 'Frontend Development Foundations',
    category: 'engineering',
    difficulty: 'INTERMEDIATE',
    description: 'Semantic HTML, modern CSS layout, accessible components and component thinking.',
    modules: [
      {
        title: 'HTML and CSS',
        lessons: [
          { title: 'Semantic HTML', minutes: 20, text: 'Use elements for their meaning: header, nav, main, button, label. Semantic HTML is the base of accessibility and SEO.' },
          { title: 'Layout with flexbox and grid', minutes: 25, text: 'Flexbox lays out items in one direction; grid lays out rows and columns. Design for small screens first.' },
        ],
      },
      {
        title: 'Components and accessibility',
        lessons: [
          { title: 'Accessible components', minutes: 20, text: '- Every input has a label\n- Everything works with the keyboard\n- Colour is never the only signal\n- Images have useful alt text' },
          { title: 'Thinking in components', minutes: 20, text: 'Break a page into small reusable pieces with clear inputs (props). Keep state where it is used.' },
        ],
      },
    ],
    quiz: {
      title: 'Frontend check',
      passing: 70,
      attempts: 3,
      minutes: 15,
      questions: [
        { q: 'Which element should trigger an action?', type: 'MULTIPLE_CHOICE', options: ['<div onclick>', '<button>', '<span>'], correct: [1] },
        { q: 'Colour alone is enough to show an error.', type: 'TRUE_FALSE', correct: [1] },
        { q: 'Which CSS layout handles rows and columns together?', type: 'SHORT_ANSWER', accepted: ['grid', 'css grid'] },
      ],
    },
    assignment: {
      title: 'Build an accessible signup section',
      instructions: 'Build a responsive signup section with a labelled email field and a button. It must work with the keyboard. Share a link to the code.',
      points: 20,
      rubric: '8 points: semantic, accessible markup\n6 points: responsive layout\n6 points: clean, readable code',
      dueDays: 10,
    },
  },
  {
    key: 'seo',
    title: 'SEO Fundamentals',
    category: 'marketing',
    difficulty: 'BEGINNER',
    description: 'How search engines rank pages, keyword research and on-page basics.',
    modules: [
      {
        title: 'How search works',
        lessons: [
          { title: 'Crawling, indexing and ranking', minutes: 15, text: 'Search engines crawl pages, store them in an index and rank them for each query by relevance and quality.' },
          { title: 'Keyword research', minutes: 20, text: 'Find the words people actually search for. Balance search volume, competition and intent.' },
        ],
      },
      {
        title: 'On-page SEO',
        lessons: [
          { title: 'Titles, headings and meta descriptions', minutes: 15, text: 'Each page needs one clear title, a single H1 and a meta description that makes people want to click.' },
          { title: 'Writing for people first', minutes: 10, text: 'Answer the searcher’s question clearly. Content written for people ranks better than content stuffed with keywords.' },
        ],
      },
    ],
    quiz: {
      title: 'SEO check',
      passing: 70,
      attempts: 3,
      minutes: null,
      questions: [
        { q: 'How many H1 headings should a page usually have?', type: 'MULTIPLE_CHOICE', options: ['One', 'Five', 'None'], correct: [0] },
        { q: 'Keyword stuffing improves rankings.', type: 'TRUE_FALSE', correct: [1] },
        { q: 'The stored copy of pages a search engine ranks from is the …', type: 'SHORT_ANSWER', accepted: ['index'] },
      ],
    },
  },
  {
    key: 'content',
    title: 'Content Strategy',
    category: 'marketing',
    difficulty: 'INTERMEDIATE',
    description: 'Planning content with pillars, calendars and a consistent brand voice.',
    modules: [
      {
        title: 'Planning',
        lessons: [
          { title: 'Content pillars', minutes: 15, text: 'Pick three to five themes your brand is known for. Every post should fit at least one pillar.' },
          { title: 'Building a content calendar', minutes: 20, text: 'Plan a month ahead: date, channel, pillar, format, owner and status.' },
        ],
      },
      {
        title: 'Voice and repurposing',
        lessons: [
          { title: 'Brand voice', minutes: 15, text: 'Write three adjectives that describe the voice and examples of what it is and is not.' },
          { title: 'Repurposing content', minutes: 15, text: 'Turn one long piece into many: a blog post becomes a carousel, a short video and a newsletter section.' },
        ],
      },
    ],
    quiz: {
      title: 'Content strategy check',
      passing: 70,
      attempts: 3,
      minutes: null,
      questions: [
        { q: 'How many content pillars are typical?', type: 'MULTIPLE_CHOICE', options: ['3–5', '20', '1'], correct: [0] },
        { q: 'Repurposing means reusing one idea across formats.', type: 'TRUE_FALSE', correct: [0] },
      ],
    },
    assignment: {
      title: 'Plan a two-week content calendar',
      instructions: 'Plan two weeks of posts for a client of your choice: date, channel, pillar, format and caption idea.',
      points: 10,
      rubric: '4 points: clear pillars\n3 points: realistic schedule\n3 points: on-brand ideas',
      dueDays: 7,
    },
  },
  {
    key: 'security',
    title: 'Cybersecurity Awareness',
    category: 'security',
    difficulty: 'BEGINNER',
    required: true,
    description: 'Passwords, phishing and handling client data safely.',
    modules: [
      {
        title: 'Everyday security',
        lessons: [
          { title: 'Strong passwords and 2FA', minutes: 10, text: 'Use a password manager, a different password for every account and two-factor authentication wherever it is offered.' },
          { title: 'Spotting phishing', minutes: 12, text: '- Unexpected urgency\n- Links that do not match the sender\n- Requests for passwords or payments\nWhen in doubt, check with the sender another way.' },
        ],
      },
      {
        title: 'Protecting client data',
        lessons: [
          { title: 'Handling confidential information', minutes: 10, text: 'Share client files only through approved tools, never on personal accounts, and only with people who need them.' },
          { title: 'Reporting incidents', minutes: 8, text: 'Report anything suspicious to HR or your manager straight away. Reporting early is always the right call.' },
        ],
      },
    ],
    quiz: {
      title: 'Security awareness check',
      passing: 80,
      attempts: null,
      minutes: 10,
      questions: [
        { q: 'What should you do with an unexpected email asking for your password?', type: 'MULTIPLE_CHOICE', options: ['Reply with it', 'Report it and do not click', 'Forward it to friends'], correct: [1] },
        { q: 'Using the same password everywhere is safe if it is long.', type: 'TRUE_FALSE', correct: [1] },
        { q: 'What does 2FA stand for?', type: 'SHORT_ANSWER', accepted: ['two-factor authentication', 'two factor authentication', '2 factor authentication'] },
      ],
    },
  },
]

const PATHS = [
  { key: 'frontend', name: 'Frontend Intern Foundation', position: 'web-development-intern', department: 'development', courses: ['communication', 'git', 'frontend', 'security'] },
  { key: 'marketing', name: 'Digital Marketing Intern Foundation', position: 'digital-marketing-intern', department: 'marketing', courses: ['communication', 'digital-marketing', 'seo', 'content'] },
  { key: 'ai', name: 'AI/ML Intern Foundation', position: 'ai-ml-intern', department: 'development', courses: ['communication', 'git', 'ai', 'security'] },
  { key: 'creative', name: 'Creative Intern Foundation', position: 'graphic-design-intern', department: 'design', courses: ['communication', 'content', 'security'] },
] as const

const id = {
  course: (k: string) => seedId(`p6:course:${k}`),
  module: (k: string, i: number) => seedId(`p6:module:${k}:${i}`),
  lesson: (k: string, m: number, l: number) => seedId(`p6:lesson:${k}:${m}:${l}`),
  quiz: (k: string) => seedId(`p6:quiz:${k}`),
  question: (k: string, i: number) => seedId(`p6:question:${k}:${i}`),
  option: (k: string, i: number, o: number) => seedId(`p6:option:${k}:${i}:${o}`),
  assignment: (k: string) => seedId(`p6:assignment:${k}`),
}

export async function seedLearningPerformance(prisma: PrismaClient, input: Input) {
  const { organizationId: org, userIds, internIds, now } = input
  const today = dateFrom(now, 0)

  // ── Catalog ──────────────────────────────────────────────────────────────
  const categoryIds: Record<string, string> = {}
  for (const [index, [slug, name, description]] of CATEGORIES.entries()) {
    const row = await prisma.courseCategory.upsert({
      where: { organization_id_slug: { organization_id: org, slug } },
      update: {},
      create: { id: seedId(`p6:category:${slug}`), organization_id: org, slug, name, description, sort_order: index },
      select: { id: true },
    })
    categoryIds[slug] = row.id
  }

  for (const course of COURSES) {
    const courseId = id.course(course.key)
    const minutes = course.modules.flatMap((m) => m.lessons).reduce((s, l) => s + l.minutes, 0)
    const values = {
      title: course.title,
      description: course.description,
      category_id: categoryIds[course.category],
      difficulty: course.difficulty,
      estimated_minutes: minutes,
      is_required: Boolean(course.required),
      is_sequential: true,
      require_quizzes: true,
      require_assignments: Boolean(course.assignment),
      status: 'PUBLISHED' as const,
    }
    await prisma.course.upsert({
      where: { id: courseId },
      update: values,
      create: {
        id: courseId,
        organization_id: org,
        slug: course.key === 'git' ? 'git-github-fundamentals' : course.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        published_at: daysFrom(now, -60),
        created_by: userIds.hr,
        ...values,
      },
    })
    for (const [m, module] of course.modules.entries()) {
      const moduleId = id.module(course.key, m)
      await prisma.courseModule.upsert({
        where: { id: moduleId },
        update: { title: module.title, position: m },
        create: { id: moduleId, course_id: courseId, title: module.title, position: m },
      })
      for (const [l, lesson] of module.lessons.entries()) {
        const lessonId = id.lesson(course.key, m, l)
        const data = {
          course_id: courseId,
          module_id: moduleId,
          title: lesson.title,
          content_type: lesson.link ? ('LINK' as const) : ('TEXT' as const),
          content: lesson.text,
          link_url: lesson.link ?? null,
          sort_order: l,
          estimated_minutes: lesson.minutes,
          is_required: true,
        }
        await prisma.lesson.upsert({ where: { id: lessonId }, update: data, create: { id: lessonId, ...data } })
      }
    }
    const quizId = id.quiz(course.key)
    const quizData = {
      course_id: courseId,
      module_id: id.module(course.key, course.modules.length - 1),
      title: course.quiz.title,
      passing_score: course.quiz.passing,
      attempt_limit: course.quiz.attempts,
      time_limit_minutes: course.quiz.minutes,
      answer_policy: 'AFTER_SUBMISSION' as const,
      status: 'PUBLISHED' as const,
      is_required: true,
    }
    await prisma.quiz.upsert({ where: { id: quizId }, update: quizData, create: { id: quizId, ...quizData } })
    for (const [i, question] of course.quiz.questions.entries()) {
      const questionId = id.question(course.key, i)
      const data = {
        quiz_id: quizId,
        question: question.q,
        question_type: question.type,
        points: 1,
        position: i,
        explanation: question.explanation ?? null,
        accepted_answers: question.accepted ?? [],
      }
      await prisma.quizQuestion.upsert({ where: { id: questionId }, update: data, create: { id: questionId, ...data } })
      const options = question.type === 'TRUE_FALSE' ? ['True', 'False'] : (question.options ?? [])
      for (const [o, text] of options.entries()) {
        const optionId = id.option(course.key, i, o)
        const optionData = { question_id: questionId, option_text: text, is_correct: (question.correct ?? []).includes(o), position: o }
        await prisma.quizOption.upsert({ where: { id: optionId }, update: optionData, create: { id: optionId, ...optionData } })
      }
    }
    if (course.assignment) {
      const assignmentId = id.assignment(course.key)
      const data = {
        course_id: courseId,
        module_id: null,
        title: course.assignment.title,
        instructions: course.assignment.instructions,
        due_days: course.assignment.dueDays,
        max_points: course.assignment.points,
        rubric: course.assignment.rubric ?? null,
        is_required: true,
      }
      await prisma.learningAssignment.upsert({ where: { id: assignmentId }, update: data, create: { id: assignmentId, ...data } })
    }
  }

  // ── Paths ────────────────────────────────────────────────────────────────
  const pathIds: Record<string, string> = {}
  for (const path of PATHS) {
    const pathId = seedId(`p6:path:${path.key}`)
    pathIds[path.key] = pathId
    const values = {
      name: path.name,
      description: `The courses every ${path.name.replace(' Foundation', '').toLowerCase()} completes in their first weeks.`,
      department_id: input.departmentIds[path.department] ?? null,
      position_id: input.positionIds[path.position] ?? null,
      status: 'PUBLISHED' as const,
    }
    await prisma.learningPath.upsert({
      where: { id: pathId },
      update: values,
      create: { id: pathId, organization_id: org, slug: path.key + '-intern-foundation', created_by: userIds.hr, ...values },
    })
    await prisma.learningPathCourse.deleteMany({ where: { learning_path_id: pathId } })
    await prisma.learningPathCourse.createMany({
      data: path.courses.map((c, position) => ({
        id: seedId(`p6:path-course:${path.key}:${c}`),
        learning_path_id: pathId,
        course_id: id.course(c),
        position,
        is_required: true,
        requires_previous: position > 0,
        due_days: (position + 1) * 7,
      })),
    })
  }

  // ── Required training ────────────────────────────────────────────────────
  const rules = {
    security: seedId('p6:rule:security'),
    communication: seedId('p6:rule:communication'),
  }
  for (const [key, ruleId] of Object.entries(rules)) {
    const data = { course_id: id.course(key), target_type: 'EVERYONE' as const, target_id: null, due_days: 14, is_active: true }
    await prisma.requiredTrainingRule.upsert({
      where: { id: ruleId },
      update: data,
      create: { id: ruleId, organization_id: org, created_by: userIds.hr, ...data },
    })
  }

  // ── Enrollments and progress (status from the real completion rule) ────
  // Reset this seed's learner records so progress is recomputed consistently.
  const learners = ['intern', 'ishaan', 'zara', 'neel', 'tara']
  const learnerIds = learners.map((k) => userIds[k])
  const seededCourseIds = COURSES.map((c) => id.course(c.key))
  await prisma.quizAnswer.deleteMany({ where: { attempt: { user_id: { in: learnerIds }, quiz_id: { in: COURSES.map((c) => id.quiz(c.key)) } } } })
  await prisma.quizAttempt.deleteMany({ where: { user_id: { in: learnerIds }, quiz_id: { in: COURSES.map((c) => id.quiz(c.key)) } } })
  await prisma.learningAssignmentSubmission.deleteMany({
    where: { user_id: { in: learnerIds }, assignment_id: { in: COURSES.filter((c) => c.assignment).map((c) => id.assignment(c.key)) } },
  })
  await prisma.learningProgress.deleteMany({ where: { user_id: { in: learnerIds }, course_id: { in: seededCourseIds } } })
  await prisma.courseEnrollment.deleteMany({ where: { user_id: { in: learnerIds }, course_id: { in: seededCourseIds } } })
  await prisma.learningPlan.deleteMany({ where: { id: { in: learners.map((k) => seedId(`p6:plan:${k}`)) } } })

  /** Learner state per course: lessons done (count), quiz result, assignment state. */
  type State = {
    type: 'REQUIRED' | 'ASSIGNED' | 'SELF_ENROLLED'
    lessons: number
    quiz?: 'PASS' | 'FAIL'
    assignment?: 'SUBMITTED' | 'APPROVED'
    assignedDaysAgo: number
    dueInDays?: number | null
    plan?: string
  }
  const plan: Record<string, Record<string, State>> = {
    intern: {
      communication: { type: 'REQUIRED', lessons: 4, quiz: 'PASS', assignment: 'APPROVED', assignedDaysAgo: 2, dueInDays: 12 },
      security: { type: 'REQUIRED', lessons: 1, assignedDaysAgo: 2, dueInDays: 12 },
      git: { type: 'ASSIGNED', lessons: 2, assignedDaysAgo: 2, dueInDays: 5, plan: 'frontend' },
      frontend: { type: 'ASSIGNED', lessons: 0, assignedDaysAgo: 2, dueInDays: 19, plan: 'frontend' },
    },
    ishaan: {
      communication: { type: 'REQUIRED', lessons: 4, quiz: 'PASS', assignment: 'APPROVED', assignedDaysAgo: 40, dueInDays: -26 },
      security: { type: 'REQUIRED', lessons: 4, quiz: 'PASS', assignedDaysAgo: 40, dueInDays: -26 },
      'digital-marketing': { type: 'ASSIGNED', lessons: 4, quiz: 'PASS', assignedDaysAgo: 30, dueInDays: -9, plan: 'marketing' },
      seo: { type: 'ASSIGNED', lessons: 4, quiz: 'FAIL', assignedDaysAgo: 30, dueInDays: -2, plan: 'marketing' },
      content: { type: 'ASSIGNED', lessons: 4, quiz: 'PASS', assignment: 'SUBMITTED', assignedDaysAgo: 30, dueInDays: 5, plan: 'marketing' },
    },
    zara: {
      communication: { type: 'REQUIRED', lessons: 2, assignedDaysAgo: 18, dueInDays: -4 },
      security: { type: 'REQUIRED', lessons: 4, quiz: 'PASS', assignedDaysAgo: 18, dueInDays: -4 },
      content: { type: 'ASSIGNED', lessons: 1, assignedDaysAgo: 15, dueInDays: 6, plan: 'creative' },
    },
    neel: {
      communication: { type: 'REQUIRED', lessons: 4, quiz: 'PASS', assignment: 'SUBMITTED', assignedDaysAgo: 10, dueInDays: 4 },
      security: { type: 'REQUIRED', lessons: 0, assignedDaysAgo: 10, dueInDays: 4 },
      ai: { type: 'ASSIGNED', lessons: 3, assignedDaysAgo: 10, dueInDays: 11, plan: 'ai' },
      git: { type: 'SELF_ENROLLED', lessons: 4, quiz: 'PASS', assignedDaysAgo: 9 },
    },
    tara: {
      communication: { type: 'REQUIRED', lessons: 4, quiz: 'PASS', assignment: 'APPROVED', assignedDaysAgo: 70, dueInDays: -56 },
      security: { type: 'REQUIRED', lessons: 4, quiz: 'PASS', assignedDaysAgo: 70, dueInDays: -56 },
      seo: { type: 'SELF_ENROLLED', lessons: 4, quiz: 'PASS', assignedDaysAgo: 50 },
    },
  }

  let enrollments = 0
  let completions = 0
  for (const [who, courses] of Object.entries(plan)) {
    const userId = userIds[who]
    const planPath = Object.values(courses).find((c) => c.plan)?.plan
    let planId: string | null = null
    if (planPath) {
      planId = seedId(`p6:plan:${who}`)
      const path = PATHS.find((p) => p.key === planPath)!
      const assigned = Math.max(...Object.values(courses).filter((c) => c.plan).map((c) => c.assignedDaysAgo))
      await prisma.learningPlan.create({
        data: {
          id: planId,
          organization_id: org,
          user_id: userId,
          learning_path_id: pathIds[planPath],
          path_name: path.name,
          assigned_by: userIds.hr,
          assigned_at: daysFrom(now, -assigned),
          items: {
            create: path.courses.map((c, position) => ({
              course_id: id.course(c),
              position,
              is_required: true,
              prerequisite_course_id: position > 0 ? id.course(path.courses[position - 1]) : null,
              due_date: dateFrom(now, -assigned + (position + 1) * 7),
            })),
          },
        },
      })
    }
    for (const [key, state] of Object.entries(courses)) {
      const course = COURSES.find((c) => c.key === key)!
      const courseId = id.course(key)
      const assignedAt = daysFrom(now, -state.assignedDaysAgo)
      const lessonIds = course.modules.flatMap((m, mi) => m.lessons.map((_, li) => id.lesson(key, mi, li)))
      const done = lessonIds.slice(0, state.lessons)
      for (const [index, lessonId] of done.entries()) {
        const at = daysFrom(now, -state.assignedDaysAgo + Math.min(index + 1, state.assignedDaysAgo))
        await prisma.learningProgress.create({
          data: { user_id: userId, course_id: courseId, lesson_id: lessonId, status: 'COMPLETED', progress_percent: 100, started_at: at, completed_at: at, last_accessed_at: at },
        })
      }
      const quizId = id.quiz(key)
      if (state.quiz) {
        const pass = state.quiz === 'PASS'
        const questions = course.quiz.questions
        const correct = pass ? questions.length : Math.max(0, Math.floor(questions.length / 3))
        const at = daysFrom(now, -Math.max(1, state.assignedDaysAgo - 5))
        const attemptId = seedId(`p6:attempt:${who}:${key}`)
        await prisma.quizAttempt.create({
          data: {
            id: attemptId,
            quiz_id: quizId,
            user_id: userId,
            attempt_number: 1,
            status: 'SUBMITTED',
            score: correct,
            max_score: questions.length,
            percentage: Math.floor((correct / questions.length) * 100),
            passed: pass && Math.floor((correct / questions.length) * 100) >= course.quiz.passing,
            started_at: at,
            submitted_at: at,
            attempted_at: at,
          },
        })
        await prisma.quizAnswer.createMany({
          data: questions.map((q, i) => {
            const right = i < correct
            const options = q.type === 'TRUE_FALSE' ? ['True', 'False'] : (q.options ?? [])
            const correctIdx = q.correct ?? []
            const chosen = right ? correctIdx : options.map((_, o) => o).filter((o) => !correctIdx.includes(o)).slice(0, 1)
            return {
              attempt_id: attemptId,
              question_id: id.question(key, i),
              selected_option_ids: q.type === 'SHORT_ANSWER' ? [] : chosen.map((o) => id.option(key, i, o)),
              text_answer: q.type === 'SHORT_ANSWER' ? (right ? (q.accepted?.[0] ?? '') : 'not sure') : null,
              is_correct: right,
              points_awarded: right ? 1 : 0,
            }
          }),
        })
      }
      if (state.assignment && course.assignment) {
        const approved = state.assignment === 'APPROVED'
        const submittedAt = daysFrom(now, -Math.max(1, state.assignedDaysAgo - 6))
        const reviewer = ['intern', 'neel'].includes(who) ? userIds.devMentor : userIds.mentor
        const points = approved && course.assignment.points ? course.assignment.points - 1 : null
        await prisma.learningAssignmentSubmission.create({
          data: {
            id: seedId(`p6:submission:${who}:${key}`),
            organization_id: org,
            assignment_id: id.assignment(key),
            user_id: userId,
            status: approved ? 'APPROVED' : 'SUBMITTED',
            current_version: 1,
            points_awarded: points,
            reviewed_by: approved ? reviewer : null,
            reviewed_at: approved ? daysFrom(now, -Math.max(0, state.assignedDaysAgo - 7)) : null,
            review_comment: approved ? 'Clear and well structured — nice work.' : null,
            versions: {
              create: {
                version_number: 1,
                message:
                  key === 'communication'
                    ? 'Done: finished onboarding tasks and the first design review.\nNext: start the landing page section.\nBlocked: waiting for brand assets.'
                    : 'Here is my plan, with the reasoning for each choice in the notes.',
                status: approved ? 'APPROVED' : 'SUBMITTED',
                submitted_by: userId,
                submitted_at: submittedAt,
                reviewed_by: approved ? reviewer : null,
                reviewed_at: approved ? daysFrom(now, -Math.max(0, state.assignedDaysAgo - 7)) : null,
                review_comment: approved ? 'Clear and well structured — nice work.' : null,
                points_awarded: points,
              },
            },
          },
        })
      }
      // Same rule as the app (src/lib/learning/rules.ts).
      const result = evaluateCompletion({
        lessons: lessonIds.map((l) => ({ id: l, required: true })),
        quizzes: [{ id: quizId, required: true }],
        assignments: course.assignment ? [{ id: id.assignment(key), required: true }] : [],
        completedLessonIds: new Set(done),
        passedQuizIds: new Set(state.quiz === 'PASS' ? [quizId] : []),
        approvedAssignmentIds: new Set(state.assignment === 'APPROVED' ? [id.assignment(key)] : []),
        requireQuizzes: true,
        requireAssignments: Boolean(course.assignment),
      })
      const started = state.lessons > 0
      await prisma.courseEnrollment.create({
        data: {
          id: seedId(`p6:enrollment:${who}:${key}`),
          organization_id: org,
          course_id: courseId,
          user_id: userId,
          enrollment_type: state.type,
          status: result.complete ? 'COMPLETED' : started ? 'IN_PROGRESS' : 'NOT_STARTED',
          progress_percentage: result.complete ? 100 : result.progress,
          assigned_by: state.type === 'SELF_ENROLLED' ? null : userIds.hr,
          assigned_at: assignedAt,
          due_date: state.dueInDays === undefined || state.dueInDays === null ? null : dateFrom(now, state.dueInDays),
          started_at: started ? daysFrom(now, -state.assignedDaysAgo + 1) : null,
          completed_at: result.complete ? daysFrom(now, -Math.max(0, state.assignedDaysAgo - 8)) : null,
          learning_plan_id: state.plan ? planId : null,
          required_rule_id: state.type === 'REQUIRED' ? rules[key as keyof typeof rules] ?? null : null,
        },
      })
      enrollments++
      if (result.complete) completions++
    }
  }

  // ── Goals ────────────────────────────────────────────────────────────────
  await prisma.goalEvidence.deleteMany({ where: { goal: { id: { in: ['g1', 'g2', 'g3', 'g4', 'g5'].map((g) => seedId(`p6:goal:${g}`)) } } } })
  const goals = [
    { key: 'g1', who: 'intern', by: 'devMentor', title: 'Ship my first production pull request', category: 'TECHNICAL', status: 'IN_PROGRESS', progress: 25, target: 21 },
    { key: 'g2', who: 'intern', by: 'intern', title: 'Complete the Frontend Intern Foundation path', category: 'LEARNING', status: 'IN_PROGRESS', progress: 25, target: 28 },
    { key: 'g3', who: 'ishaan', by: 'manager', title: 'Grow the client Instagram engagement rate', category: 'PROJECT', status: 'AT_RISK', progress: 50, target: 10 },
    { key: 'g4', who: 'ishaan', by: 'mentor', title: 'Present a campaign recap to the team', category: 'COMMUNICATION', status: 'COMPLETED', progress: 100, target: -5 },
    { key: 'g5', who: 'tara', by: 'manager', title: 'Publish four long-form blog posts', category: 'PROJECT', status: 'IN_PROGRESS', progress: 75, target: 7 },
  ] as const
  for (const g of goals) {
    const goalId = seedId(`p6:goal:${g.key}`)
    const data = {
      organization_id: org,
      intern_id: internIds[g.who],
      owner_id: userIds[g.who],
      created_by: userIds[g.by],
      title: g.title,
      description: 'Success looks like: agreed with your manager or mentor, with evidence linked below.',
      category: g.category,
      status: g.status,
      progress: g.progress,
      start_date: dateFrom(now, -14),
      target_date: dateFrom(now, g.target),
      completed_at: g.status === 'COMPLETED' ? daysFrom(now, -6) : null,
    }
    await prisma.performanceGoal.upsert({ where: { id: goalId }, update: data, create: { id: goalId, ...data } })
  }
  await prisma.goalEvidence.createMany({
    data: [
      { goal_id: seedId('p6:goal:g2'), evidence_type: 'COURSE', reference_id: id.course('communication'), note: 'Required training done.', added_by: userIds.intern },
      { goal_id: seedId('p6:goal:g1'), evidence_type: 'NOTE', note: 'Paired on the review checklist — next step is a small bug fix.', added_by: userIds.devMentor },
      { goal_id: seedId('p6:goal:g4'), evidence_type: 'LINK', url: 'https://example.com/campaign-recap', note: 'Slides from the recap.', added_by: userIds.ishaan },
      { goal_id: seedId('p6:goal:g3'), evidence_type: 'NOTE', note: 'Engagement dipped after the posting schedule changed.', added_by: userIds.manager },
    ],
  })

  // ── Weekly check-ins ─────────────────────────────────────────────────────
  const thisWeek = weekStart(today)
  const checkins = [
    { who: 'ishaan', week: -7, status: 'REVIEWED', reviewer: 'manager' },
    { who: 'ishaan', week: 0, status: 'SUBMITTED', reviewer: null },
    { who: 'zara', week: -7, status: 'SUBMITTED', reviewer: null },
    { who: 'neel', week: -7, status: 'REVIEWED', reviewer: 'devManager' },
    { who: 'tara', week: 0, status: 'SUBMITTED', reviewer: null },
    { who: 'intern', week: -7, status: 'REVIEWED', reviewer: 'devMentor' },
  ] as const
  for (const c of checkins) {
    const week = new Date(thisWeek.getTime() + c.week * 86_400_000)
    const checkinId = seedId(`p6:checkin:${c.who}:${c.week}`)
    const reviewed = c.status === 'REVIEWED'
    const data = {
      organization_id: org,
      intern_id: internIds[c.who],
      week_start: week,
      status: c.status,
      accomplishments: 'Finished the tasks planned for the week and closed two review comments.',
      current_work: 'Next deliverable for the current project.',
      learning: 'Picked up a new shortcut for organising my work and learned from the code/design review.',
      blockers: c.who === 'zara' ? 'Waiting on final brand colours from the client.' : null,
      support_needed: c.who === 'zara' ? 'A quick call to agree the colour direction.' : null,
      next_week_priorities: 'Finish the open task and start the next course module.',
      submitted_at: daysFrom(week, 4),
      reviewed_by: reviewed && c.reviewer ? userIds[c.reviewer] : null,
      reviewed_at: reviewed ? daysFrom(week, 5) : null,
      review_comment: reviewed ? 'Good progress this week — keep sharing blockers early.' : null,
    }
    await prisma.weeklyCheckin.upsert({
      where: { intern_id_week_start: { intern_id: internIds[c.who], week_start: week } },
      update: data,
      create: { id: checkinId, ...data },
    })
  }

  // ── Feedback and requests ────────────────────────────────────────────────
  const feedback = [
    { key: 'f1', from: 'manager', to: 'ishaan', type: 'POSITIVE', vis: 'SHARED_WITH_INTERN', ctx: 'GOAL', ctxId: seedId('p6:goal:g4'), body: 'Your campaign recap was clear and well paced — the team now uses your format.' },
    { key: 'f2', from: 'mentor', to: 'ishaan', type: 'DEVELOPMENTAL', vis: 'SHARED_WITH_INTERN', ctx: 'GENERAL', ctxId: null, body: 'Try sharing drafts earlier so feedback arrives before the deadline crunch.' },
    { key: 'f3', from: 'manager', to: 'ishaan', type: 'GENERAL', vis: 'PRIVATE', ctx: 'GENERAL', ctxId: null, body: 'Private note: check in about workload next week.' },
    { key: 'f4', from: 'hr', to: 'tara', type: 'GENERAL', vis: 'HR_ONLY', ctx: 'GENERAL', ctxId: null, body: 'HR note: discussed extension options; decision pending.' },
    { key: 'f5', from: 'devMentor', to: 'intern', type: 'POSITIVE', vis: 'SHARED_WITH_INTERN', ctx: 'GENERAL', ctxId: null, body: 'Great questions in your first week — you clearly read the material first.' },
    { key: 'f6', from: 'mentor', to: 'zara', type: 'DEVELOPMENTAL', vis: 'SHARED_WITH_MANAGER', ctx: 'GENERAL', ctxId: null, body: 'Zara would benefit from more structured briefs; worth raising in the next 1:1.' },
  ] as const
  for (const f of feedback) {
    const feedbackId = seedId(`p6:feedback:${f.key}`)
    const data = {
      organization_id: org,
      from_user_id: userIds[f.from],
      to_user_id: userIds[f.to],
      intern_id: internIds[f.to],
      category: f.type === 'POSITIVE' ? ('PRAISE' as const) : f.type === 'DEVELOPMENTAL' ? ('IMPROVEMENT' as const) : ('GENERAL' as const),
      feedback_type: f.type,
      visibility: f.vis,
      context_type: f.ctx,
      context_id: f.ctxId,
      body: f.body,
    }
    await prisma.feedback.upsert({ where: { id: feedbackId }, update: data, create: { id: feedbackId, ...data } })
  }
  const requestId = seedId('p6:feedback-request:intern')
  const requestData = {
    organization_id: org,
    requester_id: userIds.intern,
    recipient_id: userIds.devMentor,
    intern_id: internIds.intern,
    question: 'How was my first pull request description — what would make it easier to review?',
    status: 'OPEN' as const,
    due_date: dateFrom(now, 5),
  }
  await prisma.feedbackRequest.upsert({ where: { id: requestId }, update: requestData, create: { id: requestId, ...requestData } })

  // ── Review template, cycle and reviews ───────────────────────────────────
  const templateId = seedId('p6:template:standard')
  await prisma.performanceTemplate.upsert({
    where: { id: templateId },
    update: {},
    create: {
      id: templateId,
      organization_id: org,
      name: 'Standard intern review',
      description: 'Used for mid-point and final reviews. Ratings use the 1–5 scale.',
      created_by: userIds.hr,
    },
  })
  const sections: { key: string; title: string; respondents: ReviewRespondent[]; questions: { prompt: string; type: 'TEXT' | 'RATING' | 'BOOLEAN' | 'MULTI_SELECT'; guidance?: string; options?: string[]; evidence?: boolean }[] }[] = [
    {
      key: 'self',
      title: 'Self-reflection',
      respondents: ['SELF'],
      questions: [
        { prompt: 'What are you most proud of so far?', type: 'TEXT' },
        { prompt: 'Where would you like more support?', type: 'TEXT' },
        { prompt: 'Rate your confidence in your core role skills', type: 'RATING' },
      ],
    },
    {
      key: 'skills',
      title: 'Skills and ways of working',
      respondents: ['MANAGER', 'MENTOR'],
      questions: [
        { prompt: 'Quality of work', type: 'RATING', guidance: 'Work is accurate, complete and needs few revisions.', evidence: true },
        { prompt: 'Communication', type: 'RATING', guidance: 'Shares progress and blockers early and clearly.' },
        { prompt: 'Ownership', type: 'RATING', guidance: 'Takes responsibility for outcomes and follows through.' },
        { prompt: 'Strengths shown', type: 'MULTI_SELECT', options: ['Curiosity', 'Reliability', 'Creativity', 'Teamwork', 'Attention to detail'] },
      ],
    },
    {
      key: 'overall',
      title: 'Overall',
      respondents: ['MANAGER'],
      questions: [
        { prompt: 'Summary of performance this period', type: 'TEXT' },
        { prompt: 'On track to complete the internship successfully?', type: 'BOOLEAN' },
      ],
    },
    {
      key: 'hr',
      title: 'HR sign-off',
      respondents: ['HR'],
      questions: [{ prompt: 'HR notes (visible to HR only)', type: 'TEXT' }],
    },
  ]
  const questionIds: Record<string, string> = {}
  for (const [s, section] of sections.entries()) {
    const sectionId = seedId(`p6:section:${section.key}`)
    await prisma.performanceSection.upsert({
      where: { id: sectionId },
      update: { title: section.title, respondents: section.respondents, position: s },
      create: { id: sectionId, template_id: templateId, title: section.title, respondents: section.respondents, position: s },
    })
    for (const [q, question] of section.questions.entries()) {
      const questionId = seedId(`p6:rq:${section.key}:${q}`)
      questionIds[`${section.key}:${q}`] = questionId
      const data = {
        section_id: sectionId,
        prompt: question.prompt,
        question_type: question.type,
        guidance: question.guidance ?? null,
        options: question.options ?? [],
        is_required: true,
        requires_evidence: Boolean(question.evidence),
        position: q,
      }
      await prisma.performanceQuestion.upsert({ where: { id: questionId }, update: data, create: { id: questionId, ...data } })
    }
  }

  const cycleId = seedId('p6:cycle:midpoint')
  const cycleData = {
    name: 'Mid-point review',
    cycle_type: 'MIDPOINT' as const,
    status: 'OPEN' as const,
    template_id: templateId,
    start_date: dateFrom(now, -30),
    due_date: dateFrom(now, 10),
    opened_at: daysFrom(now, -7),
  }
  await prisma.performanceCycle.upsert({
    where: { id: cycleId },
    update: cycleData,
    create: { id: cycleId, organization_id: org, created_by: userIds.hr, ...cycleData },
  })
  const reviewKeys = ['intern', 'ishaan', 'zara', 'neel', 'tara']
  const reviewIds = reviewKeys.map((k) => seedId(`p6:review:${k}`))
  await prisma.developmentPlan.deleteMany({ where: { id: seedId('p6:devplan:tara') } })
  await prisma.performanceReviewRevision.deleteMany({ where: { review_id: { in: reviewIds } } })
  await prisma.performanceReviewAnswer.deleteMany({ where: { review_id: { in: reviewIds } } })
  const people: Record<string, { manager: string; mentor: string }> = {
    intern: { manager: 'devManager', mentor: 'devMentor' },
    ishaan: { manager: 'manager', mentor: 'mentor' },
    zara: { manager: 'manager', mentor: 'mentor' },
    neel: { manager: 'devManager', mentor: 'devMentor' },
    tara: { manager: 'manager', mentor: 'mentor' },
  }
  const stageOf: Record<string, { status: 'SELF_REVIEW' | 'MANAGER_REVIEW' | 'MENTOR_REVIEW' | 'HR_REVIEW' | 'COMPLETED'; submitted: ReviewRespondent[] }> = {
    intern: { status: 'SELF_REVIEW', submitted: [] },
    ishaan: { status: 'MANAGER_REVIEW', submitted: ['SELF'] },
    zara: { status: 'SELF_REVIEW', submitted: [] },
    neel: { status: 'MENTOR_REVIEW', submitted: ['SELF', 'MANAGER'] },
    tara: { status: 'COMPLETED', submitted: ['SELF', 'MANAGER', 'MENTOR', 'HR'] },
  }
  for (const key of reviewKeys) {
    const reviewId = seedId(`p6:review:${key}`)
    const stage = stageOf[key]
    const completed = stage.status === 'COMPLETED'
    const data = {
      organization_id: org,
      intern_id: internIds[key],
      reviewer_id: userIds[people[key].manager],
      mentor_id: userIds[people[key].mentor],
      cycle_id: cycleId,
      template_id: templateId,
      review_period_start: cycleData.start_date,
      review_period_end: cycleData.due_date,
      due_date: key === 'zara' ? dateFrom(now, -1) : cycleData.due_date,
      status: stage.status,
      stage_submitted: stage.submitted,
      submitted_at: stage.submitted.length ? daysFrom(now, -2) : null,
      completed_at: completed ? daysFrom(now, -1) : null,
      completed_by: completed ? userIds.hr : null,
      locked_at: completed ? daysFrom(now, -1) : null,
    }
    await prisma.performanceReview.upsert({ where: { id: reviewId }, update: data, create: { id: reviewId, ...data } })
    const answers: { question: string; respondent: ReviewRespondent; author: string; rating?: number; text?: string; bool?: boolean; selected?: string[]; evidence?: string }[] = []
    const add = (respondent: ReviewRespondent, author: string) => {
      if (respondent === 'SELF') {
        answers.push(
          { question: 'self:0', respondent, author, text: 'Delivering my first client-facing piece on time.' },
          { question: 'self:1', respondent, author, text: 'More examples of what “done” looks like for bigger tasks.' },
          { question: 'self:2', respondent, author, rating: 3 },
        )
      } else if (respondent === 'MANAGER' || respondent === 'MENTOR') {
        answers.push(
          { question: 'skills:0', respondent, author, rating: 4, evidence: 'Approved task submissions this period; few revision rounds.' },
          { question: 'skills:1', respondent, author, rating: respondent === 'MANAGER' ? 3 : 4 },
          { question: 'skills:2', respondent, author, rating: 4 },
          { question: 'skills:3', respondent, author, selected: ['Reliability', 'Teamwork'] },
        )
        if (respondent === 'MANAGER') {
          answers.push(
            { question: 'overall:0', respondent, author, text: 'Solid, dependable progress. Next focus: sharing drafts earlier.' },
            { question: 'overall:1', respondent, author, bool: true },
          )
        }
      } else {
        answers.push({ question: 'hr:0', respondent, author, text: 'Review complete; no concerns.' })
      }
    }
    for (const respondent of stage.submitted) {
      const author = respondent === 'SELF' ? key : respondent === 'MANAGER' ? people[key].manager : respondent === 'MENTOR' ? people[key].mentor : 'hr'
      add(respondent, author)
    }
    if (answers.length) {
      await prisma.performanceReviewAnswer.createMany({
        data: answers.map((a) => ({
          review_id: reviewId,
          question_id: questionIds[a.question],
          respondent: a.respondent,
          author_id: userIds[a.author],
          rating: a.rating ?? null,
          text_value: a.text ?? null,
          bool_value: a.bool ?? null,
          selected_options: a.selected ?? [],
          evidence: a.evidence ?? null,
        })),
      })
    }
  }

  // ── Development plan (from Tara's completed review) ──────────────────────
  await prisma.developmentPlan.create({
    data: {
      id: seedId('p6:devplan:tara'),
      organization_id: org,
      intern_id: internIds.tara,
      review_id: seedId('p6:review:tara'),
      title: 'Final-month development plan',
      created_by: userIds.manager,
      items: {
        create: [
          { area: 'Sharing drafts earlier', action: 'Share a first draft of each blog post by Wednesday for feedback.', owner_id: userIds.tara, target_date: dateFrom(now, 14), status: 'IN_PROGRESS', position: 0 },
          { area: 'SEO depth', action: 'Complete SEO Fundamentals and apply it to the next post.', owner_id: userIds.tara, course_id: id.course('seo'), status: 'COMPLETED', evidence: 'Course completed; next post uses a keyword brief.', position: 1 },
          { area: 'Portfolio', action: 'Collect the four published posts into a portfolio page.', owner_id: userIds.tara, goal_id: seedId('p6:goal:g5'), target_date: dateFrom(now, 21), status: 'NOT_STARTED', position: 2 },
        ],
      },
    },
  })

  return { courses: COURSES.length, paths: PATHS.length, enrollments, completions, goals: goals.length, reviews: reviewKeys.length }
}
