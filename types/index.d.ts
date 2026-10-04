export type CacheReading = { at: number; hit: number }

declare module 'claude-code' {
  interface PluginState {
    'dashband': { last: CacheReading | null; now: number }
  }
}
