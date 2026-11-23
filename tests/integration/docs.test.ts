import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const markdownFiles = [
  'README.md',
  ...readdirSync(new URL('docs/', root))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
];

/**
 * `npx` with a version or `--yes` downloads from the registry. The package is
 * published under a scope, so the unscoped name would run someone else's code.
 */
const UNSCOPED_REGISTRY_NPX = /npx\s+(?:(?:--yes|-y)\s+agentconfig-doctor\b|agentconfig-doctor@)/;

describe('documentation', () => {
  it.each(markdownFiles)('%s never runs the unscoped package from the registry', (file) => {
    const offending = readFileSync(new URL(file, root), 'utf8')
      .split('\n')
      .filter((line) => UNSCOPED_REGISTRY_NPX.test(line));
    expect(offending).toEqual([]);
  });

  it('recognises the unsafe forms', () => {
    expect(UNSCOPED_REGISTRY_NPX.test('npx --yes agentconfig-doctor@0.1.0 scan .')).toBe(true);
    expect(UNSCOPED_REGISTRY_NPX.test('npx agentconfig-doctor@latest scan')).toBe(true);
    expect(UNSCOPED_REGISTRY_NPX.test('npx -y agentconfig-doctor scan')).toBe(true);
    expect(
      UNSCOPED_REGISTRY_NPX.test('npx --yes @vasikmansuri/agentconfig-doctor@0.1.2 scan'),
    ).toBe(false);
    expect(UNSCOPED_REGISTRY_NPX.test('npx agentconfig-doctor --version')).toBe(false);
  });
});
