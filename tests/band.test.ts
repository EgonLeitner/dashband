import { expect, test } from 'claude-code/testing'

import { bandAlt, bandRows, bandSvg, isSize, svgWidth } from '../hooks/band'
import { HOUR, MINUTE } from '../hooks/model'

const now = Date.parse('2026-10-28T06:00:00.000Z')
const input = {
  now,
  cache: { at: now - 10 * MINUTE, hit: 0.99, ttlMs: HOUR },
  working: false,
  contextPercent: 43,
  contextTokens: 434_000,
  limits: [{ kind: 'five_hour', used: 100, resetsAt: now + 6 * MINUTE }],
  sessionId: 'a1b2c3d4',
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
