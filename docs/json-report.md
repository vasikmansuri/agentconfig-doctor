# JSON report format

`agentconfig-doctor scan --format json` writes a single JSON document. Its structure is versioned by `schemaVersion`: fields are only added in minor releases, and any removal or change of meaning bumps `schemaVersion`. Output is deterministic; the same input produces byte-identical output, with no timestamps.

```json
{
  "schemaVersion": 1,
  "tool": { "name": "agentconfig-doctor", "version": "0.1.0" },
  "target": "examples/risky-project",
  "summary": {
    "filesScanned": 5,
    "filesSkipped": 0,
    "findings": 20,
    "bySeverity": { "critical": 0, "high": 9, "medium": 6, "low": 5, "info": 0 },
    "suppressed": 0,
    "failOn": "high",
    "failed": true,
    "newFindings": 3,
    "resolvedFindings": 1
  },
  "files": [{ "path": ".mcp.json", "kind": "claude-mcp" }],
  "skipped": [
    {
      "path": "big/.mcp.json",
      "reason": "file is 2000000 bytes, larger than the 1048576-byte limit (see --max-file-size)"
    }
  ],
  "findings": [
    {
      "ruleId": "ACD003",
      "title": "Broad filesystem access",
      "severity": "high",
      "confidence": "medium",
      "file": ".mcp.json",
      "kind": "claude-mcp",
      "line": 8,
      "column": 9,
      "message": "MCP server \"filesystem\" argument grants access to the entire filesystem (/).",
      "evidence": "/",
      "why": "An agent or MCP server with access to these locations can ...",
      "remediation": "Grant access to the project directory ...",
      "fingerprint": "5d41402abc4b2a76",
      "baseline": "new"
    }
  ],
  "baseline": {
    "file": ".agentconfig-doctor-baseline.json",
    "resolved": [
      {
        "fingerprint": "8f14e45fceea167a",
        "ruleId": "ACD001",
        "file": "CLAUDE.md",
        "title": "Potential exposed credential"
      }
    ]
  },
  "notes": ["Findings come from static, heuristic rules. ..."]
}
```

| Field                                                         | Notes                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `summary.failed`                                              | Whether any counted finding is at or above `failOn`. Matches exit code 1.                                                       |
| `summary.newFindings`, `summary.resolvedFindings`, `baseline` | Present only with `--baseline`.                                                                                                 |
| `findings[].kind`                                             | One of `claude-mcp`, `cursor-mcp`, `vscode-mcp`, `claude-settings`, `cursor-rule`, `instructions`.                              |
| `findings[].line`, `findings[].column`                        | 1-based. Omitted when there is no reliable location (for example a removed deny rule).                                          |
| `findings[].evidence`                                         | Redacted and truncated. Optional.                                                                                               |
| `findings[].resolvedCommand`                                  | ACD002 only, for MCP command lines with variable references: the line after static expansion. Redacted and truncated. Optional. |
| `findings[].baseline`                                         | `"new"` or `"existing"`, only with `--baseline`.                                                                                |
| `files[].path`, `findings[].file`                             | POSIX path relative to the scan root, or the path as given for a single-file scan.                                              |

Findings are sorted by severity (most severe first), then by file, line, column, rule ID and fingerprint.
