# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The band above the prompt is compact: short labels and a tooltip on each row with the details.
  The Desktop app draws it as a small SVG, the terminal as narrower text.
- Plan limits show used and expected usage with a percent sign, as `23/53%`.

### Added

- The first eight characters of the session id in the band and in the prompt cache notice
- Desktop app: a Settings button beside the band opens a framed settings area; the size of the
  band (S, M, L) applies to every chat
- Setting "Limits expected by": now, or the coming midnight, for the expected usage of the plan
  limits in the band and the footer

### Fixed

- An exhausted plan limit draws red, even when the expected usage is close to 100%

## [0.1.1] - 2026-10-11

### Added

- Installation steps for the Claude Desktop app in the README

### Fixed

- README: only a new chat in the Desktop app waits for the first message; a chat with an
  existing conversation shows dashband shortly after it is opened

## [0.1.0] - 2026-10-09

### Added

- Footer item in every chat with the prompt cache countdown, the cache hit ratio, context usage
  and the five-hour and weekly plan limits
- Band above the prompt with a bar for each item and a marker where limit usage would be by now
- Plan limits colored by pace: used against the share of the window that has passed
- Cache lifetime, five minutes or one hour, read from the session transcript
- A notice two minutes before the prompt cache expires
- Optional trace for troubleshooting

[Unreleased]: https://github.com/EgonLeitner/dashband/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/EgonLeitner/dashband/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/EgonLeitner/dashband/releases/tag/v0.1.0
