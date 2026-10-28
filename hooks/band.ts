import type { CacheReading, LimitReading } from '../types'
import type { ExpectedBy } from './model'
import {
  HOUR,
  LIMIT_NAME,
  MINUTE,
  PACE_COLOR,
  WINDOW_MS,
  bar,
  cacheColor,
  cacheLeftMs,
  contextColor,
  currentLimit,
  duration,
  expectedAt,
  groupDigits,
  expectedPercent,
  pace,
} from './model'

export const BAR_CELLS = 16

// Short labels for the band; the tooltip spells them out.
const ROW_LABEL: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'week',
}

// One line of the band: a label, a value, a bar and a short detail, with a tooltip that says it in
// full. `fill` and `marker` are percentages; `color` names a pace or cache color.
export type BandRow = {
  label: string
  value: string
  color: string
  fill: number
  marker?: number
  detail: string
  // The session id, drawn right-aligned in its own color.
  id?: string
  // Keystrokes in this chat and today, on the row with the id, where the terminal shows them.
  keys?: string
  tip: string
}

export type BandInput = {
  now: number
  cache: CacheReading | null
  working: boolean
  contextPercent: number | null
  contextTokens: number | null
  limits: LimitReading[]
  sessionId: string
  expectedBy: ExpectedBy
  // Keystrokes in this chat and today; null while counting is off.
  keystrokes?: Keystrokes | null
}

export type Keystrokes = { chat: number; today: number }

const kTokens = (tokens: number) => `${Math.round(tokens / 1000)}k`

export const bandRows = (input: BandInput): BandRow[] => {
  const { now: t, cache: reading, working: isWorking } = input
  const rows: BandRow[] = []
  const keys = input.keystrokes ? `${groupDigits(input.keystrokes.chat)}/${groupDigits(input.keystrokes.today)}` : undefined

  if (reading === null) {
    rows.push({
      label: '● cache',
      value: '…',
      color: 'gray',
      fill: 0,
      detail: '',
      id: input.sessionId,
      keys,
      tip: `Prompt cache: waiting for the next response · session ${input.sessionId}`,
    })
  } else {
    const left = isWorking ? reading.ttlMs : cacheLeftMs(reading, t)
    const color = isWorking ? 'green' : cacheColor(left)
    const hit = `${Math.round(reading.hit * 100)}%`
    const ttl = reading.ttlMs >= HOUR ? '1h' : '5m'
    rows.push({
      label: '● cache',
      value: isWorking ? 'hot' : left > 0 ? `${Math.ceil(left / MINUTE)}m` : 'cold',
      color,
      fill: (left / reading.ttlMs) * 100,
      detail: `${hit} · ${ttl}`,
      id: input.sessionId,
      keys,
      tip: `Prompt cache: ${hit} of the last input read from the cache, ${ttl} lifetime · session ${input.sessionId}`,
    })
  }

  if (input.contextPercent !== null) {
    const tokens = input.contextTokens ? kTokens(input.contextTokens) : ''
    rows.push({
      label: 'ctx',
      value: `${input.contextPercent}%`,
      color: contextColor(input.contextPercent),
      fill: input.contextPercent,
      detail: tokens,
      tip: `Context window: ${input.contextPercent}% used${tokens ? `, ${tokens} tokens` : ''}`,
    })
  }

  for (const limit of input.limits.map(l => currentLimit(l, t))) {
    const label = ROW_LABEL[limit.kind]
    const name = LIMIT_NAME[limit.kind]
    const windowMs = WINDOW_MS[limit.kind]
    if (!label || !name || !windowMs) continue
    const used = Math.round(limit.used)
    if (limit.resetsAt === null) {
      rows.push({
        label,
        value: `${used}%`,
        color: 'gray',
        fill: limit.used,
        detail: '',
        tip: `${name}: ${used}% used; the window starts with the next request`,
      })
      continue
    }
    const expected = expectedPercent(windowMs, limit.resetsAt, expectedAt(input.expectedBy, limit.resetsAt, t))
    const resets = duration(limit.resetsAt - t)
    rows.push({
      label,
      value: `${used}/${Math.round(expected)}%`,
      color: PACE_COLOR[pace(limit.used, expected)],
      fill: limit.used,
      marker: expected,
      detail: `↻ ${resets}`,
      tip: `${name}: ${used}% used, ${Math.round(expected)}% expected by ${input.expectedBy}; resets in ${resets}`,
    })
  }
  return rows
}

// Colors in the SVG, which draws as an image and knows no theme keys. Each reads on light and dark.
const HEX: Record<string, string> = {
  green: '#4f9d55',
  yellow: '#d4a72c',
  red: '#d9534f',
  gray: '#8a8a8a',
}
// The session id: a mid blue, readable on light and dark.
export const ID_COLOR = '#2F8DBF'
const hex = (color: string) => HEX[color] ?? color
// A bar on pace draws green; its value stays gray.
export const barColor = (color: string) => (color === 'gray' ? 'green' : color)

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Pixel layout of the SVG band.
const FONT_PX = 11
const ROW_PX = 15
// The SVG has room for a finer bar than the terminal.
const SVG_BAR_CELLS = 28
const CELL_PX = 6
const CELL_HEIGHT_PX = 7
const CELL_GAP_PX = 1
const LABEL_X = 0
const VALUE_X = 50
const BAR_X = 106
const DETAIL_X = BAR_X + SVG_BAR_CELLS * (CELL_PX + CELL_GAP_PX) + 6
const LAYOUT_WIDTH = DETAIL_X + 100
// Sizes to pick in the settings: how many times larger the layout above is drawn, in CSS pixels.
export const SIZES = { S: 1, M: 1.2, L: 1.5 } as const
export type Size = keyof typeof SIZES
export const DEFAULT_SIZE: Size = 'M'
export const isSize = (value: unknown): value is Size => typeof value === 'string' && value in SIZES

const layoutHeight = (rows: number) => rows * ROW_PX + 2
export const svgWidth = (size: Size) => Math.round(LAYOUT_WIDTH * SIZES[size])
export const svgHeight = (rows: number, size: Size) => Math.round(layoutHeight(rows) * SIZES[size])

export const bandSvg = (rows: BandRow[], size: Size = DEFAULT_SIZE): string => {
  const lines = rows.map((row, i) => {
    const y = i * ROW_PX + 1
    const baseline = y + FONT_PX
    const { filled, marker } = bar(SVG_BAR_CELLS, row.fill, row.marker)
    const fill = hex(barColor(row.color))
    const cells = Array.from({ length: SVG_BAR_CELLS }, (_, c) => {
      const x = BAR_X + c * (CELL_PX + CELL_GAP_PX)
      if (c === marker) return `<rect x="${x + CELL_PX / 2}" y="${y + 1}" width="1" height="${FONT_PX}" fill="${hex('gray')}"/>`
      const on = c < filled
      return `<rect x="${x}" y="${y + 3}" width="${CELL_PX}" height="${CELL_HEIGHT_PX}" rx="1" fill="${on ? fill : hex('gray')}"${on ? '' : ' fill-opacity="0.35"'}/>`
    })
    const label = row.label.startsWith('●') ? hex(row.color) : hex('gray')
    return [
      `<g><title>${escape(row.tip)}</title>`,
      `<rect x="0" y="${y}" width="${LAYOUT_WIDTH}" height="${ROW_PX}" fill="transparent"/>`,
      `<text x="${LABEL_X}" y="${baseline}" fill="${label}">${escape(row.label)}</text>`,
      `<text x="${VALUE_X}" y="${baseline}" fill="${hex(row.color)}">${escape(row.value)}</text>`,
      ...cells,
      `<text x="${DETAIL_X}" y="${baseline}" fill="${hex('gray')}">${escape(row.detail)}</text>`,
      row.id
        ? `<text x="${LAYOUT_WIDTH}" y="${baseline}" text-anchor="end" fill="${hex('gray')}">ID: <tspan fill="${ID_COLOR}">${escape(row.id)}</tspan></text>`
        : '',
      '</g>',
    ].join('')
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth(size)}" height="${svgHeight(rows.length, size)}"`,
    ` viewBox="0 0 ${LAYOUT_WIDTH} ${layoutHeight(rows.length)}"`,
    ` font-family="-apple-system, system-ui, sans-serif" font-size="${FONT_PX}">`,
    ...lines,
    '</svg>',
  ].join('')
}

// What the band says, for a surface that cannot draw the SVG.
export const bandAlt = (rows: BandRow[]) =>
  rows.map(r => `${r.label} ${r.value} ${r.detail}${r.id ? ` · ID: ${r.id}` : ''}${r.keys ? ` · Keys: ${r.keys}` : ''}`.trim()).join(' · ')

// The session id on its own, drawn in the band's font and size so it can sit apart from the band.
const ID_LAYOUT_WIDTH = 80
export const idSvgWidth = (size: Size) => Math.round(ID_LAYOUT_WIDTH * SIZES[size])
export const idSvgHeight = (size: Size) => Math.round(ROW_PX * SIZES[size])

export const idSvg = (id: string, size: Size = DEFAULT_SIZE): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${idSvgWidth(size)}" height="${idSvgHeight(size)}"`,
    ` viewBox="0 0 ${ID_LAYOUT_WIDTH} ${ROW_PX}"`,
    ` font-family="-apple-system, system-ui, sans-serif" font-size="${FONT_PX}">`,
    `<text x="${ID_LAYOUT_WIDTH}" y="${FONT_PX}" text-anchor="end" fill="${hex('gray')}">`,
    `ID: <tspan fill="${ID_COLOR}">${escape(id)}</tspan></text>`,
    '</svg>',
  ].join('')

// Keystrokes on their own, under the session id in the desktop app: this chat and today, the full
// numbers and what is counted in the tooltip.
export const keysTip = (k: Keystrokes) =>
  `Keystrokes: ${groupDigits(k.chat)} in this chat, ${groupDigits(k.today)} today across all chats. ` +
  'Counts typed characters and deletions, not pasted text and not the first message of a new chat. No text is stored.'

const keysText = (k: Keystrokes) => `Keys: ${groupDigits(k.chat)} · ${groupDigits(k.today)}`
// Wide enough for the text at about 6.5 pixels a character, never narrower than the id.
const keysLayoutWidth = (k: Keystrokes) => Math.max(ID_LAYOUT_WIDTH, Math.ceil(keysText(k).length * 6.5))
export const keysSvgWidth = (k: Keystrokes, size: Size) => Math.round(keysLayoutWidth(k) * SIZES[size])
export const keysSvgHeight = idSvgHeight

export const keysSvg = (k: Keystrokes, size: Size = DEFAULT_SIZE): string => {
  const width = keysLayoutWidth(k)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${keysSvgWidth(k, size)}" height="${keysSvgHeight(size)}"`,
    ` viewBox="0 0 ${width} ${ROW_PX}"`,
    ` font-family="-apple-system, system-ui, sans-serif" font-size="${FONT_PX}">`,
    `<g><title>${escape(keysTip(k))}</title>`,
    `<rect x="0" y="0" width="${width}" height="${ROW_PX}" fill="transparent"/>`,
    `<text x="${width}" y="${FONT_PX}" text-anchor="end" fill="${hex('gray')}">${escape(keysText(k))}</text>`,
    '</g></svg>',
  ].join('')
}
