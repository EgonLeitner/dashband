import { atom, read, update } from 'claude-code'
import type { ClientElements, EngineInterface, Register, RenderNode, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { CacheReading, LimitReading, UsageReading } from '../types'
import {
  BAR_CELLS,
  DEFAULT_SIZE,
  ID_COLOR,
  SIZES,
  bandAlt,
  bandRows,
  bandSvg,
  barColor,
  idSvg,
  idSvgHeight,
  idSvgWidth,
  iconSvg,
  iconSvgSize,
  isSize,
  PILL_TINT,
  keysSvg,
  keysSvgHeight,
  keysSvgWidth,
  keysTip,
  POMODORO_COLOR,
  pomodoroText,
  pomodoroTip,
  TIMER_COLOR,
  timerText,
  timerTip,
  svgHeight,
  svgWidth,
  waterSvg,
  waterSvgHeight,
  waterSvgWidth,
  waterTip,
} from './band'
import type { Size } from './band'
import type { ExpectedBy, PomodoroState, Separator, TimerState } from './model'
import {
  HOUR,
  LIMIT_LABEL,
  MINUTE,
  PACE_COLOR,
  WARN_BEFORE_MS,
  WINDOW_MS,
  bar,
  cacheColor,
  cacheLeftMs,
  contextColor,
  currentLimit,
  expectedAt,
  expectedPercent,
  hitRatio,
  isExpectedBy,
  keystrokesOf,
  keysMark,
  localDay,
  pomodoroOfDay,
  resetPomodoro,
  pace,
  parseResetsAt,
  readingFromTranscript,
  shortId,
  POMODORO_MAX_TARGET,
  WATER_MAX_TARGET,
  isPomodoroTarget,
  isSeparator,
  setSeparator,
  isWaterTarget,
  pomodoroAt,
  startPomodoro,
  stopPomodoro,
  freshTimer,
  isTimerState,
  pauseTimer,
  resetTimer,
  startTimer,
  stepTimer,
  timerAt,
  timerRanOut,
  gongWav,
  waterColor,
  waterDue,
} from './model'

const TICK_MS = 10_000
// Keystrokes reach the band every ten seconds; drawn as images, its SVGs redraw without flickering.
const KEYS_TICK_MS = 10_000
const TIMER_TICK_MS = 1_000
// Desktop layout: about 8.8 pixels a column (measured 2026-10-28), and room kept for the right column
// (id, pills, settings) and a gap before it.
const PX_PER_COLUMN = 8.8
const RIGHT_COLUMN_PX = 180
// Settings: the column of group names, and 0 to max as a list.
const GROUP_WIDTH = 12
const range = (max: number) => Array.from({ length: max + 1 }, (_, n) => n)
const TAIL_BYTES = 262_144

const cache = atom({ plugin: 'dashband', key: 'cache' } as const, null)
const usage = atom({ plugin: 'dashband', key: 'usage' } as const, null)
const working = atom({ plugin: 'dashband', key: 'working' } as const, false)
const now = atom({ plugin: 'dashband', key: 'now' } as const, 0)
const settingsOpen = atom({ plugin: 'dashband', key: 'settingsOpen' } as const, false)
const size = atom({ plugin: 'dashband', key: 'size' } as const, DEFAULT_SIZE)
const expectedBy = atom({ plugin: 'dashband', key: 'expectedBy' } as const, 'now' as ExpectedBy)
const keystrokesOn = atom({ plugin: 'dashband', key: 'keystrokesOn' } as const, false)
const keysChat = atom({ plugin: 'dashband', key: 'keysChat' } as const, 0)
const keysToday = atom({ plugin: 'dashband', key: 'keysToday' } as const, 0)
const waterTarget = atom({ plugin: 'dashband', key: 'waterTarget' } as const, 0)
const waterToday = atom({ plugin: 'dashband', key: 'waterToday' } as const, 0)
const separator = atom({ plugin: 'dashband', key: 'separator' } as const, ',' as Separator)
const soundsOn = atom({ plugin: 'dashband', key: 'soundsOn' } as const, true)
const pomodoroTarget = atom({ plugin: 'dashband', key: 'pomodoroTarget' } as const, 0)
const pomodoroState = atom({ plugin: 'dashband', key: 'pomodoroState' } as const, { started: 0, since: null } as PomodoroState)
const timerOn = atom({ plugin: 'dashband', key: 'timerOn' } as const, false)
const timerState = atom({ plugin: 'dashband', key: 'timerState' } as const, freshTimer())

// The settings area: a frame and a shade darker than the band, on light and dark alike.
const SETTINGS_BORDER = '#8a8a8a'
const RESET_COLOR = '#d9534f'
const SETTINGS_BACKGROUND = 'rgba(0, 0, 0, 0.06)'

// Settings the person picks in the band, shared by every session through the store.
const SETTINGS_KEY = 'settings'
type StoredSettings = { size?: string; expectedBy?: string; keystrokes?: boolean; water?: number; pomodoros?: number; timer?: boolean; separator?: string; sounds?: boolean }

const pullSettings = async ($: EngineInterface) => {
  const stored = (await $.store.get(SETTINGS_KEY)) as StoredSettings | undefined
  const picked = isSize(stored?.size) ? stored.size : DEFAULT_SIZE
  if ((await read($, size)) !== picked) await update($, size, () => picked)
  const by = isExpectedBy(stored?.expectedBy) ? stored.expectedBy : 'now'
  if ((await read($, expectedBy)) !== by) await update($, expectedBy, () => by)
  const isOn = stored?.keystrokes === true
  counting = isOn
  if ((await read($, keystrokesOn)) !== isOn) await update($, keystrokesOn, () => isOn)
  const target = isWaterTarget(stored?.water) ? stored.water : 0
  if ((await read($, waterTarget)) !== target) await update($, waterTarget, () => target)
  const isLoud = stored?.sounds !== false
  if ((await read($, soundsOn)) !== isLoud) await update($, soundsOn, () => isLoud)
  const sep = isSeparator(stored?.separator) ? stored.separator : ','
  setSeparator(sep)
  if ((await read($, separator)) !== sep) await update($, separator, () => sep)
  const blocks = isPomodoroTarget(stored?.pomodoros) ? stored.pomodoros : 0
  if ((await read($, pomodoroTarget)) !== blocks) await update($, pomodoroTarget, () => blocks)
  const isTimer = stored?.timer === true
  if ((await read($, timerOn)) !== isTimer) await update($, timerOn, () => isTimer)
}

const storeSetting = async ($: EngineInterface, setting: StoredSettings) => {
  const stored = ((await $.store.get(SETTINGS_KEY)) as StoredSettings | undefined) ?? {}
  await $.store.set(SETTINGS_KEY, { ...stored, ...setting })
}

// Keystrokes, counted only while the person has turned it on. Counted in memory on every edit and
// written once a minute and on submit, so a key costs no store write and no redraw. Only numbers
// are kept, never text. Today's count is shared by every session through the store.
const KEYSTROKES_KEY = 'keystrokes'
type StoredKeystrokes = { day: string; count: number; reset?: number }
let counting = false
let pendingKeys = 0
let seenMark: string | undefined

const waterAt = async ($: EngineInterface, target: number) => {
  const t = await read($, now)
  const drunk = await read($, waterToday)
  return { drunk, target, due: waterDue(target, t), color: waterColor(drunk, target, t) }
}

const flushKeystrokes = async ($: EngineInterface) => {
  const day = localDay(await $.clock.now())
  const stored = (await $.store.get(KEYSTROKES_KEY)) as StoredKeystrokes | undefined
  const isToday = stored?.day === day
  let today = isToday ? stored.count : 0
  // A new day or a Reset all in any chat starts this chat's count over too.
  const mark = keysMark(stored, day)
  if (seenMark !== undefined && seenMark !== mark) await update($, keysChat, () => 0)
  seenMark = mark
  if (pendingKeys > 0) {
    const added = pendingKeys
    pendingKeys = 0
    today += added
    await $.store.set(KEYSTROKES_KEY, { day, count: today, reset: isToday ? stored.reset : undefined })
    await update($, keysChat, n => n + added)
  }
  if ((await read($, keysToday)) !== today) await update($, keysToday, () => today)
}

// Reset all: today's count starts over, and with the new mark every chat's own count, this one
// at once, the others at their next flush.
const resetKeystrokes = async ($: EngineInterface) => {
  pendingKeys = 0
  const t = await $.clock.now()
  const stored: StoredKeystrokes = { day: localDay(t), count: 0, reset: t }
  await $.store.set(KEYSTROKES_KEY, stored)
  seenMark = keysMark(stored, stored.day)
  await update($, keysChat, () => 0)
  await update($, keysToday, () => 0)
}

// A tooltip in the desktop app: a card shown above while the pointer is over the keyed Box around
// it. It has no key itself: a keyed Box would scope its own hover, and a hidden one is never hovered.
// Theme colors keep it opaque and readable on light and dark.
const tipCard = (lines: string[], { Box, Text }: Pick<ClientElements, 'Box' | 'Text'>) => (
  <Box
    position="absolute"
    bottom={1}
    left={0}
    display="none"
    hover={{ display: 'flex' }}
    flexDirection="column"
    paddingX={1}
    paddingY={0}
    borderStyle="round"
    borderColor="subtle"
    backgroundColor="background"
  >
    {lines.map(line => (
      <Text>{line}</Text>
    ))}
  </Box>
)

// A pill in the desktop app: a tinted, rounded box on one line. A border brings a padding that
// would make the line taller; paddingY takes it back. A pill never shrinks, so its text never wraps.
const pill = (tint: keyof typeof PILL_TINT) =>
  ({
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 1,
    flexShrink: 0,
    paddingX: 1,
    paddingY: 0,
    borderStyle: 'round',
    borderColor: PILL_TINT[tint].border,
    backgroundColor: PILL_TINT[tint].background,
  }) as const

// Water drunk today, counted by the person's presses and shared by every session through the store.
const WATER_KEY = 'water'
type StoredWater = { day: string; count: number }

const pullWater = async ($: EngineInterface, added = 0) => {
  const day = localDay(await $.clock.now())
  const stored = (await $.store.get(WATER_KEY)) as StoredWater | undefined
  let today = stored?.day === day ? stored.count : 0
  if (added !== 0) {
    today = Math.max(0, today + added)
    await $.store.set(WATER_KEY, { day, count: today })
  }
  if ((await read($, waterToday)) !== today) await update($, waterToday, () => today)
}

// A toast when water turns red, once for each time it does, in one session only: the store
// remembers that the toast is out until water is back on target or one behind.
const WATER_ALERT_KEY = 'waterAlert'
type StoredWaterAlert = { day: string; red: boolean }

const alertWater = async ($: EngineInterface, t: number) => {
  const target = await read($, waterTarget)
  if (target === 0) return

  const day = localDay(t)
  const isRed = waterColor(await read($, waterToday), target, t) === 'red'
  const stored = (await $.store.get(WATER_ALERT_KEY)) as StoredWaterAlert | undefined
  const wasRed = stored?.day === day && stored.red
  if (isRed === wasRed) return

  await $.store.set(WATER_ALERT_KEY, { day, red: isRed })
  if (isRed) {
    $.ui.toast(`Time for water: ${await read($, waterToday)} of ${Math.floor(waterDue(target, t))} units due by now`, {
      timeoutMs: 60_000,
    })
    await trace($, 'toast water')
  }
}

// The pomodoro series, shared by every session through the store. A series from an earlier day
// starts over once its last block and break are over.
const POMODORO_KEY = 'pomodoro'
type StoredPomodoro = PomodoroState & { day: string }

const pullPomodoro = async ($: EngineInterface, change?: (state: PomodoroState, t: number) => PomodoroState) => {
  const t = await $.clock.now()
  const day = localDay(t)
  const stored = (await $.store.get(POMODORO_KEY)) as StoredPomodoro | undefined
  let state = pomodoroOfDay(stored, day, t)
  if (change) {
    state = change(state, t)
    await $.store.set(POMODORO_KEY, { ...state, day })
  }
  const shown = await read($, pomodoroState)
  if (shown.started !== state.started || shown.since !== state.since) await update($, pomodoroState, () => state)
}

// The gongs: high when a block ends, low when a break does. Made once, on first use.
const GONG_HZ = { high: 880, low: 587 } as const
const gongs: Partial<Record<keyof typeof GONG_HZ, string>> = {}
const gong = ($: EngineInterface, pitch: keyof typeof GONG_HZ) => {
  const wav = (gongs[pitch] ??= gongWav(GONG_HZ[pitch]))
  // A surface without a player plays nothing; the toast still says it.
  $.audio.play({ base64: wav, mime: 'audio/wav' }, { gain: 0.6 }).catch(() => {})
}

// A toast when a block ends and when its break does, once each, in one session only: the store
// remembers the last one sent.
const POMODORO_ALERT_KEY = 'pomodoroAlert'

const alertPomodoro = async ($: EngineInterface, t: number) => {
  const target = await read($, pomodoroTarget)
  const state = await read($, pomodoroState)
  if (target === 0 || state.since === null) return

  const p = pomodoroAt(state, target, t)
  if (p.phase === 'focus') return
  const key = `${state.since}:${p.phase}`
  if ((await $.store.get(POMODORO_ALERT_KEY)) === key) return

  await $.store.set(POMODORO_ALERT_KEY, key)
  const last = state.started >= target
  const message =
    p.phase === 'break'
      ? `Pomodoro ${state.started} of ${target} done: take a ${Math.ceil(p.leftMs / MINUTE)}-minute break`
      : last
        ? `Pomodoro series done: ${target} blocks`
        : 'Break over: press ▶ for the next pomodoro'
  $.ui.toast(message, { timeoutMs: 60_000 })
  if (await read($, soundsOn)) gong($, p.phase === 'break' ? 'high' : 'low')
  await trace($, `toast pomodoro ${p.phase}`)
}

// The timer, shared by every session through the store; it keeps its full time for the next day.
const TIMER_KEY = 'timer'

const pullTimer = async ($: EngineInterface, change?: (state: TimerState, t: number) => TimerState) => {
  const t = await $.clock.now()
  const stored = await $.store.get(TIMER_KEY)
  let state = isTimerState(stored) ? stored : freshTimer()
  if (change) {
    state = change(state, t)
    await $.store.set(TIMER_KEY, state)
  }
  const shown = await read($, timerState)
  if (shown.totalMs !== state.totalMs || shown.leftMs !== state.leftMs || shown.since !== state.since) {
    await update($, timerState, () => state)
  }
}

// A toast and the high gong when the timer runs out, once, in one session only.
const TIMER_ALERT_KEY = 'timerAlert'

const alertTimer = async ($: EngineInterface, t: number) => {
  const state = await read($, timerState)
  if (!(await read($, timerOn)) || !timerRanOut(state, t)) return
  const key = `${state.since}:${state.leftMs}`
  if ((await $.store.get(TIMER_ALERT_KEY)) === key) return
  await $.store.set(TIMER_ALERT_KEY, key)
  $.ui.toast(`Timer done: ${state.totalMs / MINUTE} min`, { timeoutMs: 60_000 })
  if (await read($, soundsOn)) gong($, 'high')
  await trace($, 'toast timer')
}

// Optional trace for troubleshooting: on while this directory exists
// (`mkdir /tmp/dashband-trace`). Each session writes its own log there. Checked on every
// entry, because writing a log would otherwise recreate the directory after it was removed.
const TRACE_DIR = '/tmp/dashband-trace'
const TRACE_MAX_LINES = 500
const traceLines: string[] = []
let lastLayout = ''

const trace = async ($: EngineInterface, message: string) => {
  if (!(await $.fs.exists(TRACE_DIR))) return

  traceLines.push(`${new Date(await $.clock.now()).toISOString()} ${message}`)
  if (traceLines.length > TRACE_MAX_LINES) traceLines.shift()
  await $.fs.write(`${TRACE_DIR}/${await $.session.id()}.log`, traceLines.join('\n') + '\n')
}

let transcriptPath: string | null = null
// The transcript may not hold the last response yet when its turn completes: look again on the
// next ticks until the entry shows up.
const TTL_LOOKUPS = 10
// The entry usually lands within seconds: look again soon before falling back to the ticks.
const TTL_QUICK_LOOKUPS_MS = [1_500, 4_000]
let ttlPending: { after: number; lookups: number } | null = null
// Time of the newest transcript entry already read, to tell a new one apart.
let transcriptSeenAt = 0
let statusShown: string | undefined
const warned = new Set<number>()
// Turns that started and have not completed. turn.start does not say whether a turn is the main
// conversation's, so working means any turn is running; every start is matched by its completion.
const activeTurns = new Set<string>()
const renders: Record<string, number> = {}

const toUsage = (context: SessionContextUsage, limits: readonly SessionRateLimit[]): UsageReading => ({
  contextPercent: context.percent ?? null,
  contextTokens: context.tokens ?? null,
  limits: limits.map(l => ({
    kind: l.kind,
    used: l.percentUsed,
    resetsAt: parseResetsAt(l.resetsAt),
  })),
})

// Finds the transcript by session id when no classic SessionStart told us its path,
// as after a hot reload.
const findTranscript = async ($: EngineInterface): Promise<string | null> => {
  const script = 'ls "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/"$1".jsonl 2>/dev/null | head -1'
  const result = await $.process.run(['sh', '-c', script, 'sh', await $.session.id()])
  return result.stdout.trim() || null
}

// Reads the end of the transcript; the whole file can exceed what $.fs.read takes.
const transcriptReading = async ($: EngineInterface): Promise<CacheReading | null> => {
  if (!transcriptPath) {
    try {
      transcriptPath = await findTranscript($)
    } catch {
      return null
    }
  }
  if (!transcriptPath) return null
  try {
    const result = await $.process.run(['tail', '-c', String(TAIL_BYTES), transcriptPath])
    return result.exitCode === 0 ? readingFromTranscript(result.stdout) : null
  } catch {
    return null
  }
}

// Plan limits are per account, and a session only learns them with its first response.
// Every session shares its latest reading through the store and fills in from it.
const LIMITS_KEY = 'limits'
type StoredLimits = { at: number; limits: LimitReading[] }
let limitsAt = 0

const withSharedLimits = async ($: EngineInterface, reading: UsageReading): Promise<UsageReading> => {
  const t = await $.clock.now()
  const isComplete = reading.limits.length > 0 && reading.limits.every(l => l.resetsAt !== null)
  if (isComplete) {
    limitsAt = t
    await $.store.set(LIMITS_KEY, { at: t, limits: reading.limits })
    return reading
  }
  // No limits yet, or some without a readable reset time: a stored reading is the better one.
  const stored = (await $.store.get(LIMITS_KEY)) as StoredLimits | undefined
  const valid = stored?.limits.filter(l => l.resetsAt !== null && l.resetsAt > t) ?? []
  return valid.length > 0 ? { ...reading, limits: valid } : reading
}

// Takes a fresher reading another session stored.
const pullSharedLimits = async ($: EngineInterface) => {
  const stored = (await $.store.get(LIMITS_KEY)) as StoredLimits | undefined
  if (!stored || stored.at <= limitsAt) return
  limitsAt = stored.at
  await update($, usage, prev => ({
    contextPercent: prev?.contextPercent ?? null,
    contextTokens: prev?.contextTokens ?? null,
    limits: stored.limits,
  }))
}

// Reads the cache lifetime of the last response, once its entry is in the transcript.
const lookUpTtl = async ($: EngineInterface) => {
  if (ttlPending === null) return
  ttlPending.lookups++
  const reading = await transcriptReading($)
  const isCurrent = reading !== null && reading.at > ttlPending.after
  if (reading && isCurrent) {
    transcriptSeenAt = reading.at
    await update($, cache, prev => (prev ? { ...prev, ttlMs: reading.ttlMs } : reading))
  }
  await trace($, `ttl lookup #${ttlPending.lookups} found=${isCurrent} ttl=${reading ? reading.ttlMs / MINUTE : '?'}m`)
  if (isCurrent || ttlPending.lookups >= TTL_LOOKUPS) ttlPending = null
}

const refreshUsage = async ($: EngineInterface) => {
  const u = await $.session.usage()
  const reading = await withSharedLimits($, toUsage(u.context, u.rateLimits))
  await update($, usage, () => reading)
}

const warnBeforeExpiry = async ($: EngineInterface, t: number) => {
  const reading = await read($, cache)
  if (reading === null || (await read($, working))) return

  const left = cacheLeftMs(reading, t)
  if (left > 0 && left <= WARN_BEFORE_MS && !warned.has(reading.at)) {
    if (warned.size > 100) warned.clear()
    warned.add(reading.at)
    const tokens = (await read($, usage))?.contextTokens
    const rewrite = tokens ? `; the next request rewrites about ${Math.round(tokens / 1000)}k tokens` : ''
    const session = shortId(await $.session.id())
    $.ui.toast(`Session ${session}: prompt cache expires in ${Math.ceil(left / MINUTE)} min${rewrite}`, { timeoutMs: 60_000 })
    await trace($, `toast left=${Math.round(left / 1000)}s`)
  }
}

// Status line for the desktop app, which cuts a footer item at about 28 characters: cache and
// context go here. The terminal shows a status line as a warning and has room in the footer,
// so there everything goes into the footer item.
const pushStatus = async ($: EngineInterface) => {
  if (!(await $.session.surfaces()).includes('desktop')) {
    if (statusShown !== undefined) {
      statusShown = undefined
      $.ui.status(undefined)
    }
    return
  }
  const t = await $.clock.now()
  const reading = await read($, cache)
  const u = await read($, usage)
  let text: string
  if (await read($, working)) {
    text = '● hot'
  } else if (reading === null) {
    text = '● …'
  } else {
    const left = cacheLeftMs(reading, t)
    text = `● ${left > 0 ? `${Math.ceil(left / MINUTE)}m` : 'cold'}`
  }
  if (u?.contextPercent != null) text += ` · ctx ${u.contextPercent}%`
  // Separates the status line from the footer item that follows it.
  if (u?.limits.length) text += ' ·'
  if (text !== statusShown) {
    statusShown = text
    $.ui.status(text)
  }
}

// The band's rows as they would draw at time t.
const rowsAt = async ($: EngineInterface, t: number) => {
  const u = await read($, usage)
  return bandRows({
    now: t,
    cache: await read($, cache),
    working: await read($, working),
    contextPercent: u?.contextPercent ?? null,
    contextTokens: u?.contextTokens ?? null,
    limits: u?.limits ?? [],
    sessionId: shortId(await $.session.id()),
    expectedBy: await read($, expectedBy),
    keystrokes: (await read($, keystrokesOn)) ? { chat: await read($, keysChat), today: await read($, keysToday) } : null,
  })
}

// The clock moves on every tick, but setting it redraws the band and the footer, and the Desktop
// app flickers on each redraw. Only set it when what the band shows changes; the band holds
// every value the footer shows. Other changes redraw through their own values.
let shownRows = ''
const advanceClock = async ($: EngineInterface, t: number) => {
  const target = await read($, pomodoroTarget)
  const blocks = target > 0 ? pomodoroText(pomodoroAt(await read($, pomodoroState), target, t)) : ''
  const timer = (await read($, timerOn)) ? timerText(timerAt(await read($, timerState), t)) : ''
  const rows = JSON.stringify(await rowsAt($, t)) + blocks + timer
  if (rows === shownRows) return
  shownRows = rows
  await update($, now, () => t)
}

const countRender = async ($: EngineInterface, site: string, surface: string) => {
  renders[site] = (renders[site] ?? 0) + 1
  const n = renders[site]
  if (n <= 3 || n % 50 === 0) await trace($, `render ${site} #${n} surface=${surface}`)
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    // Set the clock first: the band may draw before session.start runs.
    const t = await $.clock.now()
    await update($, now, () => t)
    transcriptPath = e.transcript_path
    const reading = await transcriptReading($)
    transcriptSeenAt = reading?.at ?? 0
    await update($, cache, () => reading)
    await trace($, `classic.SessionStart source=${e.source} reading=${reading !== null}`)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const t0 = await $.clock.now()
    await update($, now, () => t0)
    $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      await advanceClock($, t)
      await lookUpTtl($)
      await warnBeforeExpiry($, t)
      await pullSharedLimits($)
      await pullSettings($)
      await pullWater($)
      await alertWater($, t)
      await pullPomodoro($)
      await alertPomodoro($, t)
      await pullTimer($)
      await alertTimer($, t)
      await pushStatus($)
    })
    $.clock.every(KEYS_TICK_MS, () => flushKeystrokes($))
    // A running timer shows its seconds: the band redraws each second while it runs.
    $.clock.every(TIMER_TICK_MS, async () => {
      if (!(await read($, timerOn)) || (await read($, timerState)).since === null) return
      const t = await $.clock.now()
      await advanceClock($, t)
      await alertTimer($, t)
    })
    await pullSettings($)
    await pullWater($)
    await pullPomodoro($)
    await pullTimer($)
    await flushKeystrokes($)
    await refreshUsage($)
    if ((await read($, cache)) === null) {
      const reading = await transcriptReading($)
      transcriptSeenAt = reading?.at ?? 0
      await update($, cache, prev => prev ?? reading)
    }
    await pushStatus($)
    await trace($, `session.start surfaces=${(await $.session.surfaces()).join(',')} transcript=${transcriptPath !== null}`)
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    await trace($, `attach surface=${e.surface} client=${e.clientId}`)
    return next(e)
  })

  on('session.detach', async ($, e, next) => {
    await trace($, `detach client=${e.clientId}`)
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    if (counting) pendingKeys += keystrokesOf(e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (counting) await flushKeystrokes($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const reading = await withSharedLimits($, toUsage(e.context, e.rateLimits))
    await update($, usage, () => reading)
    await pushStatus($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    activeTurns.add(e.turnId)
    await update($, working, () => true)
    await pushStatus($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId && result.usage) {
      const u = result.usage
      const t = await $.clock.now()
      await update($, cache, prev => ({ at: t, hit: hitRatio(u), ttlMs: prev?.ttlMs ?? HOUR }))
      await update($, now, () => t)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    activeTurns.delete(e.turnId)
    await update($, working, () => activeTurns.size > 0)
    if (!e.agentId) {
      ttlPending = { after: transcriptSeenAt, lookups: 0 }
      await lookUpTtl($)
      for (const ms of TTL_QUICK_LOOKUPS_MS) {
        $.clock.after(ms, () => void lookUpTtl($))
      }
      await refreshUsage($)
    }
    await pushStatus($)
    return next(e)
  })

  // Footer item, drawn in every chat: the plan limits, colored by pace; in the terminal also
  // cache and context, which the desktop app shows in the status line instead.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    await countRender($, 'SessionMode', e.surface)
    const t = await read($, now)
    const u = await read($, usage)
    const modes = e.props.modes.join(' & ')

    const parts = []
    if (e.surface === 'terminal') {
      const reading = await read($, cache)
      if (await read($, working)) {
        parts.push(<Text color="green">● hot</Text>)
      } else if (reading === null) {
        parts.push(<Text dimColor>● …</Text>)
      } else {
        const left = cacheLeftMs(reading, t)
        parts.push(<Text color={cacheColor(left)}>● {left > 0 ? `${Math.ceil(left / MINUTE)}m` : 'cold'}</Text>)
      }
      if (u?.contextPercent != null) {
        parts.push(<Text dimColor> · </Text>)
        parts.push(<Text color={contextColor(u.contextPercent)}>ctx {u.contextPercent}%</Text>)
      }
    }
    for (const limit of (u?.limits ?? []).map(l => currentLimit(l, t))) {
      const name = LIMIT_LABEL[limit.kind]
      const windowMs = WINDOW_MS[limit.kind]
      if (!name || !windowMs) continue
      if (parts.length) parts.push(<Text dimColor> · </Text>)
      if (limit.resetsAt === null) {
        parts.push(<Text dimColor>{name} {Math.round(limit.used)}%</Text>)
        continue
      }
      const by = await read($, expectedBy)
      const expected = expectedPercent(windowMs, limit.resetsAt, expectedAt(by, limit.resetsAt, t))
      parts.push(
        <Text color={PACE_COLOR[pace(limit.used, expected)]}>
          {name} {Math.round(limit.used)}%/{Math.round(expected)}%
        </Text>,
      )
    }
    if (parts.length === 0) return next(e)

    return (
      <Box>
        {modes ? <Text dimColor>{modes} · </Text> : null}
        {parts}
      </Box>
    )
  })

  // Band above the prompt: one row each for cache, context and the plan limits, details in a
  // tooltip. Remote surfaces draw it as a small SVG; the terminal as text. The desktop app draws it
  // in one chat at a time.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await countRender($, 'AbovePrompt', e.surface)
    const rows = await rowsAt($, await read($, now))
    // Another mod later in the hook chain may draw here too: its band goes under ours instead of
    // being swallowed.
    const below = await next(e)
    const { Box: Stack } = $.ui.resolve(e)
    const stack = (band: RenderNode) => (below ? <Stack flexDirection="column">{band}{below}</Stack> : band)

    if (e.surface !== 'terminal') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      const picked = await read($, size)
      // The right column keeps one size: its native buttons do not scale, and it must never be cut off,
      // so where room is short the band beside it shrinks instead.
      const side = DEFAULT_SIZE
      const open = await read($, settingsOpen)
      const shownBy = await read($, expectedBy)
      const keysShown = await read($, keystrokesOn)
      const sessionId = rows.find(r => r.id)?.id
      const keys = (await read($, keystrokesOn)) ? { chat: await read($, keysChat), today: await read($, keysToday) } : null
      const target = await read($, waterTarget)
      const water = target > 0 ? await waterAt($, target) : null
      const blocks = await read($, pomodoroTarget)
      const pomodoro = blocks > 0 ? pomodoroAt(await read($, pomodoroState), blocks, await read($, now)) : null
      const timerShown = await read($, timerOn)
      const timer = timerShown ? timerAt(await read($, timerState), await read($, now)) : null
      // The presses are handled by the ui.press hook below, which has the engine at hand.
      const press = () => {}
      // One setting: its name, then a button per value, the picked one drawn as primary.
      // Resets, when given, follow the values, away from Off, in the pomodoro's red pill: the
      // desktop draws a native button and keeps no text color of its own.
      const choices = (name: string, values: [key: string, label: string, isPicked: boolean][], resets: [key: string, label: string][] = []) => (
        <Box marginRight={2} alignItems="center" flexShrink={0}>
          <Text dimColor>{name}: </Text>
          {values.map(([key, label, isPicked]) => (
            <Box marginRight={1}>
              <Button key={key} label={label} variant={isPicked ? 'primary' : 'secondary'} onPress={press} />
            </Box>
          ))}
          {resets.map(([key, label]) => (
            <Box marginLeft={1} marginRight={1} {...pill('pomodoro')}>
              <Button key={key} onPress={press}>
                <Text color={RESET_COLOR}>{label}</Text>
              </Button>
            </Box>
          ))}
        </Box>
      )
      const separatorShown = await read($, separator)
      const soundsShown = await read($, soundsOn)
      // Drawn as an image, the band keeps its size where room is short and pushes the right column out
      // of view: it is scaled down to the room the right column leaves, a column taken as PX_PER_COLUMN pixels.
      const room = e.props.bodyColumns * PX_PER_COLUMN - RIGHT_COLUMN_PX
      const fit = room > 0 ? Math.min(1, room / svgWidth(picked)) : 1
      const layout = `layout bodyColumns=${e.props.bodyColumns} size=${picked} fit=${fit.toFixed(2)}`
      if (layout !== lastLayout) {
        lastLayout = layout
        await trace($, layout)
      }
      return stack(
        <Box flexDirection="column">
          <Box>
            <Box key="band-tip">
            <Svg
              source={bandSvg(
                rows.map(r => ({ ...r, id: undefined })),
                picked,
              )}
              alt={bandAlt(rows)}
              width={Math.floor(svgWidth(picked) * fit)}
              height={Math.floor(svgHeight(rows.length, picked) * fit)}
            />
            {tipCard(rows.map(r => r.tip), { Box, Text })}
            </Box>
            {/* The session id, the pills for water and keystrokes and the settings button, flush with the
                right edge of the band's area. */}
            <Box flexGrow={1} flexShrink={0} flexDirection="column" alignItems="flex-end" marginLeft={1}>
              {sessionId ? (
                <Svg
                  source={idSvg(sessionId, side)}
                  alt={`ID: ${sessionId}`}
                  width={idSvgWidth(side)}
                  height={idSvgHeight(side)}
                />
              ) : null}
              {pomodoro || timer || water ? (
                <Box alignItems="center" columnGap={1}>
                  {pomodoro ? (
                    <Box key="pomodoro-tip" {...pill(pomodoro.phase === 'break' ? 'pomodoroBreak' : 'pomodoro')} columnGap={0}>
                      <Svg source={iconSvg('pomodoro', side)} alt="Pomodoro" width={iconSvgSize(side)} height={iconSvgSize(side)} />
                      {pomodoro.phase === 'idle' ? (
                        <Button key="pomodoro-start" label="▶" plain onPress={press} />
                      ) : (
                        <Button key="pomodoro-stop" label="■" plain onPress={press} />
                      )}
                      <Svg
                        source={waterSvg(pomodoroText(pomodoro), POMODORO_COLOR[pomodoro.phase], pomodoroTip(pomodoro), side)}
                        alt={pomodoroTip(pomodoro)}
                        width={waterSvgWidth(pomodoroText(pomodoro), side)}
                        height={waterSvgHeight(side)}
                      />
                      {tipCard([pomodoroTip(pomodoro)], { Box, Text })}
                    </Box>
                  ) : null}
                  {timer ? (
                    <Box key="timer-tip" {...pill('pomodoro')} columnGap={0}>
                      <Svg source={iconSvg('timer', side)} alt="Timer" width={iconSvgSize(side)} height={iconSvgSize(side)} />
                      <Button key="timer-minus" label="−" plain onPress={press} />
                      {timer.phase === 'running' ? (
                        <Button key="timer-stop" label="■" plain onPress={press} />
                      ) : (
                        <Button key="timer-start" label="▶" plain onPress={press} />
                      )}
                      <Button key="timer-plus" label="+" plain onPress={press} />
                      <Svg
                        source={waterSvg(timerText(timer), TIMER_COLOR[timer.phase], timerTip(timer), side)}
                        alt={timerTip(timer)}
                        width={waterSvgWidth(timerText(timer), side)}
                        height={waterSvgHeight(side)}
                      />
                      <Svg
                        source={waterSvg(`/${timer.totalMs / MINUTE}`, 'gray', timerTip(timer), side)}
                        alt={`of ${timer.totalMs / MINUTE} min`}
                        width={waterSvgWidth(`/${timer.totalMs / MINUTE}`, side)}
                        height={waterSvgHeight(side)}
                      />
                      <Button key="timer-reset" label="↺" plain onPress={press} />
                      {tipCard([timerTip(timer)], { Box, Text })}
                    </Box>
                  ) : null}
                  {water ? (
                    <Box key="water-tip" {...pill('water')} columnGap={0}>
                      <Svg source={iconSvg('water', side)} alt="Water" width={iconSvgSize(side)} height={iconSvgSize(side)} />
                      <Button key="water-minus" label="−" plain onPress={press} />
                      <Svg
                        source={waterSvg(String(water.drunk), water.color, waterTip(water), side)}
                        alt={waterTip(water)}
                        width={waterSvgWidth(String(water.drunk), side)}
                        height={waterSvgHeight(side)}
                      />
                      <Button key="water-plus" label="+" plain onPress={press} />
                      <Svg
                        source={waterSvg(`/${water.target}`, 'gray', waterTip(water), side)}
                        alt={`of ${water.target}`}
                        width={waterSvgWidth(`/${water.target}`, side)}
                        height={waterSvgHeight(side)}
                      />
                      {tipCard([waterTip(water)], { Box, Text })}
                    </Box>
                  ) : null}
                </Box>
              ) : null}
              <Box alignItems="center" columnGap={1} marginTop="xs">
                {keys ? (
                  <Box key="keys-tip" {...pill('keys')}>
                    <Svg source={iconSvg('keys', side)} alt="Keystrokes" width={iconSvgSize(side)} height={iconSvgSize(side)} />
                    <Svg
                      source={keysSvg(keys, side)}
                      alt={`Keystrokes ${keys.chat} in this chat, ${keys.today} today`}
                      width={keysSvgWidth(keys, side)}
                      height={keysSvgHeight(side)}
                    />
                    {tipCard([keysTip(keys)], { Box, Text })}
                  </Box>
                ) : null}
                <Button key="settings" label={open ? '⚙ Close' : '⚙'} onPress={press} />
              </Box>
            </Box>
          </Box>
          {open ? (
            <Box
              marginTop={1}
              paddingX={1}
              flexDirection="column"
              borderStyle="round"
              borderColor={SETTINGS_BORDER}
              backgroundColor={SETTINGS_BACKGROUND}
            >
              <Box>
                <Box width={GROUP_WIDTH}>
                  <Text dimColor>Wellbeing</Text>
                </Box>
                {choices('Pomodoros', range(POMODORO_MAX_TARGET).map(n => [`pomodoro-target-${n}`, n ? String(n) : 'Off', n === blocks]), [['pomodoro-reset', 'Reset']])}
                {choices('Timer', [
                  ['timer-off', 'Off', !timerShown],
                  ['timer-on', 'On', timerShown],
                ])}
              </Box>
              <Box marginTop={1}>
                <Box width={GROUP_WIDTH} />
                {choices('Water units per day', range(WATER_MAX_TARGET / 2).map(n => n * 2).map(n => [`water-target-${n}`, n ? String(n) : 'Off', n === target]))}
              </Box>
              <Box marginTop={1}>
                <Box width={GROUP_WIDTH}>
                  <Text dimColor>Display</Text>
                </Box>
                {choices('Size', (Object.keys(SIZES) as Size[]).map(s => [`size-${s}`, s, s === picked]))}
                {choices('Limits by', [
                  ['expected-now', 'Now', shownBy === 'now'],
                  ['expected-midnight', 'Midnight', shownBy === 'midnight'],
                ])}
                {choices('Numbers', [
                  ['separator-comma', '1,234', separatorShown === ','],
                  ['separator-dot', '1.234', separatorShown === '.'],
                ])}
              </Box>
              <Box marginTop={1}>
                <Box width={GROUP_WIDTH} />
                {choices('Keystrokes', [
                  ['keystrokes-off', 'Off', !keysShown],
                  ['keystrokes-on', 'On', keysShown],
                ], [
                  ['keystrokes-reset-chat', 'Reset chat'],
                  ['keystrokes-reset-all', 'Reset all'],
                ])}
                {/* Sounds at the right end of the row. */}
                <Box flexGrow={1} />
                {choices('Sounds', [
                  ['sounds-off', 'Off', !soundsShown],
                  ['sounds-on', 'On', soundsShown],
                ])}
              </Box>
            </Box>
          ) : null}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    return stack(
      <Box flexDirection="column">
        {rows.map(row => {
          const { filled, marker } = bar(BAR_CELLS, row.fill, row.marker)
          const fill = barColor(row.color)
          return (
            <Box>
              <Box width={8}>
                {row.label.startsWith('●') ? <Text color={row.color}>{row.label}</Text> : <Text dimColor>{row.label}</Text>}
              </Box>
              <Box width={9}>
                <Text color={row.color}>{row.value}</Text>
              </Box>
              {Array.from({ length: BAR_CELLS }, (_, i) =>
                i === marker ? <Text>│</Text> : i < filled ? <Text color={fill}>■</Text> : <Text dimColor>■</Text>,
              )}
              <Text dimColor> {row.detail}{row.id ? `${row.detail ? ' · ' : ''}ID: ` : ''}</Text>
              {row.id ? <Text color={ID_COLOR}>{row.id}</Text> : null}
              {row.keys ? <Text dimColor> · Keys: {row.keys}</Text> : null}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.press', { plugin: 'dashband' }, async ($, e, next) => {
    if (e.element === 'settings') {
      await update($, settingsOpen, open => !open)
    } else if (e.element.startsWith('size-')) {
      const picked = e.element.slice('size-'.length)
      if (isSize(picked)) {
        await storeSetting($, { size: picked })
        await update($, size, () => picked)
      }
    } else if (e.element.startsWith('expected-')) {
      const by = e.element.slice('expected-'.length)
      if (isExpectedBy(by)) {
        await storeSetting($, { expectedBy: by })
        await update($, expectedBy, () => by)
      }
    } else if (e.element === 'water-minus' || e.element === 'water-plus') {
      await pullWater($, e.element === 'water-plus' ? 1 : -1)
    } else if (e.element.startsWith('sounds-')) {
      const isLoud = e.element === 'sounds-on'
      await storeSetting($, { sounds: isLoud })
      await update($, soundsOn, () => isLoud)
      // Turning sounds on plays the gong once, so its volume can be judged.
      if (isLoud) gong($, 'high')
    } else if (e.element.startsWith('separator-')) {
      const sep = e.element === 'separator-dot' ? '.' : ','
      setSeparator(sep)
      await storeSetting($, { separator: sep })
      await update($, separator, () => sep)
      shownRows = ''
    } else if (e.element === 'pomodoro-start') {
      const target = await read($, pomodoroTarget)
      await pullPomodoro($, (state, t) => startPomodoro(state, target, t))
      const t = await $.clock.now()
      await update($, now, () => t)
    } else if (e.element === 'pomodoro-stop') {
      await pullPomodoro($, stopPomodoro)
    } else if (e.element === 'pomodoro-reset') {
      await pullPomodoro($, resetPomodoro)
    } else if (e.element === 'timer-on' || e.element === 'timer-off') {
      // The timer and the pomodoros share one place: turning the timer on turns the pomodoros off.
      const isOn = e.element === 'timer-on'
      await storeSetting($, isOn ? { timer: true, pomodoros: 0 } : { timer: false })
      await update($, timerOn, () => isOn)
      if (isOn) {
        await update($, pomodoroTarget, () => 0)
        await pullPomodoro($, stopPomodoro)
      }
      // Off pauses a running timer: nothing runs unseen.
      await pullTimer($, isOn ? undefined : pauseTimer)
    } else if (e.element === 'timer-start' || e.element === 'timer-stop' || e.element === 'timer-reset') {
      const change = e.element === 'timer-start' ? startTimer : e.element === 'timer-stop' ? pauseTimer : resetTimer
      await pullTimer($, change)
      const t = await $.clock.now()
      await update($, now, () => t)
    } else if (e.element === 'timer-minus' || e.element === 'timer-plus') {
      const steps = e.element === 'timer-plus' ? 1 : -1
      await pullTimer($, (state, t) => stepTimer(state, t, steps))
      const t = await $.clock.now()
      await update($, now, () => t)
    } else if (e.element === 'keystrokes-reset-chat') {
      await update($, keysChat, () => 0)
    } else if (e.element === 'keystrokes-reset-all') {
      await resetKeystrokes($)
    } else if (e.element.startsWith('pomodoro-target-')) {
      const target = Number(e.element.slice('pomodoro-target-'.length))
      if (isPomodoroTarget(target)) {
        // A number of pomodoros turns the timer off.
        await storeSetting($, target > 0 ? { pomodoros: target, timer: false } : { pomodoros: target })
        await update($, pomodoroTarget, () => target)
        if (target > 0 && (await read($, timerOn))) {
          await update($, timerOn, () => false)
          await pullTimer($, pauseTimer)
        }
        // Off stops a running block, as ■ does: nothing runs unseen.
        await pullPomodoro($, target > 0 ? undefined : stopPomodoro)
      }
    } else if (e.element.startsWith('water-target-')) {
      const target = Number(e.element.slice('water-target-'.length))
      if (isWaterTarget(target)) {
        await storeSetting($, { water: target })
        await update($, waterTarget, () => target)
        if (target > 0) await pullWater($)
      }
    } else if (e.element.startsWith('keystrokes-')) {
      const isOn = e.element === 'keystrokes-on'
      // Keys not yet written when counting is turned off are dropped.
      if (!isOn) pendingKeys = 0
      counting = isOn
      await storeSetting($, { keystrokes: isOn })
      await update($, keystrokesOn, () => isOn)
      if (isOn) await flushKeystrokes($)
    }
    return next(e)
  })
}
