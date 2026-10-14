# Releasing

Releases are manual. No workflow publishes to npm or creates GitHub releases automatically.

## Checklist

1. Make sure `main` is green in CI.
2. Update `CHANGELOG.md`, moving entries from "Unreleased" to the new version.
3. On a release branch, bump the version without creating a tag:

   ```bash
   git switch -c release/0.1.1
   npm version 0.1.1 --no-git-tag-version   # or: patch | minor | major
   ```

4. Run the full checks and inspect the package:

   ```bash
   npm ci
   npm run check
   npm pack --dry-run          # expect only dist/, docs/, README.md, LICENSE, CHANGELOG.md, SECURITY.md, package.json
   npm pack
   mkdir -p /tmp/acd-smoke && cd /tmp/acd-smoke && npm init -y >/dev/null
   npm install /path/to/agentconfig-doctor-0.1.1.tgz
   npx agentconfig-doctor --version
   npx agentconfig-doctor scan /path/to/agentconfig-doctor/examples/risky-project; echo "exit=$?"   # expect 1
   ```

5. Commit, push the branch and open a pull request (`main` is protected):

   ```bash
   git commit -am "chore: release 0.1.1"
   git push -u origin release/0.1.1
   gh pr create --fill
   ```

6. After the pull request is merged, tag the merge commit and push the tag:

   ```bash
   git switch main && git pull --ff-only
   git tag -a v0.1.1 -m "v0.1.1"
   git push origin v0.1.1
   ```

## Publishing to npm

You need an npm account with two-factor authentication enabled.

```bash
npm login                      # interactive; uses your npm credentials
npm whoami
npm publish --access public    # asks for a 2FA one-time password
```

`npm publish --provenance` only works from a supported CI provider such as GitHub Actions. If you add a publishing workflow later, gate it on a protected `release` environment with required reviewers, and use npm trusted publishing (OIDC) instead of a long-lived `NPM_TOKEN` secret.

## GitHub release

```bash
gh release create v0.1.1 --title "v0.1.1" --notes "See CHANGELOG.md for details."
```

No files need to be attached; the npm package is the distribution artifact.
