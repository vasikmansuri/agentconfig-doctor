# Launch kit

Drafts for announcing AgentConfig Doctor. Every claim here matches what v0.1.0 actually does; keep it that way. Do not post anywhere that forbids self-promotion, and never ask for stars.

## 1. GitHub repository description (350 characters or fewer)

> Local-first CLI that finds leaked keys, risky commands, broad permissions and invalid MCP servers in Claude Code, Cursor and VS Code agent configs. Explainable findings, secret redaction, baselines for CI. No AI API, no telemetry.

Suggested topics: `security`, `mcp`, `model-context-protocol`, `ai-agents`, `claude-code`, `cursor`, `vscode`, `developer-tools`, `cli`, `typescript`, `secret-scanning`, `devsecops`, `static-analysis`, `linter`.

## 2. LinkedIn post

> AI coding agents are now configured through files that live in our repositories: `.mcp.json`, `.cursor/mcp.json`, `.claude/settings.json`, `.vscode/mcp.json`, plus rule and instruction files.
>
> Those files can hold API keys, start local programs automatically and give an agent access to your whole home directory, and they change in ordinary pull requests.
>
> I built AgentConfig Doctor, an open-source CLI that checks them before you commit or share them:
>
> - leaked credentials, redacted in every output
> - `curl | sh`, reverse shells and destructive commands in MCP servers and hooks
> - over-broad filesystem access and unrestricted shell approval
> - invalid or conflicting MCP server definitions
> - permission changes since a saved baseline, for CI
>
> It runs locally, needs no AI API and no account, never executes what it scans, and explains every finding with a fix. It is heuristic, so a clean result is not a guarantee. False-positive reports are very welcome.
>
> MIT licensed: https://github.com/vasikmansuri/agentconfig-doctor

## 3. X post

> Your AI agent's config is code that runs on your machine. AgentConfig Doctor scans .mcp.json, Claude Code settings and Cursor/VS Code MCP files for leaked keys, `curl | sh`, whole-disk access and permission creep. Local, no telemetry, MIT.
> https://github.com/vasikmansuri/agentconfig-doctor

## 4. Technical article outline

**Title:** "Your coding agent's config is an attack surface: checking MCP and permission files"

1. Why agent configuration matters: files that start processes, hold credentials and set permissions, versioned next to code.
2. A tour of the formats: Claude Code `.mcp.json` and settings, Cursor `mcp.json` and rules, VS Code `mcp.json` (`servers` vs `mcpServers`), `AGENTS.md`.
3. Six concrete risks, each with a minimal example and a fix: literal tokens, unpinned `npx -y` packages, `curl | sh` hooks, `enableAllProjectMcpServers`, a `Bash` allow rule with no sandbox, hidden Unicode in rule files.
4. Designing a scanner that is safe on untrusted repositories: no execution, no network, symlink boundaries, redaction everywhere, escaped output.
5. Making findings actionable: stable rule IDs, fingerprints, baselines and permission-change findings in pull requests.
6. Limits: heuristics, false positives, and what static analysis cannot see.
7. How to try it and contribute.

## 5. 60-second demo script

| Time    | Screen                                                                          | Voice-over                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–8 s   | `cat examples/risky-project/.mcp.json`                                          | "This is a typical MCP config. Can you spot the problems?"                                                                                                                                  |
| 8–25 s  | `npx @vasikmansuri/agentconfig-doctor scan examples/risky-project`              | "AgentConfig Doctor finds a password in a database URL, a hook that pipes a download into bash, a filesystem server pointed at the root of the disk, and every local server auto-approved." |
| 25–35 s | Scroll to one finding                                                           | "Each finding has a location, the evidence with secrets redacted, why it matters, and how to fix it."                                                                                       |
| 35–45 s | `npx @vasikmansuri/agentconfig-doctor scan examples/safe-project`               | "The fixed version passes, and the tool says plainly that a pass is not a guarantee."                                                                                                       |
| 45–55 s | `baseline create`, add `Bash(rm *)` to the settings, then `scan --baseline ...` | "In CI, a baseline catches permission creep in pull requests."                                                                                                                              |
| 55–60 s | README                                                                          | "Local, no telemetry, MIT. Link below."                                                                                                                                                     |

Record real output only (for example with `asciinema rec`), and do not speed up or edit the results.

## 6. Where sharing may be appropriate

Check each community's current rules before posting; many limit self-promotion to specific threads or days.

- Hacker News, as a "Show HN" (follow the Show HN guidelines)
- Reddit: r/ClaudeAI, r/cursor, r/mcp, r/netsec (only with a technical write-up), r/javascript (Showoff Saturday)
- Model Context Protocol GitHub Discussions, in a show-and-tell category if one exists
- Claude Code and Cursor community forums, in their showcase or projects sections
- dev.to or Hashnode, for the technical article
- OWASP and DevSecOps community Slack workspaces that have a tools or showcase channel
- Your own newsletter, blog or LinkedIn

Aim for feedback and real installs: ask for false positives and missing formats, and answer every issue.
