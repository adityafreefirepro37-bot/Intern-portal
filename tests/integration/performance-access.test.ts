import { resolveRecord, resolveRecords, type RecordRef } from '@/server/services/performance-access'
import { AYAVA_ORGANIZATION_ID, seedId } from '../../prisma/seed/ids'
import { prisma } from './helpers'

afterAll(() => prisma.$disconnect())

const placement = (id: string) => prisma.intern.findUniqueOrThrow({ where: { id }, select: { id: true, user_id: true } })

describe('resolveRecords', () => {
  it('resolves references exactly like resolveRecord, one by one', async () => {
    const aanya = await placement(seedId('intern:intern'))
    const ishaan = await placement(seedId('intern:ishaan'))

    // Records of each type that belong to Aanya (when the seed has one).
    const [task, project, enrollment, goal, checkin, feedback] = await Promise.all([
      prisma.task.findFirst({ where: { deleted_at: null, assignees: { some: { user_id: aanya.user_id } } }, select: { id: true } }),
      prisma.project.findFirst({ where: { deleted_at: null, members: { some: { user_id: aanya.user_id } } }, select: { id: true } }),
      prisma.courseEnrollment.findFirst({ where: { user_id: aanya.user_id }, select: { course_id: true } }),
      prisma.performanceGoal.findFirst({ where: { intern_id: aanya.id }, select: { id: true } }),
      prisma.weeklyCheckin.findFirst({ where: { intern_id: aanya.id }, select: { id: true } }),
      prisma.feedback.findFirst({ where: { to_user_id: aanya.user_id }, select: { id: true } }),
    ])
    expect(task && project && enrollment && goal).toBeTruthy()

    const owned: RecordRef[] = [
      { intern: aanya, type: 'TASK', id: task!.id },
      { intern: aanya, type: 'PROJECT', id: project!.id },
      { intern: aanya, type: 'COURSE', id: enrollment!.course_id },
      { intern: aanya, type: 'GOAL', id: goal!.id },
      ...(checkin ? [{ intern: aanya, type: 'CHECKIN' as const, id: checkin.id }] : []),
      ...(feedback ? [{ intern: aanya, type: 'FEEDBACK' as const, id: feedback.id }] : []),
    ]
    // The same records referenced for another intern must not resolve, and
    // unknown ids resolve to nothing.
    const foreign = owned.map((ref) => ({ ...ref, intern: ishaan }))
    const missing: RecordRef = { intern: aanya, type: 'TASK', id: '00000000-0000-4000-8000-000000000000' }
    const refs: (RecordRef | null)[] = [...owned, null, ...foreign, missing, owned[0]]

    const batched = await resolveRecords(AYAVA_ORGANIZATION_ID, refs)
    const single = await Promise.all(
      refs.map((ref) => (ref ? resolveRecord(AYAVA_ORGANIZATION_ID, ref.intern, ref.type, ref.id) : Promise.resolve(null))),
    )

    expect(batched).toEqual(single)
    expect(batched.slice(0, owned.length).every(Boolean)).toBe(true)
  })

  it('never resolves records from another organization', async () => {
    const aanya = await placement(seedId('intern:intern'))
    const task = await prisma.task.findFirstOrThrow({ where: { assignees: { some: { user_id: aanya.user_id } } } })
    const [result] = await resolveRecords('00000000-0000-4000-8000-000000000001', [{ intern: aanya, type: 'TASK', id: task.id }])
    expect(result).toBeNull()
  })
})
