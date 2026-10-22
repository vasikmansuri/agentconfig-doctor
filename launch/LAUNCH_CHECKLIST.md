# Launch checklist

Status as of 2026-10-14. `[x]` means done and verified; `[ ]` means pending.

## Repository

- [x] Public repository: https://github.com/vasikmansuri/agentconfig-doctor
- [x] Description and 20 topics set
- [x] Commit history authored as Vasik Mansuri
- [x] Secret scanning, push protection, Dependabot alerts and security updates, private vulnerability reporting enabled
- [x] `main` protected: pull request required (0 approvals, suited to a solo maintainer), 7 required checks, branch must be up to date, applies to admins, linear history, conversation resolution, no force pushes, no deletion
- [ ] When a second maintainer joins, raise required approvals to 1 (Settings → Branches → `main`)

## CI

- [x] First CI run on `main` passed: Check (Node 22), Check (Node 24), Test (macos-latest), Test (windows-latest), Package, Dependency audit
- [x] README "from source" steps verified in a fresh clone with an empty npm cache

## Social preview

- [x] Image created: `launch/social-preview.png` (1280×640) and its source `launch/social-preview.svg`
- [ ] Upload it: **Settings → General → Social preview → Edit → Upload an image**, then choose `launch/social-preview.png`. GitHub has no API for this step.

## Release readiness (0.1.0)

- [x] `npm run check` passes (typecheck, lint, format, build, 237 tests)
- [x] Package contents inspected: 18 files, about 64 kB (`dist/`, `docs/`, README, LICENSE, CHANGELOG, SECURITY)
- [x] Tarball installed and run in a clean project (also checked in CI on every push)
- [x] Package name `agentconfig-doctor` was unclaimed on npm at last check
- [ ] Final review of `CHANGELOG.md`; change "0.1.0 - Unreleased" to the release date
- [ ] Tag and GitHub release (see `docs/releasing.md`):
  ```bash
  git switch main && git pull --ff-only
  git tag -a v0.1.0 -m "v0.1.0" && git push origin v0.1.0
  gh release create v0.1.0 --title "v0.1.0" --notes "First public release. See CHANGELOG.md."
  ```

## npm publishing (needs the owner's explicit go-ahead)

- [ ] npm account with two-factor authentication enabled
- [ ] Publish:
  ```bash
  npm login
  npm whoami
  npm view agentconfig-doctor name   # should still be E404 (name unclaimed)
  npm publish --access public        # prompts for a one-time password
  ```
- [ ] After publishing, update the README status note (it says "has not been published to npm yet"), then confirm `npx @vasikmansuri/agentconfig-doctor@0.1.0 --version` works from a clean directory.

## Launch materials

- [x] Drafts in `launch/launch-kit.md`: repository description, LinkedIn post, X post, article outline, 60-second demo script, list of communities
- [ ] Record the demo with real output (for example `asciinema rec`)
- [ ] Post only where each community's rules allow it; never ask for stars
- [ ] Watch issues for false-positive reports during the first weeks and answer them
