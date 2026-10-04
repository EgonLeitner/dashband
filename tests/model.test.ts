import { expect, test } from 'claude-code/testing'

import { HOUR, MINUTE, bar, cacheColor, duration, expectedPercent, pace, readingFromTranscript, warnTimes } from '../hooks/model'

const WEEK = 7 * 24 * HOUR

test('expected usage follows the elapsed share of the window', async () => {
  const now = 1_000_000_000
  expect(expectedPercent(WEEK, now + WEEK, now)).toBe(0)
  expect(expectedPercent(WEEK, now + WEEK / 4, now)).toBe(75)
  expect(expectedPercent(WEEK, now - HOUR, now)).toBe(100)
})

test('pace colors usage against where it should be', async () => {
  expect(pace(50, 96)).toBe('under')
  expect(pace(94, 96)).toBe('on')
  expect(pace(100, 92)).toBe('over')
  expect(pace(80, 50)).toBe('far-over')
})

test('the transcript gives the last response and the latest cache lifetime', async () => {
  const line = (timestamp: string, creation: object | null, extra: object = {}) =>
    JSON.stringify({
      type: 'assistant',
      timestamp,
      message: {
        usage: { input_tokens: 2, cache_read_input_tokens: 98, cache_creation_input_tokens: 0, cache_creation: creation },
      },
      ...extra,
    })
  const tail = [
    'partial line cut by tail',
    line('2026-10-04T10:00:00.000Z', { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 0 }),
    line('2026-10-04T10:01:00.000Z', { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }),
    line('2026-10-04T10:02:00.000Z', null, { isSidechain: true }),
  ].join('\n')

  const reading = readingFromTranscript(tail)
  expect(reading?.at).toBe(Date.parse('2026-10-04T10:01:00.000Z'))
  expect(reading?.hit).toBe(0.98)
  expect(reading?.ttlMs).toBe(5 * MINUTE)
  expect(readingFromTranscript('no json here')).toBe(null)
})

test('bars place the filled cells and the expected marker', async () => {
  expect(bar(20, 50)).toEqual({ filled: 10, marker: -1 })
  expect(bar(20, 70, 96)).toEqual({ filled: 14, marker: 19 })
})

test('durations stay short', async () => {
  expect(duration(3 * 24 * HOUR + 4 * HOUR)).toBe('3d 4h')
  expect(duration(2 * HOUR + 15 * MINUTE)).toBe('2h 15m')
  expect(duration(9 * MINUTE)).toBe('9m')
})

test('warnings and yellow follow the cache lifetime', async () => {
  expect(warnTimes(HOUR)).toEqual([5 * MINUTE, MINUTE])
  expect(warnTimes(5 * MINUTE)).toEqual([MINUTE])
  expect(cacheColor(4 * MINUTE, HOUR)).toBe('yellow')
  expect(cacheColor(4 * MINUTE, 5 * MINUTE)).toBe('green')
  expect(cacheColor(30_000, 5 * MINUTE)).toBe('yellow')
  expect(cacheColor(0, 5 * MINUTE)).toBe('gray')
})
