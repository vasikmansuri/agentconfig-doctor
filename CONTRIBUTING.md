# Contributing to AgentConfig Doctor

Thank you for helping! Bug reports, false-positive reports, documentation fixes, new credential patterns, new rules and new agent adapters are all welcome.

## Quick start

Requirements: Node.js 22.12+ and npm.

```bash
git clone https://github.com/vasikmansuri/agentconfig-doctor.git
cd agentconfig-doctor
npm ci
npm run check          # typecheck, lint, format check, build, tests
node dist/cli.js scan examples/risky-project
```

| Script                                    | Purpose                                     |
| ----------------------------------------- | ------------------------------------------- |
| `npm test`                                | Run the test suite (Vitest)                 |
| `npm run test:coverage`                   | Tests with a coverage report and thresholds |
| `npm run lint`                            | ESLint (type-aware)                         |
| `npm run format` / `npm run format:check` | Prettier                                    |
| `npm run typecheck`                       | `tsc --noEmit`                              |
| `npm run build`                           | Build `dist/` with tsup                     |
| `npm run check`                           | Everything CI runs                          |

## Good first contributions

- Report a false positive with a minimal snippet (use the "False positive" issue template).
- Add a credential pattern for a vendor that documents its token prefix.
- Improve a rule's message or remediation text.
- Add fixtures based on real-world configurations, with every value made up.

Look for issues labelled `good first issue` and `help wanted`.

## Adding or changing a rule

Read [docs/rule-authoring.md](docs/rule-authoring.md). In short: one file per rule in `src/rules/`, registered in `src/rules/index.ts`, with positive, negative, edge-case and redaction tests.

## Ground rules

- **Never commit real credentials**, not even revoked ones. Tests build credential-shaped strings at runtime from fragments (`tests/helpers.ts`).
- **No network access and no child processes** in the scanner. The tool must stay safe to run on untrusted repositories.
- **No new runtime dependencies** without discussing them in an issue first.
- **Be accurate.** Do not claim a format is supported without a documentation link, and do not describe heuristic findings as proven vulnerabilities.
- Keep rule IDs stable. Never renumber or reuse an ID.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests and docs.
3. Run `npm run check`.
4. Open a pull request and fill in the template. CI must pass before merging; `main` is protected and uses linear history.

Commit messages: a short imperative subject (for example `Add Hugging Face token pattern`). [Conventional Commits](https://www.conventionalcommits.org/) prefixes are welcome but not required.

## Reporting security issues

Please do **not** open a public issue for a vulnerability in AgentConfig Doctor itself. Follow [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows its [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.
