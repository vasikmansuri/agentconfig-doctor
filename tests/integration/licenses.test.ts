import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
]);

interface LockPackage {
  version?: string;
  license?: string;
  dev?: boolean;
}

describe('dependency licenses', () => {
  it('uses only permissive licenses for production dependencies', () => {
    const lock = JSON.parse(
      readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'),
    ) as { packages: Record<string, LockPackage> };
    const production = Object.entries(lock.packages).filter(([key, pkg]) => key !== '' && !pkg.dev);
    expect(production.length).toBeGreaterThan(0);
    const disallowed = production
      .filter(([, pkg]) => {
        const ids = (pkg.license ?? 'UNKNOWN').replace(/[()]/g, '').split(/\s+OR\s+/);
        return !ids.some((id) => ALLOWED.has(id.trim()));
      })
      .map(([key, pkg]) => `${key}: ${pkg.license ?? 'UNKNOWN'}`);
    expect(disallowed).toEqual([]);
  });
});
