# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Footer item in every chat with the prompt cache countdown, the cache hit ratio, context usage
  and the five-hour and weekly plan limits
- Band above the prompt with a bar for each item and a marker where limit usage would be by now
- Plan limits colored by pace: used against the share of the window that has passed
- Cache lifetime, five minutes or one hour, read from the session transcript
- Notices five minutes and one minute before the prompt cache expires
- Optional trace for troubleshooting
