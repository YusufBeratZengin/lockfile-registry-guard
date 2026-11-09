# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-07

### Added

- Zero-dependency lockfile scanner for npm, Yarn Classic/Berry and pnpm
  lockfiles, with human, JSON and SARIF 2.1.0 output.
- Registry allowlists, per-scope registry rules, HTTPS enforcement, optional
  full commit SHA pinning for git dependencies, file reference control and
  warning-aware exit codes.
- Configuration through `.lockfileguardrc`, `.lockfileguardrc.json`,
  `lockfileguard.config.json`, `LOCKFILE_GUARD_CONFIG`,
  `LOCKFILE_GUARD_ALLOWED_HOSTS` and CLI flags.
- Test harness with suites covering the npm v1/v2/v3, Yarn Classic/Berry and
  pnpm v5/v6/v9 formats, the validator, the CLI and the test entrypoint.
- `lint`, `typecheck`, `check` and `coverage` scripts that run without
  installing dependencies.

### Fixed

- pnpm git dependencies with a commit-only `resolution` (no `type` or `repo`)
  are now inspected instead of being treated as registry packages. The remote
  is recovered from the package key or the importer spec, and a commit without
  any remote is reported as `INVALID_URL` rather than passing silently.
- pnpm importer fallbacks now understand name-prefixed specs such as
  `evildep@github:owner/repo#sha`, and scoped git package keys no longer split
  at the `@` inside the remote.
- `CREDENTIALS_IN_URL` now applies to git URLs. The standard `git@host` SSH
  login is exempt, while passwords and tokens used as usernames are reported.
- CLI list options consume exactly one value, so `--allowed-hosts X <target>`
  scans the target instead of treating it as a host. Repeated `--add-host`,
  `--allowed-hosts` and `--allow-git-hosts` values accumulate.
- A comments-only (or metadata-only) lockfile is accepted as a project with no
  dependencies instead of raising `PARSE_ERROR`.
- `npm test` works again: `test/index.js` loads every suite in `test/suites/`.
  `npm run lint`, `npm run typecheck`, `npm run check` and `npm run coverage`
  have working implementations.
- Added the promised `README.md`, `README.tr.md` and `CHANGELOG.md` files.

[Unreleased]: https://github.com/YusufBeratZengin/lockfile-registry-guard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YusufBeratZengin/lockfile-registry-guard/releases/tag/v0.1.0
