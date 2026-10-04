# dashband

A [Claude Code](https://code.claude.com) mod that shows, right above the prompt, how long the
prompt cache stays warm and how much of the last request it served.

```
● cache 42m ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■ 97% hit [ Compact ]
```

## Why

Claude Code caches the beginning of each request. Reading from the cache is much cheaper than
processing the context again. Once the cache expires, the next request has to write the whole
context to the cache again, which is most expensive in long sessions. The band tells you how much
time is left before that happens.

## What it shows

| Part | Meaning |
|---|---|
| `●` and minutes | Time left until the cache expires: green while more than 5 minutes are left, yellow in the last 5 minutes, gray `cold` once expired |
| Bar | Remaining time in 30 segments |
| `hit` | Share of the last main-thread response's input tokens read from the cache: `cache_read / (input + cache_read + cache_creation)` |
| `Compact` | Compacts the session |

The countdown starts at the last response of the main conversation and refreshes every
15 seconds. Subagent responses are ignored. Before the first response the band reads
`cache: waiting for the next response`.

## Requirements

- Claude Code with mod support (2.1.287 or later)
- The terminal (CLI) or the Code tab of the Claude Desktop app. Mods do not draw in the
  VS Code extension, on mobile, or in `claude -p`.

## Installation

dashband is listed in the `egonleitner` marketplace:

<!-- Replace OWNER with the GitHub account on first publication. -->
```bash
claude plugin marketplace add OWNER/claude-code-mods
claude plugin install dashband@egonleitner
```

Run `/reload-plugins` in an open session, or start a new one.

### Without a marketplace

Load the folder directly for one session:

```bash
claude --plugin-dir /path/to/dashband
```

To load it in every session, including the Desktop app, add the folder to `env` in
`~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/dashband"
  }
}
```

## Limitations

- **The cache lifetime is assumed to be one hour**, the default for the main conversation on a
  Claude subscription. Where five minutes apply (API key, `FORCE_PROMPT_CACHING_5M=1`, usage
  beyond the plan limits), the band shows the cache as warm for too long.
- The band estimates expiry from the time of the last response. It cannot see the cache on the
  server.
- **Desktop app: the band shows in one chat at a time.** With several chats open, the app asks
  only the active one for the band, and chats that were open when the app started may never
  show it. This is a known issue of the app
  ([anthropics/claude-code#99265](https://github.com/anthropics/claude-code/issues/99265));
  the terminal is not affected.

## Development

```bash
claude plugin validate .
```

`tsconfig.json` extends the type declarations Claude Code writes to `.claude-plugin/types/` when
it loads the mod. That folder is not part of the repository; load the mod once to create it.

Built with the help of Claude Code.

## License

[MIT](LICENSE)
