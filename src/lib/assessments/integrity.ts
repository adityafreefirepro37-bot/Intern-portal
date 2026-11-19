/**
 * Proctoring rules shared by the browser (what to record) and the server (what
 * counts as a violation, how the integrity score is computed). Pure — unit tested.
 *
 * The score summarises the timeline for a reviewer; it is evidence to look at,
 * never an automatic verdict about a person.
 */

export const CONSENT_VERSION = 'v1'
export const RECORDING_RETENTION_DAYS = 30
export const CHUNK_SECONDS = 10
/** Chunks may still arrive this long after submission (the recorders flush their last piece). */
export const UPLOAD_GRACE_MS = 3 * 60_000
/** Answers saved this long after the deadline still count (network latency). */
export const DEADLINE_GRACE_MS = 30_000
/** Focus away from the assessment window for longer than this counts as a violation. */
export const AWAY_SECONDS = 3

export const PROCTOR_EVENT_TYPES = [
  'STARTED',
  'RESUMED',
  'FULLSCREEN_EXIT',
  'FULLSCREEN_ENTER',
  'TAB_HIDDEN',
  'TAB_VISIBLE',
  'WINDOW_BLUR',
  'WINDOW_FOCUS',
  'AWAY_FROM_WINDOW',
  'PASTE_BLOCKED',
  'COPY_BLOCKED',
  'CONTEXT_MENU_BLOCKED',
  'DEVTOOLS_KEY_BLOCKED',
  'PRINT_KEY',
  'CAMERA_LOST',
  'MIC_LOST',
  'SCREEN_SHARE_STOPPED',
  'SCREEN_SHARE_RESUMED',
  'MULTIPLE_SCREENS',
  'NOISE',
  'RESIZE',
  'UPLOAD_FAILED',
  'OFFLINE',
  'ONLINE',
  'SUBMITTED',
] as const
export type ProctorEventType = (typeof PROCTOR_EVENT_TYPES)[number]

/** Events that count towards the attempt's violation limit (auto-submit when exceeded). */
export const VIOLATION_TYPES: readonly ProctorEventType[] = ['FULLSCREEN_EXIT', 'TAB_HIDDEN', 'SCREEN_SHARE_STOPPED', 'AWAY_FROM_WINDOW']

export const EVENT_LABELS: Record<ProctorEventType, string> = {
  STARTED: 'Started the assessment',
  RESUMED: 'Reopened the assessment page',
  FULLSCREEN_EXIT: 'Left full screen',
  FULLSCREEN_ENTER: 'Returned to full screen',
  TAB_HIDDEN: 'Switched away from the tab',
  TAB_VISIBLE: 'Came back to the tab',
  WINDOW_BLUR: 'Focus moved to another window',
  WINDOW_FOCUS: 'Focus came back',
  AWAY_FROM_WINDOW: 'Stayed in another window (over 3 s)',
  PASTE_BLOCKED: 'Tried to paste (blocked)',
  COPY_BLOCKED: 'Tried to copy (blocked)',
  CONTEXT_MENU_BLOCKED: 'Right-click (blocked)',
  DEVTOOLS_KEY_BLOCKED: 'Developer-tools shortcut (blocked)',
  PRINT_KEY: 'Pressed Print Screen',
  CAMERA_LOST: 'Camera stopped',
  MIC_LOST: 'Microphone stopped',
  SCREEN_SHARE_STOPPED: 'Screen sharing stopped',
  SCREEN_SHARE_RESUMED: 'Screen sharing resumed',
  MULTIPLE_SCREENS: 'More than one screen connected',
  NOISE: 'Sustained sound or talking',
  RESIZE: 'Window resized',
  UPLOAD_FAILED: 'Recording upload failed',
  OFFLINE: 'Went offline',
  ONLINE: 'Back online',
  SUBMITTED: 'Submitted',
}

/** Points taken off the integrity score per occurrence (capped per type). */
const WEIGHTS: Partial<Record<ProctorEventType, { each: number; cap: number }>> = {
  FULLSCREEN_EXIT: { each: 12, cap: 36 },
  TAB_HIDDEN: { each: 12, cap: 36 },
  SCREEN_SHARE_STOPPED: { each: 20, cap: 40 },
  CAMERA_LOST: { each: 15, cap: 30 },
  MIC_LOST: { each: 10, cap: 20 },
  WINDOW_BLUR: { each: 2, cap: 8 },
  AWAY_FROM_WINDOW: { each: 12, cap: 36 },
  PASTE_BLOCKED: { each: 6, cap: 18 },
  COPY_BLOCKED: { each: 2, cap: 6 },
  DEVTOOLS_KEY_BLOCKED: { each: 8, cap: 16 },
  PRINT_KEY: { each: 4, cap: 8 },
  MULTIPLE_SCREENS: { each: 10, cap: 10 },
  NOISE: { each: 3, cap: 15 },
  RESIZE: { each: 1, cap: 5 },
  OFFLINE: { each: 5, cap: 15 },
}

export interface IntegrityInput {
  counts: Partial<Record<string, number>>
  /** Seconds the attempt ran (start → submit) and seconds of camera / screen recording received. */
  durationSeconds: number
  cameraSeconds: number
  screenSeconds: number
}

export interface IntegrityResult {
  score: number
  level: 'CLEAN' | 'REVIEW' | 'HIGH_RISK'
  reasons: string[]
}

export function integrityScore(input: IntegrityInput): IntegrityResult {
  let penalty = 0
  const reasons: string[] = []
  for (const [type, weight] of Object.entries(WEIGHTS) as [ProctorEventType, { each: number; cap: number }][]) {
    const n = input.counts[type] ?? 0
    if (!n) continue
    penalty += Math.min(n * weight.each, weight.cap)
    reasons.push(`${EVENT_LABELS[type]} × ${n}`)
  }
  // Recording coverage: missing video is itself a signal (camera covered, tab killed, network cut).
  if (input.durationSeconds >= 60) {
    for (const [name, seconds] of [
      ['Camera', input.cameraSeconds],
      ['Screen', input.screenSeconds],
    ] as const) {
      const coverage = seconds / input.durationSeconds
      if (coverage < 0.5) {
        penalty += 25
        reasons.push(`${name} recording covers only ${Math.round(coverage * 100)}% of the attempt`)
      } else if (coverage < 0.8) {
        penalty += 10
        reasons.push(`${name} recording covers ${Math.round(coverage * 100)}% of the attempt`)
      }
    }
  }
  const score = Math.max(0, 100 - penalty)
  return { score, level: score >= 80 ? 'CLEAN' : score >= 50 ? 'REVIEW' : 'HIGH_RISK', reasons }
}

export const INTEGRITY_LABELS: Record<IntegrityResult['level'], string> = {
  CLEAN: 'Clean',
  REVIEW: 'Needs a look',
  HIGH_RISK: 'High risk',
}

/** Score as a percentage of available points (rounded), or null with no points. */
export function scorePercent(earned: number, available: number): number | null {
  return available > 0 ? Math.round((earned / available) * 100) : null
}
