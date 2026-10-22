# Examples

Two small projects for trying the scanner. All values are made up; nothing here is a real credential or endpoint.

| Directory | Expected result |
| --------- | --------------- |
| [`risky-project`](risky-project) | Exit code 1. Contains a password in a database URL, a literal bearer token and a literal token variable; `curl \| sh` in an MCP server and in a hook; whole-filesystem access; auto-approved MCP servers; unrestricted `Bash`; a duplicate server key; a command/url conflict; invalid Cursor rule frontmatter; and a hidden zero-width character. |
| [`safe-project`](safe-project) | Exit code 0. Uses pinned packages, `${VAR}` and `${input:...}` references, scoped allow rules, deny rules for `.env`, and the sandbox. |

```bash
npx @vasikmansuri/agentconfig-doctor scan examples/risky-project
npx @vasikmansuri/agentconfig-doctor scan examples/safe-project
```

CI runs both and checks their exit codes.
