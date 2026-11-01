import { expect, test } from 'claude-code/testing'

import { BURST_MAX_CHARS, HOUR, MINUTE, gongWav, isPomodoroTarget, isSeparator, setSeparator, pomodoroAt, startPomodoro, stopPomodoro, freshTimer, isTimerState, pauseTimer, resetTimer, startTimer, stepTimer, timerAt, timerRanOut, keysMark, pomodoroOfDay, resetPomodoro, WATER_FROM_HOUR, WATER_TO_HOUR, bar, groupDigits, isWaterTarget, waterColor, waterDue, keystrokesOf, localDay, expectedAt, nextMidnight, cacheColor, currentLimit, duration, expectedPercent, pace, parseResetsAt, readingFromTranscript } from '../hooks/model'

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
  expect(pace(99, 92)).toBe('over')
  expect(pace(80, 50)).toBe('far-over')
  expect(pace(100, 98)).toBe('far-over')
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

test('the band turns yellow two minutes before the cache expires', async () => {
  expect(cacheColor(3 * MINUTE)).toBe('green')
  expect(cacheColor(2 * MINUTE)).toBe('yellow')
  expect(cacheColor(0)).toBe('gray')
})

test('reset times read from ISO, epoch seconds and epoch milliseconds', async () => {
  const ms = Date.parse('2026-10-05T07:00:00.000Z')
  expect(parseResetsAt('2026-10-05T07:00:00.000Z')).toBe(ms)
  expect(parseResetsAt(String(ms / 1000))).toBe(ms)
  expect(parseResetsAt(ms / 1000)).toBe(ms)
  expect(parseResetsAt(ms)).toBe(ms)
  expect(parseResetsAt('soon')).toBe(null)
  expect(parseResetsAt(undefined)).toBe(null)
})

test('a limit read before its window reset no longer counts', async () => {
  const reset = Date.parse('2026-10-05T05:00:00.000Z')
  const now = reset + 37 * MINUTE
  expect(currentLimit({ kind: 'seven_day', used: 77, resetsAt: reset }, now)).toEqual({
    kind: 'seven_day',
    used: 0,
    resetsAt: reset + WEEK,
  })
  expect(currentLimit({ kind: 'five_hour', used: 26, resetsAt: reset }, now)).toEqual({
    kind: 'five_hour',
    used: 0,
    resetsAt: null,
  })
  const fresh = { kind: 'seven_day', used: 5, resetsAt: reset + WEEK }
  expect(currentLimit(fresh, now)).toBe(fresh)
})

test('expected usage can look ahead to midnight, but not past the reset', async () => {
  const now = new Date(2026, 9, 28, 10, 0).getTime()
  const midnight = new Date(2026, 9, 29, 0, 0).getTime()
  expect(nextMidnight(now)).toBe(midnight)
  expect(expectedAt('now', now + WEEK, now)).toBe(now)
  expect(expectedAt('midnight', now + WEEK, now)).toBe(midnight)
  expect(expectedAt('midnight', now + 2 * HOUR, now)).toBe(now + 2 * HOUR)
})

test('typed characters count, deletions count once, moves and pastes not at all', async () => {
  // A key the editor folds a space into still counts both characters.
  expect(keystrokesOf({ key: { key: 'n' }, start: 8, end: 8, inputText: ' n' })).toBe(2)
  expect(keystrokesOf({ key: { key: 'backspace' }, start: 3, end: 4, inputText: '' })).toBe(1)
  expect(keystrokesOf({ key: { key: 'left' }, start: 1, end: 1, inputText: '' })).toBe(0)
  expect(keystrokesOf({ start: 39, end: 39, inputText: 'x'.repeat(9) })).toBe(9)
  expect(keystrokesOf({ start: 0, end: 0, inputText: 'x'.repeat(BURST_MAX_CHARS) })).toBe(BURST_MAX_CHARS)
  expect(keystrokesOf({ start: 87, end: 87, inputText: 'x'.repeat(102) })).toBe(0)
})

test('the day is the local calendar day', async () => {
  expect(localDay(new Date(2026, 9, 28, 23, 59).getTime())).toBe('2026-10-28')
  expect(localDay(new Date(2026, 9, 29, 0, 0).getTime())).toBe('2026-10-29')
})

test('counts are whole numbers with the thousands separator picked in the settings', async () => {
  expect(groupDigits(0)).toBe('0')
  expect(groupDigits(847)).toBe('847')
  expect(groupDigits(1234567.4)).toBe('1,234,567')
  setSeparator('.')
  expect(groupDigits(1234567)).toBe('1.234.567')
  setSeparator(',')
  expect(isSeparator(';')).toBe(false)
})

const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m).getTime()

test('water is due evenly between its hours, none before, all after', async () => {
  expect(waterDue(8, at(WATER_FROM_HOUR - 1))).toBe(0)
  expect(waterDue(8, at(14))).toBe(4)
  expect(waterDue(8, at(WATER_TO_HOUR))).toBe(8)
  expect(waterDue(8, at(23, 30))).toBe(8)
})

test('water draws green on target, orange one behind, red two behind', async () => {
  // 14:00 with 8 a day: 4 due.
  expect(waterColor(4, 8, at(14))).toBe('green')
  expect(waterColor(6, 8, at(14))).toBe('green')
  expect(waterColor(3, 8, at(14))).toBe('orange')
  expect(waterColor(2, 8, at(14))).toBe('red')
  // 3.5 due counts as 3.
  expect(waterColor(3, 8, at(13, 7))).toBe('green')
  expect(waterColor(0, 8, at(6))).toBe('green')
})

test('a water target is a whole number from 0 (off) to 20', async () => {
  expect(isWaterTarget(0)).toBe(true)
  expect(isWaterTarget(20)).toBe(true)
  expect(isWaterTarget(21)).toBe(false)
  expect(isWaterTarget(2.5)).toBe(false)
  expect(isWaterTarget('8')).toBe(false)
})


test('a pomodoro runs 25 minutes, then a short break, the last of the series a long one', () => {
  const t = 1_000_000_000
  let state = startPomodoro({ started: 0, since: null }, 2, t)
  expect(pomodoroAt(state, 2, t + 10 * MINUTE)).toEqual({ phase: 'focus', started: 1, target: 2, leftMs: 15 * MINUTE })
  expect(pomodoroAt(state, 2, t + 27 * MINUTE)).toEqual({ phase: 'break', started: 1, target: 2, leftMs: 3 * MINUTE })
  expect(pomodoroAt(state, 2, t + 31 * MINUTE).phase).toBe('idle')
  // Start is ignored while a block runs.
  expect(startPomodoro(state, 2, t + MINUTE)).toEqual(state)
  state = startPomodoro(state, 2, t + 40 * MINUTE)
  expect(pomodoroAt(state, 2, t + 70 * MINUTE)).toEqual({ phase: 'break', started: 2, target: 2, leftMs: 10 * MINUTE })
  // After the long break the series starts over.
  expect(pomodoroAt(state, 2, t + 81 * MINUTE)).toEqual({ phase: 'idle', started: 0, target: 2, leftMs: 0 })
  expect(startPomodoro(state, 2, t + 81 * MINUTE).started).toBe(1)
})

test('a stopped pomodoro stays counted, and a target is a whole number from 0 (off) to 6', () => {
  const state = stopPomodoro(startPomodoro({ started: 0, since: null }, 4, 0))
  expect(pomodoroAt(state, 4, MINUTE)).toEqual({ phase: 'idle', started: 1, target: 4, leftMs: 0 })
  expect(isPomodoroTarget(6)).toBe(true)
  expect(isPomodoroTarget(7)).toBe(false)
})

test('the gong is a mono 16-bit WAV of the asked length', () => {
  const wav = gongWav(880, 100)
  // "RIFF" in base64, then 2,205 samples of 2 bytes after a 44-byte header.
  expect(wav.startsWith('UklGR')).toBe(true)
  expect(Math.ceil((44 + 2205 * 2) / 3) * 4).toBe(wav.length)
})

test('a series starts over on a new day, unless its last block or break still runs', async () => {
  const day = localDay(at(10))
  const yesterday = localDay(at(10) - 24 * HOUR)
  expect(pomodoroOfDay({ started: 2, since: at(9), day }, day, at(10))).toEqual({ started: 2, since: at(9) })
  expect(pomodoroOfDay({ started: 2, since: null, day: yesterday }, day, at(10))).toEqual(resetPomodoro())
  expect(pomodoroOfDay({ started: 2, since: at(0) - 70 * MINUTE, day: yesterday }, day, at(0, 30))).toEqual(resetPomodoro())
  expect(pomodoroOfDay({ started: 2, since: at(0) - 10 * MINUTE, day: yesterday }, day, at(0, 5))).toEqual({ started: 2, since: at(0) - 10 * MINUTE })
  expect(pomodoroOfDay(undefined, day, at(10))).toEqual({ started: 0, since: null })
})

test('every chat counts keys anew at midnight and after a Reset all, not on a plain write', async () => {
  expect(keysMark(undefined, '2026-11-01')).toBe('2026-11-01:0')
  expect(keysMark({ day: '2026-10-31', reset: 5 }, '2026-11-01')).toBe('2026-11-01:0')
  expect(keysMark({ day: '2026-11-01' }, '2026-11-01')).toBe('2026-11-01:0')
  expect(keysMark({ day: '2026-11-01', reset: 5 }, '2026-11-01')).toBe('2026-11-01:5')
})

test('a timer counts down, pauses, resets and waits again at its full time when it runs out', async () => {
  const s = freshTimer()
  expect(timerAt(s, 0)).toEqual({ phase: 'idle', leftMs: 25 * MINUTE, totalMs: 25 * MINUTE })
  const running = startTimer(s, 0)
  expect(timerAt(running, 10 * MINUTE)).toEqual({ phase: 'running', leftMs: 15 * MINUTE, totalMs: 25 * MINUTE })
  const paused = pauseTimer(running, 10 * MINUTE)
  expect(timerAt(paused, 99 * MINUTE).phase).toBe('paused')
  expect(timerAt(startTimer(paused, 100 * MINUTE), 105 * MINUTE).leftMs).toBe(10 * MINUTE)
  expect(timerRanOut(running, 25 * MINUTE)).toBe(true)
  expect(timerAt(running, 30 * MINUTE)).toEqual({ phase: 'idle', leftMs: 25 * MINUTE, totalMs: 25 * MINUTE })
  expect(resetTimer(paused)).toEqual(freshTimer())
  expect(pauseTimer(running, 30 * MINUTE)).toEqual(freshTimer())
  expect(pauseTimer(paused, 40 * MINUTE)).toEqual(paused)
  expect(isTimerState(paused)).toBe(true)
  expect(isTimerState({ totalMs: 1, leftMs: 0, since: null })).toBe(false)
})

test('− and + move both times by 5 minutes within 5 and 120, never below 0 left', async () => {
  expect(stepTimer(freshTimer(), 0, 1)).toEqual(freshTimer(30 * MINUTE))
  expect(stepTimer(freshTimer(5 * MINUTE), 0, -1)).toEqual(freshTimer(5 * MINUTE))
  expect(stepTimer(freshTimer(120 * MINUTE), 0, 1)).toEqual(freshTimer(120 * MINUTE))
  const running = startTimer(freshTimer(), 0)
  expect(stepTimer(running, 22 * MINUTE, -1)).toEqual({ totalMs: 20 * MINUTE, leftMs: 0, since: 22 * MINUTE })
  expect(stepTimer(running, 10 * MINUTE, 1)).toEqual({ totalMs: 30 * MINUTE, leftMs: 20 * MINUTE, since: 10 * MINUTE })
  const paused = pauseTimer(running, 22 * MINUTE)
  expect(stepTimer(paused, 30 * MINUTE, -1)).toEqual(freshTimer(20 * MINUTE))
})
