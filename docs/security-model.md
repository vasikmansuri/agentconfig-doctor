# Security model

AgentConfig Doctor reads configuration from repositories you may not trust. This page describes what it protects against, what it does not, and how it behaves.

## What the tool does

1. Walks the given directory (or reads the given file) and selects files by path only.
2. Reads each selected file as UTF-8 text, within size limits.
3. Parses JSON/JSONC and Cursor frontmatter into an in-memory model.
4. Runs deterministic, pattern-based rules over that model.
5. Prints a report.

## Guarantees

| Guarantee                                         | How it is enforced                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commands in scanned files are never executed      | No code path spawns processes; commands are only matched with regular expressions. Variable references are expanded as text only, never from the real environment. Tests assert that a `touch` command in a scanned config does not create its file. |
| MCP servers are never contacted                   | No networking modules are used; URLs are only parsed with `new URL()`.                                                                                                                                                                               |
| No network access, telemetry or uploads           | The runtime has three dependencies (Commander, Zod, jsonc-parser), none of which make network calls.                                                                                                                                                 |
| Secrets are redacted in all output                | Rules emit redacted evidence, and every reporter and the baseline writer pass all text through a second scrub for all known credential patterns.                                                                                                     |
| The scan boundary is respected                    | Symlinks that resolve outside the scan root are skipped and reported. Symlinked directories are never descended into (no cycles). The boundary is re-checked when each file is read.                                                                 |
| Hostile input cannot crash or flood the tool      | Oversized, binary and unreadable files, malformed JSON, and very deep or very large trees are handled and reported as skipped files or as findings.                                                                                                  |
| Output cannot be hijacked                         | Terminal output escapes control characters (ANSI escapes, newlines) and bidi/invisible characters from scanned content. HTML output escapes everything, contains no scripts, and sets `Content-Security-Policy: default-src 'none'`.                 |
| Scanned repositories cannot change tool behaviour | Configuration is read only from `--config <file>`, never from the scanned directory.                                                                                                                                                                 |

## Redaction details

- Vendor tokens keep only their public type prefix, for example `ghp_****` or `sk-ant-****`. Never more than half of a value is shown.
- Literal values under sensitive names are shown as `**** (N chars)`.
- Private keys keep only the `-----BEGIN ... PRIVATE KEY-----` header.
- Fingerprints include a SHA-256 hash of the matched value, mixed with the rule ID and path and truncated to 64 bits. This keeps fingerprints stable, but someone holding a baseline could confirm a guessed secret, so treat baselines as internal files.
- Baselines store permission rules after redaction and store MCP server definitions and hook commands only as hashes. Environment and header values are never stored.

## Threats in scope

- Leaked credentials in agent configuration.
- Configuration that runs attacker-controlled code automatically (hooks, MCP servers, helpers, auto-approved servers).
- Configuration that exposes the filesystem or network more broadly than needed.
- Silent permission expansion in pull requests (with a baseline).
- Hidden text in rule and instruction files.
- A malicious repository attacking the scanner itself (path traversal, symlinks, huge files, terminal or HTML injection).

## Out of scope

- Proving that a configuration is safe. Findings are heuristic signals.
- Verifying whether credentials are live, which would require network access.
- Analysing the code of MCP servers, npm or PyPI packages, container images, or scripts referenced by path.
- Detecting arbitrary obfuscation, or prompt injection written in natural language.
- Protecting a machine on which an agent has already run a malicious configuration.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
