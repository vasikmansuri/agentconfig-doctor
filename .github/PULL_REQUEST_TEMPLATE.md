## What and why

<!-- Describe the change and link the issue it addresses. -->

## Checklist

- [ ] `npm run check` passes locally
- [ ] Tests cover the change (for rules: positive, negative, edge case and redaction)
- [ ] No real credentials anywhere in the diff (test values are built from fragments)
- [ ] Docs updated (`README.md`, `docs/rules.md`, `docs/supported-formats.md`, `CHANGELOG.md` as relevant)
- [ ] No new runtime dependency, network access or child process in the scanner
- [ ] Rule IDs unchanged (new rules use the next free ID)
