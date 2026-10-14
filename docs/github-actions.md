# Using AgentConfig Doctor in GitHub Actions

AgentConfig Doctor needs no secrets and only read access to the repository. Because it never executes scanned content, it is safe to run on `pull_request` events from forks.

> These examples install from npm, which works once version 0.1.0 is published. Until then, build from source (see the last section).

## Minimal workflow

```yaml
# .github/workflows/agentconfig-doctor.yml
name: Agent config check

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22
      - name: Scan agent configuration
        run: npx --yes agentconfig-doctor@0.1.0 scan . --fail-on high --fail-if-empty
```

Notes:

- **Pin the package version** (`@0.1.0`) so a new release cannot change your CI results unexpectedly.
- **Pin actions by commit SHA**, as above. Dependabot can keep the SHAs current.
- `persist-credentials: false` keeps the job token out of the checkout, because the scan never needs to push.
- Drop `--fail-if-empty` if some repositories legitimately have no agent configuration.

## Keeping a machine-readable report

```yaml
- name: Scan agent configuration
  run: npx --yes agentconfig-doctor@0.1.0 scan . --format json --output agentconfig-report.json
- name: Show findings in the log
  if: always()
  run: npx --yes agentconfig-doctor@0.1.0 scan . --fail-on none
- uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
  if: always()
  with:
    name: agentconfig-report
    path: agentconfig-report.json
    retention-days: 14
```

The JSON report is redacted, but it still describes your configuration, so keep artifact retention short for private repositories.

## Failing only on new problems (baseline)

Commit a baseline once:

```bash
npx agentconfig-doctor baseline create
git add .agentconfig-doctor-baseline.json
```

Then, in the workflow:

```yaml
- run: npx --yes agentconfig-doctor@0.1.0 scan . --baseline .agentconfig-doctor-baseline.json --fail-on medium
```

Pull requests now fail only on new findings and on permission expansions (ACD009), such as a new `Bash(...)` allow rule or a new MCP server. Because the baseline lives in the repository, a pull request can also change it, so protect it with a `CODEOWNERS` entry:

```
/.agentconfig-doctor-baseline.json @your-org/security
/.claude/ @your-org/security
/.mcp.json @your-org/security
```

## Security notes

- Do **not** use `pull_request_target` for this workflow. It is unnecessary, and it would give code from forks access to secrets.
- The scanner makes no network requests during a scan. The only network access in the job is `npx` downloading the package and the runner fetching the actions.
- No secrets are required, so none should be passed to the job.

## Running from source (before the npm release)

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    repository: vasikmansuri/agentconfig-doctor
    ref: v0.1.0
    path: .agentconfig-doctor
    persist-credentials: false
- run: npm ci --prefix .agentconfig-doctor && npm run build --prefix .agentconfig-doctor
- run: node .agentconfig-doctor/dist/cli.js scan . --exclude .agentconfig-doctor --fail-on high
```

## A dedicated GitHub Action

A published `uses:` action is on the roadmap. It will be a thin wrapper around the same CLI, with pinned versions and the same `contents: read` permissions. Until then, the workflow above is the supported integration.
