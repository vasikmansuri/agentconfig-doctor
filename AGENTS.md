# Notes for coding agents working on this repository

- Run `npm run check` before proposing changes. It runs the typecheck, lint, format check, build and tests.
- The scanner must never execute scanned content, spawn processes or make network requests. Do not add code that does.
- Never write complete credential-shaped strings into source or tests. Build test values at runtime from fragments, as in `tests/helpers.ts`.
- Rule IDs (`ACD001` and so on) are a public interface: never renumber or reuse them.
- Every rule change needs positive, negative, edge-case and redaction tests.
- Keep the documentation in `docs/` accurate: no compatibility claims without a source link.
