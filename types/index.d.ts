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
      settingsOpen: boolean
      size: 'S' | 'M' | 'L'
      expectedBy: 'now' | 'midnight'
      // Keystroke counting, off unless the person turns it on in the settings.
      keystrokesOn: boolean
      // Keystrokes in this chat, and today across all chats as last read from the store.
      keysChat: number
      keysToday: number
      // Water: the daily target (0 is off) and the units drunk today across all chats.
      waterTarget: number
      waterToday: number
      // Pomodoro: blocks in a series (0 is off) and the series across all chats.
      // The thousands separator picked in the settings.
      separator: ',' | '.'
      // Gongs for the pomodoro, on unless turned off.
      soundsOn: boolean
      pomodoroTarget: number
      pomodoroState: { started: number; since: number | null }
      // Timer, shown instead of the pomodoros: on or off, and its state across all chats.
      timerOn: boolean
      timerState: { totalMs: number; leftMs: number; since: number | null }
    }
  }
}
