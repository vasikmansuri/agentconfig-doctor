# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting). Do not open a public issue.

Please include:

- the version (`agentconfig-doctor --version`) and your Node.js version;
- a description of the issue and its impact;
- a minimal reproduction that uses made-up values only, never real credentials.

You can expect an acknowledgement within 7 days and a status update within 14 days. Fixes are released as patch versions and credited in the changelog unless you prefer otherwise.

## In scope

- The scanner executing, fetching or evaluating content from scanned files.
- Secrets appearing unredacted in any output format, error message or baseline file.
- Reading files outside the scan root (symlink or path traversal).
- Terminal escape-sequence or HTML injection through scanned content.
- Crashes or resource exhaustion caused by crafted input that get past the documented limits.

## Out of scope

- Missed detections (false negatives) and false positives. These are ordinary bugs; please open a regular issue.
- Vulnerabilities in the configurations being scanned.

See [docs/security-model.md](docs/security-model.md) for the full threat model.
