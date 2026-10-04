import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { CacheReading, LimitReading, UsageReading } from '../types'
import {
  HOUR,
  LIMIT_LABEL,
  LIMIT_NAME,
  MINUTE,
  PACE_COLOR,
  WINDOW_MS,
  bar,
  cacheColor,
  cacheLeftMs,
  contextColor,
  warnTimes,
  duration,
  expectedPercent,
  hitRatio,
  pace,
  parseResetsAt,
  readingFromTranscript,
} from './model'

const TICK_MS = 15_000
const BAR_WIDTH = 24
const TAIL_BYTES = 262_144

const cache = atom({ plugin: 'dashband', key: 'cache' } as const, null)
const usage = atom({ plugin: 'dashband', key: 'usage' } as const, null)
const working = atom({ plugin: 'dashband', key: 'working' } as const, false)
const now = atom({ plugin: 'dashband', key: 'now' } as const, 0)

// Optional trace for troubleshooting: on while this directory exists
// (`mkdir /tmp/dashband-trace`). Each session writes its own log there. Checked on every
// entry, because writing a log would otherwise recreate the directory after it was removed.
const TRACE_DIR = '/tmp/dashband-trace'
const TRACE_MAX_LINES = 500
const traceLines: string[] = []

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
const warned = new Set<string>()
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
  for (const before of warnTimes(reading.ttlMs)) {
    const key = `${reading.at}:${before}`
    if (left > 0 && left <= before && !warned.has(key)) {
      warned.add(key)
      const tokens = (await read($, usage))?.contextTokens
      const rewrite = tokens ? `; the next request rewrites about ${Math.round(tokens / 1000)}k tokens` : ''
      $.ui.toast(`Prompt cache expires in ${Math.ceil(left / MINUTE)} min${rewrite}`, { timeoutMs: 10_000 })
    }
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

const countRender = async ($: EngineInterface, site: string, surface: string) => {
  renders[site] = (renders[site] ?? 0) + 1
  const n = renders[site]
  if (n <= 3 || n % 50 === 0) await trace($, `render ${site} #${n} surface=${surface}`)
}

export const register: Register = on => {
  on('classic.SessionStart', async ($, e, next) => {
    transcriptPath = e.transcript_path
    const reading = await transcriptReading($)
    transcriptSeenAt = reading?.at ?? 0
    await update($, cache, () => reading)
    await trace($, `classic.SessionStart source=${e.source} reading=${reading !== null}`)
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await update($, now, async () => await $.clock.now())
    $.clock.every(TICK_MS, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
      await lookUpTtl($)
      await warnBeforeExpiry($, t)
      await pullSharedLimits($)
      await pushStatus($)
    })
    await refreshUsage($)
    await trace($, `limits at start: ${JSON.stringify((await $.session.usage()).rateLimits)}`)
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

  on('session.measure', async ($, e, next) => {
    const reading = await withSharedLimits($, toUsage(e.context, e.rateLimits))
    await update($, usage, () => reading)
    await pushStatus($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
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
    if (!e.agentId) {
      await update($, working, () => false)
      ttlPending = { after: transcriptSeenAt, lookups: 0 }
      await lookUpTtl($)
      for (const ms of TTL_QUICK_LOOKUPS_MS) {
        $.clock.after(ms, () => void lookUpTtl($))
      }
      await refreshUsage($)
      await pushStatus($)
    }
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
        parts.push(<Text color={cacheColor(left, reading.ttlMs)}>● {left > 0 ? `${Math.ceil(left / MINUTE)}m` : 'cold'}</Text>)
      }
      if (u?.contextPercent != null) {
        parts.push(<Text dimColor> · </Text>)
        parts.push(<Text color={contextColor(u.contextPercent)}>ctx {u.contextPercent}%</Text>)
      }
    }
    for (const limit of u?.limits ?? []) {
      const name = LIMIT_LABEL[limit.kind]
      const windowMs = WINDOW_MS[limit.kind]
      if (!name || !windowMs) continue
      if (parts.length) parts.push(<Text dimColor> · </Text>)
      if (limit.resetsAt === null) {
        parts.push(<Text dimColor>{name} {Math.round(limit.used)}%</Text>)
        continue
      }
      const expected = expectedPercent(windowMs, limit.resetsAt, t)
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

  // Band above the prompt: bars and details. The desktop app draws it in one chat at a time.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    await countRender($, 'AbovePrompt', e.surface)
    const t = await read($, now)
    const reading = await read($, cache)
    const isWorking = await read($, working)
    const u = await read($, usage)

    const cells = (used: number, color: string, expected?: number) => {
      const { filled, marker } = bar(BAR_WIDTH, used, expected)
      const fill = color === 'gray' ? 'green' : color
      return Array.from({ length: BAR_WIDTH }, (_, i) =>
        i === marker ? <Text>│</Text> : i < filled ? <Text color={fill}>■</Text> : <Text dimColor>■</Text>,
      )
    }
    // Fixed columns: the desktop app draws proportional text, so padding with spaces does not align.
    const label = (text: string, color?: string) => (
      <Box width={15}>{color ? <Text color={color}>{text}</Text> : <Text dimColor>{text}</Text>}</Box>
    )
    const value = (text: string, color: string) => (
      <Box width={10}>
        <Text color={color}>{text}</Text>
      </Box>
    )

    const rows = []
    if (reading === null) {
      rows.push(<Text dimColor>● prompt cache: waiting for the next response</Text>)
    } else {
      const left = isWorking ? reading.ttlMs : cacheLeftMs(reading, t)
      const color = isWorking ? 'green' : cacheColor(left, reading.ttlMs)
      const status = isWorking ? 'hot' : left > 0 ? `${Math.ceil(left / MINUTE)}m` : 'cold'
      rows.push(
        <Box>
          {label('● prompt cache', color)}
          {value(status, color)}
          {cells((left / reading.ttlMs) * 100, color)}
          <Text dimColor> {Math.round(reading.hit * 100)}% hit · {reading.ttlMs >= HOUR ? '1h' : '5m'} cache</Text>
        </Box>,
      )
    }
    if (u?.contextPercent != null) {
      const color = contextColor(u.contextPercent)
      rows.push(
        <Box>
          {label('  context')}
          {value(`${u.contextPercent}%`, color)}
          {cells(u.contextPercent, color)}
          {u.contextTokens ? <Text dimColor> {Math.round(u.contextTokens / 1000)}k tokens</Text> : null}
        </Box>,
      )
    }
    for (const limit of u?.limits ?? []) {
      const name = LIMIT_NAME[limit.kind]
      const windowMs = WINDOW_MS[limit.kind]
      if (!name || !windowMs || limit.resetsAt === null) continue
      const expected = expectedPercent(windowMs, limit.resetsAt, t)
      const color = PACE_COLOR[pace(limit.used, expected)]
      rows.push(
        <Box>
          {label(`  ${name}`)}
          {value(`${Math.round(limit.used)}%/${Math.round(expected)}%`, color)}
          {cells(limit.used, color, expected)}
          <Text dimColor> resets in {duration(limit.resetsAt - t)}</Text>
        </Box>,
      )
    }

    return <Box flexDirection="column">{rows}</Box>
  })
}
