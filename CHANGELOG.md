# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/). Rule IDs are part of the public interface and are never reused.

## [Unreleased]

### Added

- `--format sarif` for `scan` and `check-mcp`: a SARIF 2.1.0 log for GitHub code scanning, with GitHub `security-severity` scores, line-independent fingerprints and baseline state. Paths are relative to the working directory, so scans of a sub-directory map to the right files. See `docs/sarif.md`.
- `check-mcp --output <file>`.
- Claude Code skills (`.claude/skills/<name>/SKILL.md`), custom commands (`.claude/commands/**/*.md`) and subagents (`.claude/agents/**/*.md`) are scanned. ACD001 and ACD011 apply as for other text files.
- ACD002 checks the commands Claude Code runs from these files at full severity: dynamic context commands (`` !`cmd` `` and ` ```! ` blocks), `command:` lines in `hooks` and `mcpServers` frontmatter, and `Bash(...)` entries in `allowed-tools`.
- ACD012 (new): `allowed-tools` that pre-approves every shell command in a skill or command, and subagents with `permissionMode: bypassPermissions`.
- New configuration kinds in reports: `claude-skill`, `claude-command`, `claude-agent`.
- Each rule in `docs/rules.md` has a stable anchor (`#acd001` and so on).

### Fixed

- The README and GitHub Actions guide ran `npx --yes agentconfig-doctor@0.1.0`. The package is published as `@vasikmansuri/agentconfig-doctor`, and the unscoped name belongs to nobody, so whoever registered it could have run code in workflows copied from the docs. The examples now use `@vasikmansuri/agentconfig-doctor@0.1.2`, and a test keeps registry `npx` calls in the docs scoped.
- The "Running from source" workflow example checked out a tag that does not exist.

## [0.1.2] - 2026-10-24

### Changed

- The package metadata includes a funding link.

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

[Unreleased]: https://github.com/vasikmansuri/agentconfig-doctor/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/vasikmansuri/agentconfig-doctor/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/vasikmansuri/agentconfig-doctor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/vasikmansuri/agentconfig-doctor/releases/tag/v0.1.0
