import { EVENT_LABELS, integrityScore, PROCTOR_EVENT_TYPES, scorePercent, VIOLATION_TYPES } from '@/lib/assessments/integrity'

const full = { durationSeconds: 600, cameraSeconds: 600, screenSeconds: 600 }

describe('integrity score', () => {
  it('is 100 and clean with nothing suspicious and full recording', () => {
    expect(integrityScore({ counts: {}, ...full })).toEqual({ score: 100, level: 'CLEAN', reasons: [] })
  })

  it('takes points off per event, capped per type', () => {
    const one = integrityScore({ counts: { TAB_HIDDEN: 1 }, ...full })
    expect(one.score).toBe(88)
    expect(one.reasons).toEqual(['Switched away from the tab × 1'])
    // Ten tab switches cost no more than the cap (36).
    expect(integrityScore({ counts: { TAB_HIDDEN: 10 }, ...full }).score).toBe(64)
  })

  it('counts time in another window as a violation, while short focus losses cost little', () => {
    expect(VIOLATION_TYPES).toContain('AWAY_FROM_WINDOW')
    expect(VIOLATION_TYPES).not.toContain('WINDOW_BLUR')
    expect(integrityScore({ counts: { AWAY_FROM_WINDOW: 1 }, ...full }).score).toBe(88)
    expect(integrityScore({ counts: { WINDOW_BLUR: 10 }, ...full }).score).toBe(92)
  })

  it('flags missing recording as a risk', () => {
    const r = integrityScore({ counts: {}, durationSeconds: 600, cameraSeconds: 100, screenSeconds: 600 })
    expect(r.score).toBe(75)
    expect(r.level).toBe('REVIEW')
    expect(r.reasons[0]).toMatch(/Camera recording covers only 17%/)
    // Very short attempts aren't judged on coverage.
    expect(integrityScore({ counts: {}, durationSeconds: 30, cameraSeconds: 0, screenSeconds: 0 }).score).toBe(100)
  })

  it('reaches high risk with several kinds of cheating signal and never goes below 0', () => {
    const r = integrityScore({
      counts: { TAB_HIDDEN: 5, FULLSCREEN_EXIT: 5, SCREEN_SHARE_STOPPED: 3, CAMERA_LOST: 2, PASTE_BLOCKED: 4 },
      durationSeconds: 600,
      cameraSeconds: 0,
      screenSeconds: 0,
    })
    expect(r.level).toBe('HIGH_RISK')
    expect(r.score).toBe(0)
  })

  it('labels every event type, and violations are a subset', () => {
    for (const type of PROCTOR_EVENT_TYPES) expect(EVENT_LABELS[type]).toBeTruthy()
    for (const type of VIOLATION_TYPES) expect(PROCTOR_EVENT_TYPES).toContain(type)
  })
})

describe('score percent', () => {
  it('rounds, and is null without points', () => {
    expect(scorePercent(4, 6)).toBe(67)
    expect(scorePercent(0, 0)).toBeNull()
  })
})
