import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CacheReading } from '../types'

// Prompt cache TTL assumed by the band (the API does not expose it to plugins).
const TTL_MS = 60 * 60 * 1000
const SEGMENTS = 30

const last = atom({ plugin: 'dashband', key: 'last' } as const, null)
const now = atom({ plugin: 'dashband', key: 'now' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, now, async () => await $.clock.now())
    $.clock.every(15_000, async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    })

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (!e.agentId && u) {
      const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const t = await $.clock.now()
      const reading: CacheReading = { at: t, hit: total ? u.cache_read_input_tokens / total : 0 }
      await update($, last, () => reading)
      await update($, now, () => t)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const reading = await read($, last)
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    if (reading === null) {
      return (
        <Box>
          <Text dimColor>● cache: waiting for the next response</Text>
        </Box>
      )
    }

    const left = Math.max(0, TTL_MS - ((await read($, now)) - reading.at))
    const minutes = Math.ceil(left / 60_000)
    const filled = Math.round((left / TTL_MS) * SEGMENTS)
    const isWarm = left > 0
    const color = !isWarm ? 'gray' : minutes <= 5 ? 'yellow' : 'green'

    return (
      <Box>
        <Text color={color}>● </Text>
        <Text dimColor>cache </Text>
        <Text color={color}>{isWarm ? `${minutes}m ` : 'cold '}</Text>
        <Text color={color}>{'■'.repeat(filled)}</Text>
        <Text dimColor>{'■'.repeat(SEGMENTS - filled)} </Text>
        <Text dimColor>{Math.round(reading.hit * 100)}% hit </Text>
        <Button key="compact" label="Compact" onPress={() => $.session.compact()} />
      </Box>
    )
  })
}
