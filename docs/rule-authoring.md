# Writing a rule

Rules are small, deterministic functions over parsed documents. This guide walks through adding one.

## Architecture in one minute

```
src/discovery/   find files by path (classify.ts decides which formats exist)
src/parsers/     JSON/JSONC with locations, Cursor frontmatter
src/rules/       one file per rule, plus shared models (mcp-model, settings-model, paths, command-patterns)
src/engine/      runs rules, builds fingerprints, applies config, sorts findings
src/baseline/    permission snapshot and baseline files
src/reporters/   terminal, JSON, HTML
src/cli/         Commander program and exit codes
```

Dependencies only point forward: discovery, then parsing, then rules, then reporting. Rules never touch the filesystem, the network or child processes.

## The `Rule` interface

```ts
export const myRule: Rule = {
  id: 'ACD012', // the next free ID; IDs are never reused or renumbered
  name: 'my-rule', // kebab-case
  title: 'Short human title',
  severity: 'medium', // the highest severity the rule normally emits
  description: 'What it detects, in one or two sentences.',
  appliesTo: ['claude-mcp'], // configuration kinds the rule inspects
  why: 'Why this matters. Be factual and do not overstate.',
  remediation: 'What to do instead.',
  check(ctx) {
    return ctx.documents.flatMap((doc) =>
      getMcpServers(doc)
        .filter((server) => server.args.includes('--dangerous'))
        .map((server) =>
          findingFor(doc, {
            severity: 'medium',
            confidence: 'high',
            message: `MCP server "${server.name}" is started with --dangerous.`,
            evidence: '--dangerous', // never a secret; it is scrubbed again anyway
            location: doc.locate(server.path), // JSON path -> line/column
            key: `mcp:${server.name}:dangerous`, // stable fingerprint identity, no raw secrets
          }),
        ),
    );
  },
};
```

Register the rule in `src/rules/index.ts`, keeping the array in ID order.

## Checklist

- [ ] The rule is backed by documentation of the format, or its description clearly labels it as a heuristic.
- [ ] Messages state what was observed, not what an attacker "will" do.
- [ ] `key` is stable across unrelated edits and contains no secret values (hash them with `shortHash`).
- [ ] Evidence is redacted: use `redactSecret` or `redactLiteral` for values that may be sensitive, and `truncate` for long strings.
- [ ] Tests cover a positive case, a negative case, at least one edge case, and that no secret appears in the output (`JSON.stringify(findings)` must not contain it).
- [ ] Test credentials are built at runtime from fragments (see `fake` in `tests/helpers.ts`), never committed as complete literals.
- [ ] `docs/rules.md` and the README rule table are updated.
- [ ] `npm run check` passes.

## Adding a credential pattern

Add an entry to `SECRET_PATTERNS` in `src/util/secrets.ts` with a documented vendor prefix, a `keepPrefix` that reveals only that public prefix, and `distinctivePrefix: true` if the prefix is long and unambiguous. Add a positive test to `tests/util/secrets.test.ts`; a coverage test fails if a pattern has none.

## Adding a configuration format

1. Verify the format against official documentation and add it to `docs/supported-formats.md` with a source link.
2. Add the kind to `CONFIG_KINDS` in `src/types/index.ts` and a path rule in `src/discovery/classify.ts`.
3. Choose the parser in `src/parsers/index.ts` (strict JSON unless the client documents JSONC).
4. Extend the relevant model (`mcp-model.ts` or a new one) and each rule's `appliesTo`.
5. Add discovery, parser and rule tests with fixtures for the new format.
