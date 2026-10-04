export type CacheReading = {
  // When the last main-thread response arrived, in milliseconds since the epoch.
  at: number
  // Share of that response's input tokens read from the prompt cache, 0 to 1.
  hit: number
  // Lifetime of the prompt cache the session writes: five minutes or one hour.
  ttlMs: number
}

export type LimitReading = {
  // `five_hour`, `seven_day` or a gateway's `spend_limit`.
  kind: string
  // Percent of the window used, 0 to 100.
  used: number
  // When the window resets, in milliseconds since the epoch.
  resetsAt: number | null
}

export type UsageReading = {
  contextPercent: number | null
  contextTokens: number | null
  limits: LimitReading[]
}

declare module 'claude-code' {
  interface PluginState {
    dashband: {
      cache: CacheReading | null
      usage: UsageReading | null
      working: boolean
      now: number
    }
  }
}
