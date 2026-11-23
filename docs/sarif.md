# SARIF output

> Available from version 0.2.0.

`agentconfig-doctor scan --format sarif` (and `check-mcp --format sarif`) writes a [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) log. Upload it to GitHub code scanning to see findings in the repository's **Security** tab and as annotations on pull requests. See [GitHub Actions](github-actions.md#github-code-scanning-sarif) for a workflow.

The log has one run. Like every other format it is redacted and deterministic: the same input gives the same bytes, with no timestamps or absolute paths.

## Field mapping

| SARIF field                            | Value                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `tool.driver.rules[]`                  | Every rule, in ID order, with `shortDescription` (title), `fullDescription`, `help` and a `helpUri` link |
| `rules[].properties.security-severity` | From the rule's highest severity: critical `9.5`, high `8.0`, medium `5.5`, low `3.0`, info `1.0`        |
| `rules[].properties.tags`              | `["security"]`                                                                                           |
| `results[].level`                      | From the finding's own severity: critical and high → `error`, medium → `warning`, low and info → `note`  |
| `results[].message.text`               | The finding message, then the redacted evidence and resolved command, if any                             |
| `results[].locations[0]`               | File and line. Findings without a line (for example a file that is not valid JSON) point at line 1       |
| `results[].partialFingerprints`        | `primaryLocationLineHash` and `agentconfigDoctor/v1`, both from the [fingerprint](rules.md#fingerprints) |
| `results[].baselineState`              | With `--baseline`: `new` or `unchanged`                                                                  |
| `results[].properties`                 | `severity`, `precision` (the finding's confidence) and `kind` (the configuration type)                   |
| `runs[0].properties`                   | `filesScanned`, `filesSkipped`, `suppressed` and `notes`                                                 |

GitHub reads `security-severity` per rule, not per result ([SARIF support for code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)). A rule that reports up to critical therefore shows as **Critical** in the Security tab even for a lower-severity finding; `level` and `properties.severity` carry the finding's own severity.

The fingerprint does not depend on line numbers, so GitHub keeps tracking the same alert when unrelated lines in the file change.

## File paths

GitHub resolves `artifactLocation.uri` relative to the repository root. AgentConfig Doctor makes paths relative to the **current working directory** when the scan root is inside it, so run the scan from the repository root (the default in GitHub Actions):

```bash
agentconfig-doctor scan packages/web --format sarif --output agentconfig-doctor.sarif
# reports packages/web/.mcp.json, not .mcp.json
```

When the scan root is outside the working directory, paths stay relative to the scan root.
