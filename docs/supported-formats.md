# Supported configuration formats

This page lists every file AgentConfig Doctor reads, how it is parsed, and which fields the rules rely on. Formats were checked against the official documentation linked in each section in **October 2026**. If a client changes its format, please [open an issue](https://github.com/vasikmansuri/agentconfig-doctor/issues/new/choose).

Discovery is purely path-based: a file is analysed only if its path matches one of the patterns below. Other JSON or Markdown files are ignored.

## Claude Code

Sources: <https://code.claude.com/docs/en/mcp>, <https://code.claude.com/docs/en/settings>, <https://code.claude.com/docs/en/permissions>

### `.mcp.json` (project MCP servers)

- **Location:** project root. AgentConfig Doctor also checks `.mcp.json` files in sub-directories (monorepos), because Claude Code reads the one at the root of whichever directory it is started in.
- **Parsing:** strict JSON. Comments and trailing commas are reported as errors.
- **Structure:** `{ "mcpServers": { "<name>": <server> } }`
- **Server fields:**
  - `type`: `stdio`, `http`, `sse`, `ws`, or `streamable-http` (an alias of `http`). Claude Code treats an entry with `url` but no `type` as stdio and rejects it; ACD005 reports this.
  - stdio: `command` (string), `args` (string array), `env` (object of strings).
  - remote: `url`, `headers` (object of strings), `headersHelper` (a command), `timeout`, `oauth`.
- **Variable expansion:** `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url` and `headers`. Values that contain a reference are not reported as hard-coded secrets. ACD002 also checks the command line with each default substituted (see [rules](rules.md#acd002-risky-command-configuration-up-to-critical)).

### `.claude/settings.json` and `.claude/settings.local.json`

- **Parsing:** strict JSON.
- **Fields checked:**
  - `permissions.allow`, `permissions.ask`, `permissions.deny`: arrays of `Tool` or `Tool(specifier)` rules. In Read/Edit specifiers, `//path` is absolute, `~/path` is home-relative, and `/path` or `./path` is relative to the settings location.
  - `permissions.defaultMode`: `default` (alias `manual`), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`. Current Claude Code ignores `auto` and `bypassPermissions` in project and local settings; older versions (before v2.1.257 for `bypassPermissions`) applied them.
  - `permissions.additionalDirectories`: string array.
  - `enableAllProjectMcpServers` (boolean), `enabledMcpjsonServers` and `disabledMcpjsonServers` (string arrays).
  - `env`: object of strings.
  - `hooks`: `{ "<Event>": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] } ] }`.
  - `apiKeyHelper` (command string), `statusLine.command`.
  - `sandbox.enabled`, `sandbox.filesystem.allowWrite`, `sandbox.filesystem.allowRead`.
- Claude Code documents that it skips MCP permission rules with parentheses (`mcp__server(...)`) and ignores rules that use `field:` syntax on a tool's primary content field. ACD008 reports both.

### Instruction files

`CLAUDE.md`, `CLAUDE.local.md` and `.claude/CLAUDE.md` are read as plain text for credential, dangerous-command and hidden-Unicode checks.

## Cursor

Sources: <https://cursor.com/docs/context/mcp>, <https://cursor.com/docs/context/rules>

### `.cursor/mcp.json`

- **Parsing:** strict JSON.
- **Structure:** `{ "mcpServers": { "<name>": <server> } }`
- stdio: `type` (`stdio`; optional in practice), `command`, `args`, `env`, `envFile` (stdio only).
- remote: `url`, `headers`, `auth`. `type` is optional; a `url` implies a remote server.
- Variable interpolation: `${env:NAME}`, `${userHome}`, `${workspaceFolder}`, `${workspaceFolderBasename}`, `${pathSeparator}`, `${/}`.
- The global `~/.cursor/mcp.json` has the same format and is scanned only when passed explicitly.

### `.cursor/rules/**/*.mdc`

- Text files with optional YAML frontmatter between `---` lines: `description` (string), `globs` (comma-separated string or list) and `alwaysApply` (boolean).
- Cursor ignores plain `.md` files in `.cursor/rules`; ACD008 reports them.
- The frontmatter parser supports the subset Cursor uses (scalars, flow lists and block lists) and reports anything else instead of guessing.

### `AGENTS.md` and `.cursorrules`

Read as plain text. `AGENTS.md` is supported by Cursor and several other agents; `.cursorrules` is the legacy single-file format.

## VS Code (GitHub Copilot agent mode)

Source: <https://code.visualstudio.com/docs/copilot/reference/mcp-configuration>

### `.vscode/mcp.json`

- **Parsing:** JSONC (comments and trailing commas allowed), as in VS Code.
- **Structure:** `{ "inputs": [...], "servers": { "<name>": <server> } }`. The key is `servers`, not `mcpServers`; ACD005 points out the mix-up.
- stdio: `type: "stdio"`, `command`, `args`, `env` (values may be strings, numbers or null), `envFile`, `cwd`.
- remote: `type: "http"` or `"sse"`, `url`, `headers`.
- Predefined variables such as `${workspaceFolder}`, `${userHome}`, `${env:NAME}` and `${/}` ([variables reference](https://code.visualstudio.com/docs/reference/variables-reference)).
- `inputs`: an array of `{ type, id, description, password }`. Every `${input:<id>}` reference must match a declared input; ACD005 reports undefined ones.

## Not supported (yet)

- User-level and enterprise files such as `~/.claude.json`, `~/.claude/settings.json` and managed settings. A user-level file can be scanned by passing its path explicitly when its format matches one above (for example `~/.cursor/mcp.json`).
- Other agents (Windsurf, Zed, Continue, Codex CLI, Gemini CLI, Cline). Contributions backed by verified format documentation are welcome.
- YAML or TOML MCP configuration.

## File handling limits

| Limit                     | Default | Option            |
| ------------------------- | ------- | ----------------- |
| Maximum file size         | 1 MiB   | `--max-file-size` |
| Maximum directory entries | 200,000 | API option only   |
| Maximum directory depth   | 40      | none              |

Directories skipped by default: `node_modules`, `.git`, `.hg`, `.svn`, `dist`, `build`, `out`, `coverage`, `.next`, `.nuxt`, `.turbo`, `.cache`, `.venv`, `venv`, `__pycache__`, `target`, `vendor`. To scan inside one of them, pass it as the scan path.
