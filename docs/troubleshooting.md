# Troubleshooting

## "No supported agent configuration files were found"

The scanner only reads the files listed in [supported-formats.md](supported-formats.md). Check that:

- you passed the project root (or the file itself) as the path;
- the files are not inside a default-ignored directory (`node_modules`, `dist`, `build`, `.git`, ...). To scan one, pass that directory as the path;
- `--include` and `--exclude` patterns are not filtering them out. Patterns are matched against paths relative to the scan root, using `/` separators;
- the configuration does not live in your home directory. Home-directory files are only scanned when passed explicitly, for example `agentconfig-doctor scan ~/.cursor/mcp.json`.

Use `--fail-if-empty` in CI so that a wrong path fails the job (exit code 4) instead of passing silently.

## A file is listed under "Skipped"

| Reason                                                | What to do                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `larger than the ...-byte limit`                      | Raise `--max-file-size` if the file is legitimate.                     |
| `symlink points outside the scan root (not followed)` | Scan the symlink target directly, or move the config into the project. |
| `symlinked directory not followed`                    | Scan the target directory directly.                                    |
| `binary content`                                      | The file is not text, and agent configs always are.                    |
| `unreadable (EACCES)`                                 | Fix the file permissions.                                              |

## A finding looks wrong

1. Run with `--verbose` to see the explanation, confidence and fingerprint.
2. If it is a false positive, please [report it](https://github.com/vasikmansuri/agentconfig-doctor/issues/new?template=false_positive.yml) with a minimal, secret-free snippet.
3. To accept it locally, suppress it by fingerprint in a config file passed with `--config`:

   ```json
   {
     "ignore": [
       { "rule": "ACD002", "fingerprint": "0123456789abcdef", "reason": "documented installer" }
     ]
   }
   ```

   Alternatively, create a baseline with `agentconfig-doctor baseline create`.

## Exit codes in CI

| Code | Meaning                                                 | Typical fix                                                     |
| ---- | ------------------------------------------------------- | --------------------------------------------------------------- |
| 1    | Findings at or above `--fail-on`                        | Fix them, raise the threshold, or adopt a baseline.             |
| 2    | Bad option, missing path, or invalid config or baseline | Read the `error:` line on stderr.                               |
| 3    | Internal error                                          | Re-run with `--verbose` and open an issue with the stack trace. |
| 4    | Nothing found with `--fail-if-empty`                    | Check the scan path.                                            |

## Colours in logs

Colour is only used when stdout is a terminal. Set `NO_COLOR=1` or pass `--no-color` to turn it off, or set `FORCE_COLOR=1` to force it on (for example in a CI log viewer that supports ANSI).

## "Comments are not allowed in this file format"

`.mcp.json`, `.cursor/mcp.json` and `.claude/settings.json` are strict JSON. Only `.vscode/mcp.json` accepts comments (JSONC), matching each client's behaviour.

## Node.js version errors

The CLI requires Node.js 22.12 or later. Check with `node --version`.
