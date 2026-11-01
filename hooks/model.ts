import type { CacheReading, LimitReading } from '../types'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

// Length of each rate-limit window the band knows how to pace.
export const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * HOUR,
  seven_day: 7 * 24 * HOUR,
}

export const LIMIT_LABEL: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
}

// Spelled-out names for the band, where there is room.
export const LIMIT_NAME: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: '7-day limit',
}

// Pace thresholds in percentage points: used minus where usage should be by now.
export const PACE_UNDER = -10
export const PACE_OVER = 5
export const PACE_FAR_OVER = 15

export type Pace = 'under' | 'on' | 'over' | 'far-over'

export const PACE_COLOR: Record<Pace, string> = {
  under: 'green',
  on: 'gray',
  over: '#e8912d',
  'far-over': 'red',
}

// A reset time as milliseconds since the epoch, from an ISO timestamp or epoch seconds or
// milliseconds; null when it cannot be read.
export const parseResetsAt = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  const n = typeof value === 'number' || /^\d+(\.\d+)?$/.test(text) ? Number(text) : Date.parse(text)
  if (!Number.isFinite(n) || n <= 0) return null
  return n < 1e12 ? n * 1000 : n
}

// A limit as it stands now. A reading taken before its window reset is stale: the weekly window
// restarts at the same time a week later, a five-hour window only with the next request.
export const currentLimit = (limit: LimitReading, now: number): LimitReading => {
  if (limit.resetsAt === null || limit.resetsAt > now) return limit
  const windowMs = WINDOW_MS[limit.kind]
  if (limit.kind !== 'seven_day' || !windowMs) return { ...limit, used: 0, resetsAt: null }
  let resetsAt = limit.resetsAt
  while (resetsAt <= now) resetsAt += windowMs
  return { ...limit, used: 0, resetsAt }
}

// Where usage of a window should be by now if it were spread evenly, 0 to 100.
export const expectedPercent = (windowMs: number, resetsAt: number, now: number): number => {
  const elapsed = windowMs - (resetsAt - now)
  return Math.min(100, Math.max(0, (elapsed / windowMs) * 100))
}

// An exhausted limit is always far over, however close the expected usage is.
// The moment the expected usage is shown for: now, or the coming midnight (local time). Never past
// the window's reset, where the expected usage reaches 100%.
export type ExpectedBy = 'now' | 'midnight'
export const isExpectedBy = (value: unknown): value is ExpectedBy => value === 'now' || value === 'midnight'

export const nextMidnight = (now: number): number => {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

export const expectedAt = (by: ExpectedBy, resetsAt: number, now: number): number =>
  by === 'midnight' ? Math.min(nextMidnight(now), resetsAt) : now

export const pace = (used: number, expected: number): Pace => {
  if (used >= 100) return 'far-over'
  const ahead = used - expected
  if (ahead <= PACE_UNDER) return 'under'
  if (ahead <= PACE_OVER) return 'on'
  if (ahead <= PACE_FAR_OVER) return 'over'
  return 'far-over'
}

// The leading characters of a session id: enough to tell sessions apart, as git does with commits.
export const SHORT_ID_LENGTH = 8
export const shortId = (id: string): string => id.slice(0, SHORT_ID_LENGTH)

export const cacheLeftMs = (reading: CacheReading, now: number): number =>
  Math.max(0, reading.ttlMs - (now - reading.at))

// How long before the cache expires the band turns yellow and a notice shows.
export const WARN_BEFORE_MS = 2 * MINUTE

export const cacheColor = (leftMs: number): string =>
  leftMs <= 0 ? 'gray' : leftMs <= WARN_BEFORE_MS ? 'yellow' : 'green'

export const contextColor = (percent: number): string =>
  percent >= 90 ? 'red' : percent >= 75 ? '#e8912d' : 'green'

type Usage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null
}

export const hitRatio = (u: Usage): number => {
  const read = u.cache_read_input_tokens ?? 0
  const total = (u.input_tokens ?? 0) + read + (u.cache_creation_input_tokens ?? 0)
  return total ? read / total : 0
}

// The cache lifetime a response wrote with, or null when it wrote nothing.
export const ttlFromUsage = (u: Usage): number | null => {
  const c = u.cache_creation
  if (!c) return null
  if ((c.ephemeral_1h_input_tokens ?? 0) > 0) return HOUR
  if ((c.ephemeral_5m_input_tokens ?? 0) > 0) return 5 * MINUTE
  return null
}

// The last main-thread response in the tail of a transcript (JSON lines), with the
// cache lifetime of the latest response that wrote to the cache.
export const readingFromTranscript = (tail: string): CacheReading | null => {
  let reading: CacheReading | null = null
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: { type?: string; isSidechain?: boolean; timestamp?: string; message?: { usage?: Usage } }
    try {
      entry = JSON.parse(lines[i] ?? '')
    } catch {
      continue
    }
    const usage = entry.message?.usage
    if (entry.type !== 'assistant' || entry.isSidechain || !usage) continue
    if (reading === null) {
      const at = Date.parse(entry.timestamp ?? '')
      if (Number.isNaN(at)) continue
      reading = { at, hit: hitRatio(usage), ttlMs: HOUR }
    }
    const ttl = ttlFromUsage(usage)
    if (ttl !== null) return { ...reading, ttlMs: ttl }
  }
  return reading
}

// A short, locale-free duration: `3d 4h`, `2h 15m`, `9m`.
export const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / MINUTE))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

// A bar of `width` cells: `filled` cells used, and the cell where usage should be, if any.
export const bar = (width: number, used: number, expected?: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, used)) / 100) * width)
  const marker = expected === undefined ? -1 : Math.min(width - 1, Math.round((expected / 100) * width))
  return { filled, marker }
}

// Keystrokes. An edit without a key is a burst of keys the editor folded into one when it is
// this short, a paste when it is longer; pasting does not count.
export const BURST_MAX_CHARS = 16

export type PromptEdit = { key?: unknown; start: number; end: number; inputText: string }

// Keys one edit of the prompt box took: each character typed, one for a deletion, none for a
// cursor move or a paste.
export const keystrokesOf = (edit: PromptEdit): number => {
  const typed = edit.inputText.length
  if (typed === 0) return edit.end > edit.start ? 1 : 0
  if (edit.key === undefined && typed > BURST_MAX_CHARS) return 0
  return typed
}

// The local calendar day of a time, as YYYY-MM-DD; the daily count starts over at midnight.
export const localDay = (t: number): string => {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// The thousands separator the person picked in the settings; the app's runtime does not report
// the system's locale, so it is not taken from there.
export type Separator = ',' | '.'
export const isSeparator = (value: unknown): value is Separator => value === ',' || value === '.'
let separator: Separator = ','
export const setSeparator = (sep: Separator) => {
  separator = sep
}

// A whole number with the picked thousands separator, 12,345 or 12.345.
export const groupDigits = (n: number): string =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n)).replace(/,/g, separator)

// Water. The day's target is spread evenly over the hours someone usually drinks; before them
// nothing is due, after them all of it.
export const WATER_FROM_HOUR = 7
export const WATER_TO_HOUR = 21
export const WATER_MAX_TARGET = 20

export const isWaterTarget = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= WATER_MAX_TARGET

// Units due by a time, as a fraction.
export const waterDue = (target: number, t: number): number => {
  const d = new Date(t)
  const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
  const share = (hours - WATER_FROM_HOUR) / (WATER_TO_HOUR - WATER_FROM_HOUR)
  return target * Math.min(1, Math.max(0, share))
}

// Green on target, orange one unit behind, red two or more behind; only whole units count.
export type WaterColor = 'green' | 'orange' | 'red'
export const waterColor = (drunk: number, target: number, t: number): WaterColor => {
  const behind = Math.floor(waterDue(target, t)) - drunk
  return behind >= 2 ? 'red' : behind === 1 ? 'orange' : 'green'
}

// Pomodoro: a series of focus blocks the person starts one at a time. Each runs 25 minutes and is
// followed by a 5-minute break, the last of the series by a 15-minute one; then it waits for the
// next start. A started block counts, even if stopped early.
export const POMODORO_MS = 25 * MINUTE
export const SHORT_BREAK_MS = 5 * MINUTE
export const LONG_BREAK_MS = 15 * MINUTE
export const POMODORO_MAX_TARGET = 6

export const isPomodoroTarget = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= POMODORO_MAX_TARGET

// The series as stored: how many blocks it has started, and when the latest began (null while it waits).
export type PomodoroState = { started: number; since: number | null }
export type PomodoroPhase = 'idle' | 'focus' | 'break'
export type Pomodoro = { phase: PomodoroPhase; started: number; target: number; leftMs: number }

export const pomodoroAt = (state: PomodoroState, target: number, t: number): Pomodoro => {
  // A finished series shows as a fresh one.
  const done = { phase: 'idle' as const, started: state.started >= target ? 0 : state.started, target, leftMs: 0 }
  if (state.since === null) return done
  const elapsed = t - state.since
  if (elapsed < POMODORO_MS) return { phase: 'focus', started: state.started, target, leftMs: POMODORO_MS - elapsed }
  const pause = state.started >= target ? LONG_BREAK_MS : SHORT_BREAK_MS
  if (elapsed < POMODORO_MS + pause) {
    return { phase: 'break', started: state.started, target, leftMs: POMODORO_MS + pause - elapsed }
  }
  return done
}

// The start button: the next block of the series, or the first of a new one.
export const startPomodoro = (state: PomodoroState, target: number, t: number): PomodoroState => {
  const { phase, started } = pomodoroAt(state, target, t)
  if (phase !== 'idle') return state
  return { started: started + 1, since: t }
}

// The stop button: ends the block or the break; the block stays counted.
export const stopPomodoro = (state: PomodoroState): PomodoroState => ({ started: state.started, since: null })

// Which count of keystrokes a chat counts on: the day and the latest Reset all of it. When it
// changes, at midnight or on a Reset all in any chat, every chat starts its own count over.
export const keysMark = (stored: { day: string; reset?: number } | undefined, day: string): string =>
  `${day}:${stored?.day === day ? (stored.reset ?? 0) : 0}`

// The reset: no block counted, none running.
export const resetPomodoro = (): PomodoroState => ({ started: 0, since: null })

// The series as it stands today: one stored on an earlier day starts over, unless its latest block
// or the break after it still runs, so a block begun before midnight runs to its end.
export const pomodoroOfDay = (stored: (PomodoroState & { day: string }) | undefined, day: string, t: number): PomodoroState =>
  stored && (stored.day === day || (stored.since !== null && t - stored.since < POMODORO_MS + LONG_BREAK_MS))
    ? { started: stored.started, since: stored.since }
    : resetPomodoro()

// A gong for the pomodoro, made here as a WAV instead of shipped as a file: a sine with an
// inharmonic overtone, as a bell has, fading out. Mono, 16 bit, 22,050 samples a second.
const SAMPLE_RATE = 22_050
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const base64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | (b << 8) | c
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? BASE64[n & 63]! : '='
  }
  return out
}

export const gongWav = (hz: number, ms = 1500): string => {
  const samples = Math.round((SAMPLE_RATE * ms) / 1000)
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE
    // A soft start of 5 ms keeps the first sample from clicking.
    const envelope = Math.min(1, t / 0.005) * Math.exp(-3 * t)
    const wave = Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(2 * Math.PI * hz * 2.76 * t) * Math.exp(-4 * t)
    view.setInt16(44 + i * 2, Math.round(envelope * wave * 0.5 * 32767), true)
  }
  return base64(bytes)
}

// Timer: a countdown the person sets in steps and starts, pauses and resets; shown instead of the
// pomodoros. When it runs out it waits again at its full time.
export const TIMER_STEP_MS = 5 * MINUTE
export const TIMER_MIN_MS = 5 * MINUTE
export const TIMER_MAX_MS = 120 * MINUTE
export const TIMER_DEFAULT_MS = 25 * MINUTE

// The timer as stored: its full time, the time left when it last started or paused, and when it
// started (null while it waits or is paused).
export type TimerState = { totalMs: number; leftMs: number; since: number | null }
export type TimerPhase = 'idle' | 'running' | 'paused'
export type Timer = { phase: TimerPhase; leftMs: number; totalMs: number }

export const freshTimer = (totalMs = TIMER_DEFAULT_MS): TimerState => ({ totalMs, leftMs: totalMs, since: null })

export const isTimerState = (s: unknown): s is TimerState => {
  const v = s as TimerState | null
  return (
    typeof v === 'object' && v !== null &&
    typeof v.totalMs === 'number' && v.totalMs >= TIMER_MIN_MS && v.totalMs <= TIMER_MAX_MS &&
    typeof v.leftMs === 'number' && v.leftMs >= 0 && v.leftMs <= v.totalMs &&
    (v.since === null || typeof v.since === 'number')
  )
}

// Whether a started timer has run out by t: then it waits again at its full time.
export const timerRanOut = (s: TimerState, t: number): boolean => s.since !== null && t - s.since >= s.leftMs

export const timerAt = (s: TimerState, t: number): Timer => {
  if (s.since !== null && !timerRanOut(s, t)) return { phase: 'running', leftMs: s.leftMs - (t - s.since), totalMs: s.totalMs }
  const leftMs = s.since !== null ? s.totalMs : s.leftMs
  return { phase: leftMs < s.totalMs ? 'paused' : 'idle', leftMs, totalMs: s.totalMs }
}

export const startTimer = (s: TimerState, t: number): TimerState => {
  const v = timerAt(s, t)
  return v.phase === 'running' ? s : { totalMs: s.totalMs, leftMs: v.leftMs, since: t }
}

// The stop button pauses: the time left stays for the next start. So does turning the timer off;
// one that ran out meanwhile is stored as waiting, so no toast comes late when it is turned on.
export const pauseTimer = (s: TimerState, t: number): TimerState => {
  const v = timerAt(s, t)
  if (v.phase === 'running') return { totalMs: s.totalMs, leftMs: v.leftMs, since: null }
  return s.since !== null ? freshTimer(s.totalMs) : s
}

export const resetTimer = (s: TimerState): TimerState => freshTimer(s.totalMs)

// − and + move the full time and the time left alike, by a step within the bounds; the time left
// never drops below 0, and a paused timer that would reach 0 waits again at its full time.
export const stepTimer = (s: TimerState, t: number, steps: number): TimerState => {
  const totalMs = Math.min(TIMER_MAX_MS, Math.max(TIMER_MIN_MS, s.totalMs + steps * TIMER_STEP_MS))
  const delta = totalMs - s.totalMs
  if (delta === 0) return s
  const v = timerAt(s, t)
  if (v.phase === 'running') return { totalMs, leftMs: Math.max(0, v.leftMs + delta), since: t }
  const leftMs = v.phase === 'idle' ? totalMs : v.leftMs + delta
  return leftMs > 0 ? { totalMs, leftMs, since: null } : freshTimer(totalMs)
}
