import { expect, test } from 'claude-code/testing'

import { PILL_TINT, bandAlt, pomodoroText, pomodoroTip, bandRows, bandSvg, iconSvg, isSize, keysSvg, keysTip, svgWidth, waterSvg, waterTip } from '../hooks/band'
import { HOUR, MINUTE, groupDigits } from '../hooks/model'

const now = Date.parse('2026-10-28T06:00:00.000Z')
const input = {
  now,
  cache: { at: now - 10 * MINUTE, hit: 0.99, ttlMs: HOUR },
  working: false,
  contextPercent: 43,
  contextTokens: 434_000,
  limits: [{ kind: 'five_hour', used: 100, resetsAt: now + 6 * MINUTE }],
  sessionId: 'a1b2c3d4',
  expectedBy: 'now' as const,
}

test('the band has a row for cache, context and each limit', async () => {
  const rows = bandRows(input)
  expect(rows.map(r => r.label)).toEqual(['● cache', 'ctx', '5h'])
  expect(rows[0]?.value).toBe('50m')
  expect(rows[0]?.detail).toBe('99% · 1h')
  expect(rows[0]?.id).toBe('a1b2c3d4')
  expect(rows[1]?.detail).toBe('434k')
  expect(rows[2]?.value).toBe('100/98%')
  expect(rows[2]?.detail).toBe('↻ 6m')
})

test('an exhausted limit draws red even close to its expected usage', async () => {
  expect(bandRows(input)[2]?.color).toBe('red')
})

test('the SVG carries each row with its tooltip and escapes text', async () => {
  const svg = bandSvg([{ label: 'a<b', value: '1', color: 'gray', fill: 0, detail: '', tip: 'x & y' }])
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.includes('<title>x &amp; y</title>')).toBe(true)
  expect(svg.includes('a&lt;b')).toBe(true)
  expect(bandAlt(bandRows(input)).startsWith('● cache 50m')).toBe(true)
})

test('the size setting scales the SVG and accepts only known sizes', async () => {
  expect(svgWidth('L')).toBeGreaterThan(svgWidth('M'))
  expect(bandSvg([], 'S').includes(`width="${svgWidth('S')}"`)).toBe(true)
  expect(isSize('M')).toBe(true)
  expect(isSize('XL')).toBe(false)
})

test('keystrokes stay out of the band while counting is off', async () => {
  expect(bandRows(input)[0]?.keys).toBeUndefined()
  expect(bandAlt(bandRows(input))).not.toContain('⌨')
})

test('keystrokes sit with the session id: this chat and today', async () => {
  const rows = bandRows({ ...input, keystrokes: { chat: 1234, today: 8412 } })
  const [chat, today] = [groupDigits(1234), groupDigits(8412)]
  expect(rows[0]?.keys).toBe(`${chat}/${today}`)
  expect(bandAlt(rows)).toContain(`ID: a1b2c3d4 · Keys: ${chat}/${today}`)
  const svg = keysSvg({ chat: 1234, today: 8412 })
  expect(svg).toContain(`>${chat} · ${today}</text>`)
  expect(keysTip({ chat: 1234, today: 8412 })).toContain('No text is stored')
})


test('water shows its count in its color and says in the tooltip what is due', async () => {
  const tip = waterTip({ drunk: 3, target: 8, due: 4.6, color: 'orange' })
  expect(tip).toContain('3 of 8 units today, 4 due by now')
  expect(tip).toContain('07:00–21:00')
  const svg = waterSvg('3', 'orange', tip)
  expect(svg).toContain('fill="#e8833a">3</text>')
  expect(svg).toContain('<title>Water: 3 of 8')
})

test('the pills draw an icon in their own color, a little larger than the text', () => {
  expect(iconSvg('water', 'S')).toContain('width="13" height="13" viewBox="0 0 24 24"')
  expect(iconSvg('water')).toContain('stroke="#2F8DBF"')
  expect(iconSvg('keys')).toContain('<rect')
  expect(Object.keys(PILL_TINT)).toEqual(['water', 'keys', 'pomodoro', 'pomodoroBreak'])
})

test('the pomodoro pill shows the time left and which block of how many', () => {
  expect(pomodoroText({ phase: 'focus', started: 2, target: 4, leftMs: 11.2 * 60_000 })).toBe('-12m 2/4')
  expect(pomodoroText({ phase: 'idle', started: 0, target: 4, leftMs: 0 })).toBe('0/4')
  expect(pomodoroTip({ phase: 'break', started: 2, target: 4, leftMs: 4 * 60_000 })).toContain('break, 4 min left')
})
