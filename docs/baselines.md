# Baselines

A baseline lets you adopt AgentConfig Doctor in an existing project without fixing every finding first, and makes permission changes visible in review.

## Workflow

```bash
agentconfig-doctor baseline create            # .agentconfig-doctor-baseline.json
agentconfig-doctor scan --baseline .agentconfig-doctor-baseline.json
agentconfig-doctor baseline update            # accept the current state, deliberately
```

Use `--output <file>` with `baseline create|update` to choose another path. The `--include`, `--exclude`, `--config` and `--max-file-size` options work as they do for `scan`; use the same options when creating and comparing.

## Behaviour

- `baseline create` fails (exit 2) if the file already exists.
- `baseline update` fails (exit 2) if the file does not exist, and prints how many findings were added and removed.
- `scan --baseline` marks each finding as `new` or `existing` (`[new]` or `[baseline]` in the terminal, `"baseline": "new" | "existing"` in JSON). Only **new** findings count towards `--fail-on`.
- Baseline entries that no longer occur are reported as **resolved** (fixed, removed, or now suppressed). They never cause a failure; run `baseline update` to drop them.
- ACD009 compares the saved permission snapshot with the current one and reports the changes. ACD009 findings are always `new` and are never stored in a baseline.
- A baseline that is not valid JSON, fails schema validation, or uses a newer schema version stops the scan with exit code 2. The tool never falls back to scanning without it.

## What ACD009 reports

| Change                                                                           | Severity |
| -------------------------------------------------------------------------------- | -------- |
| `enableAllProjectMcpServers` turned on                                           | high     |
| Allow rule added                                                                 | medium   |
| Deny rule removed (including by deleting the settings file)                      | medium   |
| `defaultMode` changed to `acceptEdits`, `auto` or `bypassPermissions`            | medium   |
| Additional directory added                                                       | medium   |
| Server added to `enabledMcpjsonServers` or removed from `disabledMcpjsonServers` | medium   |
| Sandbox no longer enabled                                                        | medium   |
| Hook command added or changed                                                    | medium   |
| MCP server added, or its command, args, url or variable names changed            | medium   |
| Ask rule removed                                                                 | low      |
| Tightening (deny or ask added, allow removed, server removed, mode tightened)    | info     |

A change is not necessarily a vulnerability; it is something a reviewer should see.

## File format

```json
{
  "schemaVersion": 1,
  "tool": "agentconfig-doctor",
  "toolVersion": "0.1.0",
  "findings": [
    {
      "fingerprint": "0f3c2a9d8e7b6c5a",
      "ruleId": "ACD006",
      "file": ".mcp.json",
      "title": "Suspicious MCP server definition"
    }
  ],
  "permissions": {
    "settings": {
      ".claude/settings.json": {
        "allow": ["Bash(npm test)"],
        "ask": [],
        "deny": ["Read(./.env)"],
        "additionalDirectories": [],
        "enabledMcpjsonServers": [],
        "disabledMcpjsonServers": [],
        "hooks": ["PostToolUse:3b1f0c2e9a8d7f6e"],
        "sandboxEnabled": true
      }
    },
    "mcpServers": { ".mcp.json": { "github": "9a8b7c6d5e4f3a2b" } }
  }
}
```

Paths are POSIX-style and relative to the scan root, so baselines work across machines and operating systems. Permission rules are stored after secret redaction, and MCP server definitions and hook commands only as hashes. Unknown fields are rejected, so a hand-edited baseline with a typo fails loudly instead of being ignored.

Git-diff based comparison (`--since <ref>`) is on the roadmap.
