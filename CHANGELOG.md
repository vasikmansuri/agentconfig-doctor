# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/). Rule IDs are part of the public interface and are never reused.

## [Unreleased]

## [0.1.1] - 2026-10-23

### Changed

- Published as `@vasikmansuri/agentconfig-doctor`; the command is still `agentconfig-doctor`.
- README screenshots are no longer included in the package.

## [0.1.0] - 2026-10-23

First public version.

### Added

- ACD002 expands variable references in MCP command lines statically and checks the result, so commands that only become dangerous after expansion are reported. Findings carry a redacted `resolvedCommand` that the HTML, terminal and JSON reports show next to the source location.
- `scan` command for Claude Code (`.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`, `CLAUDE.md`), Cursor (`.cursor/mcp.json`, `.cursor/rules/**/*.mdc`, `.cursorrules`), VS Code (`.vscode/mcp.json`) and `AGENTS.md`.
- Rules ACD001–ACD011: exposed credentials, risky commands, broad filesystem access, hard-coded environment secrets, invalid MCP configuration, suspicious server definitions, duplicate server names, invalid settings, permission changes since a baseline, risky setting combinations, and hidden Unicode.
- Terminal, JSON (schema version 1) and self-contained HTML reports, with secrets redacted in every format.
- `check-mcp`, `rules`, `version`, `baseline create` and `baseline update` commands.
- Baselines with stable fingerprints and permission snapshots.
- Explicit `--config` file support for disabled rules, ignores, allowed paths and allowed hosts.
- Documented exit codes 0–4, plus `--fail-on`, `--fail-if-empty`, `--include`, `--exclude` and `--max-file-size`.
- Safe file handling: symlink boundary checks, size limits, binary detection, and terminal and HTML escaping.

[Unreleased]: https://github.com/vasikmansuri/agentconfig-doctor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vasikmansuri/agentconfig-doctor/releases/tag/v0.1.0
