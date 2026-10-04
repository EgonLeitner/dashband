import type { CacheReading } from '../types'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

// Length of each rate-limit window the band knows how to pace.
export const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * HOUR,
  seven_day: 7 * 24 * HOUR,
}

export const LIMIT_LABEL: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'WL',
}

// Spelled-out names for the band, where there is room.
export const LIMIT_NAME: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'weekly limit',
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

// Where usage of a window should be by now if it were spread evenly, 0 to 100.
export const expectedPercent = (windowMs: number, resetsAt: number, now: number): number => {
  const elapsed = windowMs - (resetsAt - now)
  return Math.min(100, Math.max(0, (elapsed / windowMs) * 100))
}

export const pace = (used: number, expected: number): Pace => {
  const ahead = used - expected
  if (ahead <= PACE_UNDER) return 'under'
  if (ahead <= PACE_OVER) return 'on'
  if (ahead <= PACE_FAR_OVER) return 'over'
  return 'far-over'
}

export const cacheLeftMs = (reading: CacheReading, now: number): number =>
  Math.max(0, reading.ttlMs - (now - reading.at))

// When to warn before the cache expires: five minutes and one minute ahead, keeping only the
// times shorter than the cache lifetime (a five-minute cache warns at one minute only).
export const warnTimes = (ttlMs: number): number[] => [5 * MINUTE, MINUTE].filter(before => before < ttlMs)

export const cacheColor = (leftMs: number, ttlMs: number): string =>
  leftMs <= 0 ? 'gray' : leftMs <= (warnTimes(ttlMs)[0] ?? 0) ? 'yellow' : 'green'

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
