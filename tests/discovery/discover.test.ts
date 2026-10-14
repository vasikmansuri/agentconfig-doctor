import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyPath } from '../../src/discovery/classify.js';
import {
  discover,
  InputError,
  isWithin,
  readDiscoveredFile,
} from '../../src/discovery/discover.js';
import { makeTree } from '../helpers.js';

const isWindows = process.platform === 'win32';

describe('classifyPath', () => {
  it.each([
    ['.mcp.json', 'claude-mcp'],
    ['packages/api/.mcp.json', 'claude-mcp'],
    ['.cursor/mcp.json', 'cursor-mcp'],
    ['.vscode/mcp.json', 'vscode-mcp'],
    ['.claude/settings.json', 'claude-settings'],
    ['.claude/settings.local.json', 'claude-settings'],
    ['.cursor/rules/style.mdc', 'cursor-rule'],
    ['.cursor/rules/nested/style.mdc', 'cursor-rule'],
    ['.cursor/rules/readme.md', 'cursor-rule'],
    ['CLAUDE.md', 'instructions'],
    ['CLAUDE.local.md', 'instructions'],
    ['docs/AGENTS.md', 'instructions'],
    ['.cursorrules', 'instructions'],
  ])('%s -> %s', (p, kind) => {
    expect(classifyPath(p)).toBe(kind);
  });

  it.each([
    'mcp.json',
    'package.json',
    '.vscode/settings.json',
    'settings.json',
    '.claude/other.json',
    '.cursor/rules',
    'rules/a.mdc',
    '.cursor/rules/a.txt',
    'claude.md',
    '',
  ])('ignores %s', (p) => {
    expect(classifyPath(p)).toBeUndefined();
  });
});

describe('discover', () => {
  it('finds supported files deterministically and skips ignored directories', async () => {
    const root = await makeTree({
      '.mcp.json': '{}',
      'b/.cursor/mcp.json': '{}',
      'a/.claude/settings.json': '{}',
      'node_modules/pkg/.mcp.json': '{}',
      'dist/.mcp.json': '{}',
      '.git/.mcp.json': '{}',
      'package.json': '{}',
      'random.json': '{}',
    });
    const result = await discover(root);
    expect(result.files.map((f) => f.path)).toEqual([
      '.mcp.json',
      'a/.claude/settings.json',
      'b/.cursor/mcp.json',
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('applies include and exclude globs', async () => {
    const root = await makeTree({
      '.mcp.json': '{}',
      'examples/.mcp.json': '{}',
      'examples/x/.cursor/mcp.json': '{}',
      'CLAUDE.md': '#',
    });
    const excluded = await discover(root, { exclude: ['examples'] });
    expect(excluded.files.map((f) => f.path)).toEqual(['.mcp.json', 'CLAUDE.md']);
    const included = await discover(root, { include: ['**/.cursor/**'] });
    expect(included.files.map((f) => f.path)).toEqual(['examples/x/.cursor/mcp.json']);
  });

  it('skips files larger than the size limit with a reason', async () => {
    const root = await makeTree({ '.mcp.json': `{"x":"${'a'.repeat(2000)}"}` });
    const result = await discover(root, { maxFileSize: 100 });
    expect(result.files).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ path: '.mcp.json' });
    expect(result.skipped[0]!.reason).toMatch(/larger than the 100-byte limit/);
  });

  it('stops at the entry limit and reports truncation', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`d${i}/CLAUDE.md`, '#']),
    );
    const result = await discover(await makeTree(files), { maxEntries: 5 });
    expect(result.truncated).toBe(true);
    expect(result.skipped.some((s) => /stopped after visiting 5 entries/.test(s.reason))).toBe(
      true,
    );
  });

  it.skipIf(isWindows)('handles paths with spaces, unicode and control characters', async () => {
    const names = ['my project/.mcp.json', 'проект/.mcp.json', 'evil\nname/.mcp.json'];
    const root = await makeTree(Object.fromEntries(names.map((n) => [n, '{}'])));
    const result = await discover(root);
    expect(result.files.map((f) => f.path).sort()).toEqual([...names].sort());
  });

  it('scans a single supported file', async () => {
    const root = await makeTree({ '.cursor/mcp.json': '{}' });
    const result = await discover(path.join(root, '.cursor/mcp.json'));
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.kind).toBe('cursor-mcp');
  });

  it('skips a single file over the size limit', async () => {
    const root = await makeTree({ '.mcp.json': 'x'.repeat(200) });
    const result = await discover(path.join(root, '.mcp.json'), { maxFileSize: 10 });
    expect(result.files).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('rejects unsupported single files and missing paths', async () => {
    const root = await makeTree({ 'package.json': '{}' });
    await expect(discover(path.join(root, 'package.json'))).rejects.toBeInstanceOf(InputError);
    await expect(discover(path.join(root, 'missing'))).rejects.toThrow(/Cannot access/);
  });

  it.skipIf(isWindows)('does not follow symlinks outside the scan root', async () => {
    const outside = await makeTree({ '.mcp.json': '{"secret": true}', 'dir/CLAUDE.md': '#' });
    const root = await makeTree({ 'CLAUDE.md': '#' });
    await symlink(path.join(outside, '.mcp.json'), path.join(root, '.mcp.json'));
    await symlink(path.join(outside, 'dir'), path.join(root, 'linked-dir'));
    const result = await discover(root);
    expect(result.files.map((f) => f.path)).toEqual(['CLAUDE.md']);
    expect(result.skipped).toEqual([
      { path: '.mcp.json', reason: 'symlink points outside the scan root (not followed)' },
      { path: 'linked-dir', reason: 'symlink points outside the scan root (not followed)' },
    ]);
  });

  it.skipIf(isWindows)(
    'follows file symlinks inside the root but not directory symlinks',
    async () => {
      const root = await makeTree({ 'real/.mcp.json': '{}', 'sub/CLAUDE.md': '#' });
      await symlink(path.join(root, 'real/.mcp.json'), path.join(root, '.mcp.json'));
      await symlink(path.join(root, 'sub'), path.join(root, 'loop'));
      const result = await discover(root);
      expect(result.files.map((f) => f.path)).toEqual([
        '.mcp.json',
        'real/.mcp.json',
        'sub/CLAUDE.md',
      ]);
      expect(result.skipped).toEqual([
        { path: 'loop', reason: 'symlinked directory not followed' },
      ]);
    },
  );

  it.skipIf(isWindows)('reports broken symlinks for supported names', async () => {
    const root = await makeTree({});
    await symlink(path.join(root, 'nowhere'), path.join(root, '.mcp.json'));
    const result = await discover(root);
    expect(result.skipped).toEqual([{ path: '.mcp.json', reason: 'broken symlink' }]);
  });

  it.skipIf(isWindows || process.getuid?.() === 0)('reports unreadable directories', async () => {
    const root = await makeTree({ 'locked/CLAUDE.md': '#', 'CLAUDE.md': '#' });
    await chmod(path.join(root, 'locked'), 0o000);
    try {
      const result = await discover(root);
      expect(result.files.map((f) => f.path)).toEqual(['CLAUDE.md']);
      expect(result.skipped[0]!.reason).toMatch(/directory unreadable/);
    } finally {
      await chmod(path.join(root, 'locked'), 0o755);
    }
  });
});

describe('readDiscoveredFile', () => {
  const fileIn = (root: string, rel: string) => ({
    path: rel,
    absolutePath: path.join(root, rel),
    kind: 'claude-mcp' as const,
  });

  it('rejects binary content', async () => {
    const root = await makeTree({ '.mcp.json': Buffer.from([0x7b, 0x00, 0x7d]) });
    expect(await readDiscoveredFile(root, fileIn(root, '.mcp.json'))).toEqual({
      ok: false,
      reason: 'binary content (NUL bytes); not a text config',
    });
  });

  it('re-checks the size limit at read time', async () => {
    const root = await makeTree({ '.mcp.json': '{}' });
    await writeFile(path.join(root, '.mcp.json'), 'x'.repeat(500));
    const result = await readDiscoveredFile(root, fileIn(root, '.mcp.json'), 100);
    expect(result.ok).toBe(false);
  });

  it.skipIf(isWindows)(
    'refuses a file swapped for an outside symlink after discovery',
    async () => {
      const outside = await makeTree({ 'secret.json': '{}' });
      const root = await makeTree({});
      await mkdir(path.join(root, 'x'));
      await symlink(path.join(outside, 'secret.json'), path.join(root, 'x/.mcp.json'));
      expect(await readDiscoveredFile(root, fileIn(root, 'x/.mcp.json'))).toEqual({
        ok: false,
        reason: 'symlink points outside the scan root (not followed)',
      });
    },
  );

  it('reports missing files as unreadable', async () => {
    const root = await makeTree({});
    expect(await readDiscoveredFile(root, fileIn(root, '.mcp.json'))).toEqual({
      ok: false,
      reason: 'unreadable (ENOENT)',
    });
  });
});

describe('isWithin', () => {
  it('handles traversal and look-alike prefixes', () => {
    const root = path.resolve('/a/b');
    expect(isWithin(root, path.resolve('/a/b/c'))).toBe(true);
    expect(isWithin(root, root)).toBe(true);
    expect(isWithin(root, path.resolve('/a/b/../c'))).toBe(false);
    expect(isWithin(root, path.resolve('/a/bc'))).toBe(false);
    expect(isWithin(root, path.resolve('/a/b/..c'))).toBe(true);
  });
});
