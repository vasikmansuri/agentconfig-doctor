# Rule catalogue

Run `agentconfig-doctor rules` (or `rules --format json`) to see the same information for the installed version.

## Severity levels

| Severity   | Meaning                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `critical` | Likely exploitable or damaging as soon as the file is shared or used: a live-looking vendor credential, a reverse shell, credential exfiltration, disk destruction. |
| `high`     | Grants an agent or tool significant unreviewed capability: download-and-execute, whole-filesystem access, auto-approval of local servers, hard-coded secrets.       |
| `medium`   | Weakens a safety boundary or makes the configuration invalid: plaintext endpoints, invalid MCP definitions, ignored settings, removed deny rules.                   |
| `low`      | Hygiene and supply-chain issues worth fixing: unpinned packages, shell wrappers, case-only name collisions.                                                         |
| `info`     | Context, mostly permission tightening reported by ACD009.                                                                                                           |

Each finding also has a **confidence** (`high`, `medium` or `low`): how likely the match is to be what the rule describes. The `--fail-on` threshold uses severity only.

## Fingerprints

Every finding has a 16-hex-digit `fingerprint` derived from the rule ID, the file path and a rule-specific key (for example the server name and pattern ID). It does not depend on line numbers, so baselines survive unrelated edits.

## Rules

### ACD001 Potential exposed credential (up to critical)

Matches documented vendor token formats (GitHub classic and fine-grained, GitLab, AWS key IDs and secret-key assignments, Anthropic, OpenAI-style `sk-`, Slack tokens and webhooks, Stripe live and test keys, Google API keys, npm, Hugging Face), PEM private keys, JWTs, passwords embedded in URLs (`scheme://user:pass@host`) and literal `Bearer` tokens. Variable references (`${VAR}`, `$VAR`, `{{VAR}}`) and obvious placeholders (`xxxx`, `<token>`, `your-...`, `EXAMPLE`, `changeme`) are ignored. Applies to every supported file, including prose.

### ACD002 Risky command configuration (up to critical)

Analyses MCP `command` plus `args`, `headersHelper`, Claude Code hook commands, `apiKeyHelper`, `statusLine.command`, `Bash(...)`/`PowerShell(...)` allow rules, and instruction files.

- **critical:** reverse shells, credential-file exfiltration, disk destruction, fork bombs.
- **high:** download-and-execute, executing remote output, PowerShell download-and-execute, decoded payloads, recursive force-deletes of `/`, `~`, `.`, `..` or `*`.
- **medium:** world-writable `chmod`, `sudo`, TLS-verification bypass.
- **low:** MCP servers started through `sh -c` or `cmd /c` style wrappers.

In prose files most patterns are reported at a lower severity and with low confidence, because documentation often quotes installers.

### ACD003 Broad filesystem access (up to high)

Reports paths that expose any of the following:

- the filesystem root;
- a whole home directory;
- a credential location: `~/.ssh`, `~/.aws`, `~/.azure`, `~/.gnupg`, `~/.kube`, `~/.docker`, `~/.config/gcloud`, `~/.config/gh`, `~/.npmrc`, `~/.netrc`, `~/.pypirc`, `~/.git-credentials`, `~/.claude`, `~/.cursor`, `~/Library/Keychains`, `/var/run/docker.sock`;
- a system directory.

It checks MCP args (including `--flag=/path`), docker/podman `-v`/`--mount` sources, `permissions.additionalDirectories`, Read/Edit/Write/Glob/Grep allow rules that use `//` or `~/`, and `sandbox.filesystem.allowWrite`/`allowRead`. To accept a path, add it exactly to `allowedPaths` in a config file.

### ACD004 Hard-coded value in sensitive environment variable or header (high)

Flags literal values in two places:

- **Environment variables** whose names contain `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASSPHRASE`, `CREDENTIAL`, `AUTH`, `SESSION`, `COOKIE`, `DSN`, `CONNECTION_STRING` or `DATABASE_URL`. Names such as `..._KEY_ID`, `..._KEY_PATH`, `..._KEY_FILE` and `..._AUTH_URL` are excluded.
- **Headers:** `Authorization`, `Cookie`, and `X-...-Key/Token` headers.

Values of 8 characters or fewer, booleans, numbers, references and placeholders are ignored. Values that match a known credential format are left to ACD001.

### ACD005 Invalid MCP configuration (medium)

Checks:

- JSON syntax.
- The top-level `mcpServers`/`servers` object, including mixing the two up.
- Field types, using a Zod schema.
- Unknown `type` values for each client.
- `command` and `url` both set, or neither set.
- Claude Code `url` without `type`.
- Empty commands, and arguments packed into `command` (heuristic, low).
- Malformed URLs or URL schemes that don't match the transport.
- stdio-only fields on remote servers.
- VS Code `inputs` structure and undefined `${input:...}` references.

### ACD006 Suspicious MCP server definition (up to high)

- **Remote endpoints:**
  - plain `http://` or `ws://` to a non-local host (medium);
  - a public IP-literal endpoint (low, low confidence);
  - a host outside `allowedHosts`, when that list is configured (medium).
- **Unpinned packages** run through `npx`, `pnpx`, `bunx`, `uvx`, `pnpm dlx`, `yarn dlx`, `bun x` or `pipx run` (low).
- **Executables** in temp or Downloads directories (medium).
- **docker/podman flags:**
  - `--privileged`, `--cap-add ALL/SYS_ADMIN` (high);
  - `--network host`, `--pid host`, unconfined security profiles (medium).
- **Server environment:**
  - `NODE_TLS_REJECT_UNAUTHORIZED=0`, `PYTHONHTTPSVERIFY=0`, `GIT_SSL_NO_VERIFY` (medium);
  - `LD_PRELOAD` / `DYLD_INSERT_LIBRARIES`-style variables (high).

### ACD007 Duplicate or conflicting MCP server name (medium)

Duplicate keys in the servers object (medium); names that differ only by case (low); the same name with a different command, args or url in another scanned MCP file (low).

### ACD008 Missing or invalid setting (medium)

**Claude Code settings:**

- JSON syntax.
- Types of the `permissions` lists, `env`, the MCP approval lists, `enableAllProjectMcpServers` and `sandbox.enabled`.
- Malformed rule syntax.
- `mcp__...(...)` rules, which Claude Code skips.
- `Tool(field:...)` rules on primary content fields, which Claude Code ignores.
- Rules that appear in both allow and deny (low).
- Unknown `defaultMode` values, and `bypassPermissions`/`auto` in project settings (medium).
- `enabledMcpjsonServers` entries that are missing from the sibling `.mcp.json` or are also disabled (low).
- Hook structure.

**Cursor rules:** `.md` instead of `.mdc`, missing or unterminated frontmatter, and field types.

### ACD009 Permission change since baseline (up to high)

Requires `--baseline`. See [baselines.md](baselines.md).

### ACD010 Risky combination of settings (high)

- `enableAllProjectMcpServers: true` while the project's `.mcp.json` defines local (stdio) servers: high (medium if none exist yet).
- An allow rule that approves every shell command (`Bash`, `Bash(*)`, `Bash(:*)`, `PowerShell`) with no `sandbox.enabled: true` in any settings file of the same project: high.

### ACD011 Hidden or bidirectional Unicode characters (up to high)

- Bidi controls U+202A–U+202E and U+2066–U+2069: high.
- Unicode tag characters U+E0000–U+E007F: high.
- Zero-width U+200B, U+2060 and non-leading U+FEFF: medium.

U+200C and U+200D are not reported because they are legitimate in emoji and several scripts.
