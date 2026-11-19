'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Camera, CheckCircle2, Clock, Maximize, Mic, MonitorUp, ShieldCheck } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { AWAY_SECONDS, CHUNK_SECONDS, RECORDING_RETENTION_DAYS, type ProctorEventType } from '@/lib/assessments/integrity'
import { cn } from '@/lib/utils'
import { saveAssessmentAnswersAction, startAssessmentAction, submitAssessmentAction } from '@/server/actions/assessments'

interface Question {
  id: string
  kind: 'MULTIPLE_CHOICE' | 'SHORT_ANSWER'
  prompt: string
  options: string[]
  points: number
}

interface AttemptState {
  attemptId: string
  assessmentId: string
  deadlineAt: string
  serverNow: string
  submitted: boolean
  violations: number
  maxViolations: number
  nextSequence: { camera: number; screen: number }
  questions: Question[]
  answers: { question_id: string; choice: number | null; text: string | null }[]
}

type Phase = 'consent' | 'devices' | 'running' | 'submitting' | 'done'
type Answer = { choice?: number | null; text?: string | null }

const NOISE_RMS = 0.06
const NOISE_SECONDS = 2.5

function pickMime() {
  const candidates = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']
  return candidates.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? 'video/webm'
}

export function ProctorSession({
  assessmentId,
  taskTitle,
  timeLimitMinutes,
  maxViolations,
  questionCount,
  resuming,
}: {
  assessmentId: string
  taskTitle: string
  timeLimitMinutes: number
  maxViolations: number
  questionCount: number
  resuming: boolean
}) {
  const [phase, setPhase] = React.useState<Phase>('consent')
  const [consent, setConsent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [camera, setCamera] = React.useState<MediaStream | null>(null)
  const [screen, setScreen] = React.useState<MediaStream | null>(null)
  const [level, setLevel] = React.useState(0)
  const [state, setState] = React.useState<AttemptState | null>(null)
  const [answers, setAnswers] = React.useState<Record<string, Answer>>({})
  const [remaining, setRemaining] = React.useState<number | null>(null)
  const [violations, setViolations] = React.useState(0)
  const [blocked, setBlocked] = React.useState<string | null>(null)
  const [doneReason, setDoneReason] = React.useState<string | null>(null)

  const root = React.useRef<HTMLDivElement>(null)
  const preview = React.useRef<HTMLVideoElement>(null)
  const pendingEvents = React.useRef<{ type: ProctorEventType; at: string; detail?: Record<string, string | number | boolean> }[]>([])
  const recorders = React.useRef<MediaRecorder[]>([])
  const uploads = React.useRef<Promise<unknown>[]>([])
  const dirty = React.useRef(false)
  const answersRef = React.useRef(answers)
  const finished = React.useRef(false)
  const clockOffset = React.useRef(0)
  const screenBase = React.useRef(0)

  React.useEffect(() => {
    answersRef.current = answers
  }, [answers])

  // Camera preview and microphone meter during the device check.
  React.useEffect(() => {
    if (preview.current && camera) preview.current.srcObject = camera
  }, [camera, phase])

  const log = React.useCallback((type: ProctorEventType, detail?: Record<string, string | number | boolean>) => {
    pendingEvents.current.push({ type, at: new Date(Date.now() + clockOffset.current).toISOString(), detail })
  }, [])

  const flushEvents = React.useCallback(
    async (heartbeat = false) => {
      if (!state) return
      const events = pendingEvents.current.splice(0, 200)
      if (!events.length && !heartbeat) return
      try {
        const response = await fetch(`/api/assessments/attempts/${state.attemptId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events, heartbeat }),
          keepalive: true,
        })
        const json = (await response.json()) as { success: boolean; data?: { violations: number; submitted: boolean } }
        if (json.success && json.data) {
          setViolations(json.data.violations)
          if (json.data.submitted && !finished.current) {
            finished.current = true
            setDoneReason(`Your assessment was submitted automatically (${json.data.violations > state.maxViolations ? 'too many violations' : 'time ran out'}).`)
            void stopEverything()
            setPhase('done')
          }
        } else if (!json.success) {
          pendingEvents.current.unshift(...events)
        }
      } catch {
        pendingEvents.current.unshift(...events)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopEverything is stable for the session
    [state],
  )

  async function stopEverything() {
    for (const r of recorders.current) if (r.state !== 'inactive') r.stop()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await Promise.allSettled(uploads.current)
    camera?.getTracks().forEach((t) => t.stop())
    screen?.getTracks().forEach((t) => t.stop())
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
  }

  // ── Step 2: devices ────────────────────────────────────────────────────────
  async function enableCamera() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 12 } },
        audio: { echoCancellation: true, noiseSuppression: false },
      })
      setCamera(stream)
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      const data = new Float32Array(analyser.fftSize)
      let loudSince: number | null = null
      let lastNoise = 0
      const tick = () => {
        if (stream.getAudioTracks()[0]?.readyState !== 'live') return
        analyser.getFloatTimeDomainData(data)
        const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length)
        setLevel(Math.min(1, rms * 8))
        const now = Date.now()
        if (rms > NOISE_RMS) {
          loudSince ??= now
          if (now - loudSince > NOISE_SECONDS * 1000 && now - lastNoise > 30_000) {
            lastNoise = now
            log('NOISE', { seconds: Math.round((now - loudSince) / 1000) })
          }
        } else {
          loudSince = null
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    } catch {
      setError('Camera and microphone are required. Allow them in the browser’s address bar, then try again.')
    }
  }

  async function shareScreen() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 4, max: 5 }, width: { max: 1280 }, displaySurface: 'monitor' },
        audio: false,
        // @ts-expect-error -- newer Chromium hints (ignored elsewhere)
        monitorTypeSurfaces: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'exclude',
      })
      const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface
      if (surface && surface !== 'monitor') {
        stream.getTracks().forEach((t) => t.stop())
        setError('Share your ENTIRE screen (not a window or a browser tab).')
        return
      }
      setScreen(stream)
    } catch {
      setError('Screen sharing is required. Choose “Entire screen” when asked.')
    }
  }

  // ── Step 3: start ──────────────────────────────────────────────────────────
  async function start() {
    if (!camera || !screen) return
    setError(null)
    try {
      await root.current?.requestFullscreen()
    } catch {
      setError('Full screen is required. Allow it and try again.')
      return
    }
    const multipleScreens = Boolean((window.screen as Screen & { isExtended?: boolean }).isExtended)
    const surface = screen.getVideoTracks()[0]?.getSettings().displaySurface ?? 'unknown'
    const result = await startAssessmentAction({ assessmentId, consent: true, screenSurface: surface === 'unknown' ? undefined : surface, multipleScreens })
    if (result.status !== 'success' || !('data' in result) || !result.data) {
      setError(result.message ?? 'The assessment could not start.')
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
      return
    }
    const s = result.data as AttemptState
    clockOffset.current = new Date(s.serverNow).getTime() - Date.now()
    setState(s)
    setViolations(s.violations)
    setAnswers(Object.fromEntries(s.answers.map((a) => [a.question_id, { choice: a.choice, text: a.text }])))
    startRecording(s.attemptId, s.nextSequence)
    setPhase('running')
  }

  /** Records one stream in 10 s chunks numbered from `base`, uploading each with retries. */
  function record(attemptId: string, stream: MediaStream, name: 'camera' | 'screen', base: number, bitrate: number) {
    let seq = base
    const recorder = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: bitrate, audioBitsPerSecond: 32_000 })
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return
      const sequence = seq++
      const send = async () => {
        for (let tryNo = 0; tryNo < 3; tryNo++) {
          try {
            const response = await fetch(`/api/assessments/attempts/${attemptId}/chunks?stream=${name}&seq=${sequence}`, {
              method: 'POST',
              body: event.data,
            })
            if (response.ok || response.status === 409) return
          } catch {
            // retry
          }
          await new Promise((r) => setTimeout(r, 1500 * (tryNo + 1)))
        }
        log('UPLOAD_FAILED', { stream: name, sequence })
      }
      uploads.current.push(send())
    }
    recorder.start(CHUNK_SECONDS * 1000)
    recorders.current.push(recorder)
  }

  function startRecording(attemptId: string, next: { camera: number; screen: number }) {
    screenBase.current = next.screen
    record(attemptId, camera!, 'camera', next.camera, 180_000)
    record(attemptId, screen!, 'screen', next.screen, 300_000)
    camera!.getVideoTracks()[0]?.addEventListener('ended', () => log('CAMERA_LOST'))
    camera!.getAudioTracks()[0]?.addEventListener('ended', () => log('MIC_LOST'))
    screen!.getVideoTracks()[0]?.addEventListener('ended', () => {
      log('SCREEN_SHARE_STOPPED')
      setBlocked('Screen sharing stopped. This counts as a violation. Share your entire screen again to continue.')
    })
  }

  // ── While running: watch the session ───────────────────────────────────────
  React.useEffect(() => {
    if (phase !== 'running' || !state) return
    const onVisibility = () => log(document.hidden ? 'TAB_HIDDEN' : 'TAB_VISIBLE')
    // Focus moving to another window (e.g. Alt+Tab while staying in full screen): a short flicker is only logged;
    // staying away longer than AWAY_SECONDS is a violation. Tab switches are already counted as TAB_HIDDEN.
    let awaySince = 0
    let awayCounted = false
    let awayTimer: ReturnType<typeof setTimeout> | undefined
    const onBlur = () => {
      if (document.hidden || finished.current) return
      log('WINDOW_BLUR')
      awaySince = Date.now()
      awayCounted = false
      clearTimeout(awayTimer)
      awayTimer = setTimeout(() => {
        if (document.hidden || document.hasFocus() || finished.current) return
        awayCounted = true
        log('AWAY_FROM_WINDOW', { after: AWAY_SECONDS })
        void flushEvents()
      }, AWAY_SECONDS * 1000)
    }
    const onFocus = () => {
      clearTimeout(awayTimer)
      if (!awaySince) return
      const seconds = Math.round((Date.now() - awaySince) / 100) / 10
      awaySince = 0
      log('WINDOW_FOCUS', { seconds })
      if (awayCounted && !finished.current) {
        setBlocked(`You switched to another window for ${Math.round(seconds)} seconds. This counts as a violation.`)
      }
    }
    const onFullscreen = () => {
      if (!document.fullscreenElement && !finished.current) {
        log('FULLSCREEN_EXIT')
        setBlocked('You left full screen. This counts as a violation. Return to full screen to continue.')
      } else if (document.fullscreenElement) {
        log('FULLSCREEN_ENTER')
        setBlocked((b) => (b?.startsWith('You left full screen') ? null : b))
      }
    }
    const block = (type: ProctorEventType) => (event: Event) => {
      event.preventDefault()
      log(type)
    }
    const onPaste = block('PASTE_BLOCKED')
    const onCopy = block('COPY_BLOCKED')
    const onContext = block('CONTEXT_MENU_BLOCKED')
    const onKey = (event: KeyboardEvent) => {
      const k = event.key.toLowerCase()
      const devtools =
        k === 'f12' || (event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(k)) || (event.metaKey && event.altKey && ['i', 'j', 'c'].includes(k)) || (event.ctrlKey && k === 'u')
      if (devtools) {
        event.preventDefault()
        log('DEVTOOLS_KEY_BLOCKED', { key: event.key })
      }
      if (k === 'printscreen') log('PRINT_KEY')
      if ((event.ctrlKey || event.metaKey) && k === 'p') event.preventDefault()
    }
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => log('RESIZE', { w: window.innerWidth, h: window.innerHeight }), 800)
    }
    const onOffline = () => log('OFFLINE')
    const onOnline = () => log('ONLINE')
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (finished.current) return
      event.preventDefault()
      void flushEvents()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('fullscreenchange', onFullscreen)
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('copy', onCopy, true)
    document.addEventListener('cut', onCopy, true)
    document.addEventListener('contextmenu', onContext, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    window.addEventListener('beforeunload', onBeforeUnload)
    const events = setInterval(() => void flushEvents(), 5000)
    const heartbeat = setInterval(() => void flushEvents(true), 20_000)
    const autosave = setInterval(() => void saveAnswers(), 8000)
    const clock = setInterval(() => {
      const left = new Date(state.deadlineAt).getTime() - (Date.now() + clockOffset.current)
      setRemaining(Math.max(0, Math.round(left / 1000)))
      if (left <= 0 && !finished.current) void submit('Time ran out')
    }, 500)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      clearTimeout(awayTimer)
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('copy', onCopy, true)
      document.removeEventListener('cut', onCopy, true)
      document.removeEventListener('contextmenu', onContext, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('beforeunload', onBeforeUnload)
      clearInterval(events)
      clearInterval(heartbeat)
      clearInterval(autosave)
      clearInterval(clock)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one listener set per running session
  }, [phase, state])

  async function saveAnswers() {
    if (!state || !dirty.current) return
    dirty.current = false
    const current = answersRef.current
    const result = await saveAssessmentAnswersAction({
      attemptId: state.attemptId,
      answers: Object.entries(current).map(([questionId, a]) => ({ questionId, choice: a.choice ?? null, text: a.text ?? null })),
    })
    if (result.status !== 'success') dirty.current = true
  }

  function setAnswer(questionId: string, answer: Answer) {
    dirty.current = true
    setAnswers((current) => ({ ...current, [questionId]: { ...current[questionId], ...answer } }))
  }

  async function submit(reason?: string) {
    if (!state || finished.current) return
    finished.current = true
    setPhase('submitting')
    dirty.current = true
    await saveAnswers()
    await flushEvents()
    await submitAssessmentAction({ attemptId: state.attemptId })
    await stopEverything()
    setDoneReason(reason ? `${reason} — your answers were submitted.` : 'Your answers were submitted. Your reviewer will grade them.')
    setPhase('done')
  }

  async function reenterFullscreen() {
    await root.current?.requestFullscreen().catch(() => undefined)
  }

  /** After a counted absence: carry on (back in full screen first if needed). */
  async function continueAfterAway() {
    if (!document.fullscreenElement) await reenterFullscreen()
    if (document.fullscreenElement) setBlocked(null)
  }

  async function reshareScreen() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 4, max: 5 }, displaySurface: 'monitor' }, audio: false })
      if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== 'monitor') {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      setScreen(stream)
      log('SCREEN_SHARE_RESUMED')
      setBlocked(null)
      // The camera keeps recording; the new screen stream records into the next segment.
      if (state) {
        screenBase.current += 10_000
        record(state.attemptId, stream, 'screen', screenBase.current, 300_000)
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          log('SCREEN_SHARE_STOPPED')
          setBlocked('Screen sharing stopped. This counts as a violation. Share your entire screen again to continue.')
        })
      }
    } catch {
      // stays blocked
    }
  }

  const answered = state ? state.questions.filter((q) => (q.kind === 'MULTIPLE_CHOICE' ? answers[q.id]?.choice != null : answers[q.id]?.text?.trim())).length : 0
  const minutes = remaining === null ? null : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`

  return (
    <div ref={root} className={cn('min-h-[70vh] bg-background', phase === 'running' && 'overflow-y-auto p-4 sm:p-8')}>
      {phase === 'consent' && (
        <div className="mx-auto max-w-2xl space-y-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-8 text-primary" aria-hidden />
            <div>
              <h1 className="text-h2">Proctored assessment</h1>
              <p className="text-small text-muted-foreground">{taskTitle}</p>
            </div>
          </div>
          {resuming && (
            <p className="rounded-md bg-warning/14 p-3 text-small">
              You started this assessment earlier. Reopening it is recorded; the timer kept running.
            </p>
          )}
          <div className="space-y-3 rounded-lg border p-4 text-small">
            <p className="font-medium">Before you start, please read:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>{questionCount} questions, {timeLimitMinutes} minutes.</strong> The timer can’t be paused; when it ends, your answers are submitted.
              </li>
              <li>
                <strong>Recorded:</strong> your camera and microphone (video and sound), your <strong>entire screen</strong>, and activity in this page
                (leaving full screen, switching tabs or windows, copy / paste attempts, connection drops).
              </li>
              <li>
                <strong>Why:</strong> to confirm that you did this task yourself and understand it. A reviewer looks at the recording only when needed.
              </li>
              <li>
                <strong>Who can see it:</strong> your mentor / manager and HR. Recordings are <strong>deleted after {RECORDING_RETENTION_DAYS} days</strong>; your
                answers and result stay with the task.
              </li>
              <li>
                <strong>Rules:</strong> stay in full screen on this tab; don’t switch tabs, windows or apps; work alone in a quiet place; no pasting. Leaving full
                screen, switching tabs, staying in another window for more than a few seconds or stopping screen sharing counts as a violation — after{' '}
                {maxViolations} the assessment is submitted automatically.
              </li>
            </ul>
          </div>
          <label className="flex items-start gap-2 text-small">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
            <span>I understand and agree to be recorded for this assessment as described above.</span>
          </label>
          <div className="flex gap-2">
            <Button disabled={!consent} onClick={() => setPhase('devices')}>
              Continue
            </Button>
            <Link href={`/assessments/${assessmentId}`} className={buttonVariants({ variant: 'ghost' })}>
              Not now
            </Link>
          </div>
          <p className="text-caption text-muted-foreground">
            If you can’t be recorded (no camera, a disability, or another reason), don’t start — ask your mentor for another arrangement.
          </p>
        </div>
      )}

      {phase === 'devices' && (
        <div className="mx-auto max-w-2xl space-y-5">
          <h1 className="text-h2">Check your camera, microphone and screen</h1>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-small text-destructive">
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg border p-3">
              <p className="flex items-center gap-2 text-small font-medium">
                <Camera className="size-4" aria-hidden /> Camera and microphone {camera && <CheckCircle2 className="size-4 text-success" aria-label="ready" />}
              </p>
              {camera ? (
                <>
                  <video ref={preview} autoPlay muted playsInline className="aspect-video w-full rounded bg-black object-cover" />
                  <div className="flex items-center gap-2 text-caption text-muted-foreground">
                    <Mic className="size-3.5" aria-hidden />
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-label="Microphone level">
                      <span className="block h-full bg-success transition-[width]" style={{ width: `${Math.round(level * 100)}%` }} />
                    </span>
                  </div>
                </>
              ) : (
                <Button variant="outline" onClick={enableCamera}>
                  Allow camera and microphone
                </Button>
              )}
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              <p className="flex items-center gap-2 text-small font-medium">
                <MonitorUp className="size-4" aria-hidden /> Entire screen {screen && <CheckCircle2 className="size-4 text-success" aria-label="ready" />}
              </p>
              {screen ? (
                <p className="text-small text-muted-foreground">Your entire screen is shared.</p>
              ) : (
                <Button variant="outline" onClick={shareScreen}>
                  Share entire screen
                </Button>
              )}
              <p className="text-caption text-muted-foreground">When asked, choose “Entire screen”. Windows and tabs aren’t accepted.</p>
            </div>
          </div>
          <Button disabled={!camera || !screen} onClick={start}>
            <Maximize aria-hidden /> Enter full screen and start
          </Button>
        </div>
      )}

      {phase === 'running' && state && (
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 p-3 backdrop-blur">
            <span className="flex items-center gap-1.5 text-small font-medium">
              <Clock className="size-4" aria-hidden />
              <span className={cn('tabular', remaining !== null && remaining < 60 && 'text-destructive')} aria-live="polite">
                {minutes ?? '—'}
              </span>
            </span>
            <span className="text-caption text-muted-foreground">
              {answered}/{state.questions.length} answered
            </span>
            <span className={cn('ml-auto flex items-center gap-1 text-caption', violations ? 'text-destructive' : 'text-muted-foreground')}>
              <AlertTriangle className="size-3.5" aria-hidden /> Violations {violations}/{state.maxViolations}
            </span>
            <span className="flex items-center gap-1 text-caption text-destructive">
              <span className="size-2 animate-pulse rounded-full bg-destructive" aria-hidden /> Recording
            </span>
          </div>
          <ol className="space-y-6">
            {state.questions.map((q, i) => (
              <li key={q.id} className="space-y-3 rounded-lg border p-4">
                <p className="text-small font-medium">
                  {i + 1}. {q.prompt} <span className="text-caption font-normal text-muted-foreground">({q.points} pt{q.points === 1 ? '' : 's'})</span>
                </p>
                {q.kind === 'MULTIPLE_CHOICE' ? (
                  <div role="radiogroup" className="grid gap-2">
                    {q.options.map((option, oi) => (
                      <label
                        key={oi}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-md border p-2 text-small',
                          answers[q.id]?.choice === oi && 'border-primary bg-primary/5',
                        )}
                      >
                        <input
                          type="radio"
                          name={q.id}
                          checked={answers[q.id]?.choice === oi}
                          onChange={() => setAnswer(q.id, { choice: oi })}
                          className="mt-0.5 accent-primary"
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                ) : (
                  <Textarea
                    rows={4}
                    maxLength={5000}
                    value={answers[q.id]?.text ?? ''}
                    onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                    aria-label={`Answer to question ${i + 1}`}
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
              </li>
            ))}
          </ol>
          <Button onClick={() => void submit()}>Submit assessment</Button>
        </div>
      )}

      {blocked && phase === 'running' && (
        <div role="alertdialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6">
          <div className="max-w-md space-y-4 rounded-xl bg-card p-6 text-center">
            <AlertTriangle className="mx-auto size-10 text-destructive" aria-hidden />
            <p className="text-small">{blocked}</p>
            <p className="text-caption text-muted-foreground">
              Violations: {violations}/{state?.maxViolations}
            </p>
            {blocked.startsWith('Screen sharing') ? (
              <Button onClick={reshareScreen}>Share entire screen again</Button>
            ) : blocked.startsWith('You switched') ? (
              <Button onClick={continueAfterAway}>Continue the assessment</Button>
            ) : (
              <Button onClick={reenterFullscreen}>Return to full screen</Button>
            )}
          </div>
        </div>
      )}

      {(phase === 'submitting' || phase === 'done') && (
        <div className="mx-auto max-w-xl space-y-4 py-16 text-center">
          <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
          <h1 className="text-h2">{phase === 'submitting' ? 'Submitting…' : 'Assessment submitted'}</h1>
          {phase === 'done' && (
            <>
              <p className="text-small text-muted-foreground">{doneReason}</p>
              <Link href={`/assessments/${assessmentId}`} className={buttonVariants()}>
                Back to the assessment
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  )
}
