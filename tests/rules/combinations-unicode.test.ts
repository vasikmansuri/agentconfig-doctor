import { describe, expect, it } from 'vitest';
import { isUnrestrictedShellRule } from '../../src/rules/acd010-risky-combinations.js';
import { analyze, byRule, json, mcp } from '../helpers.js';

describe('ACD010 risky combinations', () => {
  it('flags auto-approval of project MCP servers when local servers exist', () => {
    const findings = byRule(
      analyze({
        '.claude/settings.json': json({ enableAllProjectMcpServers: true }),
        '.mcp.json': mcp({
          a: { command: 'node', args: ['s.js'] },
          r: { type: 'http', url: 'https://x.dev' },
        }),
      }),
      'ACD010',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'high', line: 2 });
    expect(findings[0]!.message).toContain('defines 1 local server(s) ("a")');
  });

  it('reports a lower severity when no local servers are defined yet', () => {
    const findings = byRule(
      analyze({ '.claude/settings.json': json({ enableAllProjectMcpServers: true }) }),
      'ACD010',
    );
    expect(findings[0]?.severity).toBe('medium');
  });

  it('matches the .mcp.json of the same project in a monorepo', () => {
    const findings = byRule(
      analyze({
        'apps/web/.claude/settings.json': json({ enableAllProjectMcpServers: true }),
        'apps/web/.mcp.json': mcp({ a: { command: 'x' } }),
        '.mcp.json': mcp({ b: { command: 'y' }, c: { command: 'z' } }),
      }),
      'ACD010',
    );
    expect(findings[0]!.message).toContain('apps/web/.mcp.json defines 1 local server(s)');
  });

  it('flags unrestricted shell approval without a sandbox', () => {
    for (const rule of ['Bash', 'Bash(*)', 'Bash(:*)', 'PowerShell']) {
      const findings = byRule(
        analyze({ '.claude/settings.json': json({ permissions: { allow: [rule] } }) }),
        'ACD010',
      );
      expect(findings, rule).toHaveLength(1);
    }
  });

  it('does not flag unrestricted shell approval when the project sandbox is enabled', () => {
    const findings = analyze({
      '.claude/settings.json': json({ permissions: { allow: ['Bash'] } }),
      '.claude/settings.local.json': json({ sandbox: { enabled: true } }),
    });
    expect(byRule(findings, 'ACD010')).toEqual([]);
  });

  it('does not flag specific rules or disabled auto-approval', () => {
    const findings = analyze({
      '.claude/settings.json': json({
        enableAllProjectMcpServers: false,
        permissions: { allow: ['Bash(npm test)', 'Bash(git status *)'] },
      }),
      '.mcp.json': mcp({ a: { command: 'x' } }),
    });
    expect(byRule(findings, 'ACD010')).toEqual([]);
    expect(isUnrestrictedShellRule('Bash(npm *)')).toBe(false);
    expect(isUnrestrictedShellRule('Read')).toBe(false);
  });
});

describe('ACD011 hidden Unicode', () => {
  it('reports bidi controls, tag characters and zero-width characters', () => {
    const findings = byRule(
      analyze({
        'CLAUDE.md': 'safe text \u202eevil\u202c and more',
        '.cursor/rules/a.mdc': `---\nalwaysApply: true\n---\nhidden${String.fromCodePoint(0xe0041, 0xe0042)}`,
        'AGENTS.md': 'zero\u200bwidth',
      }),
      'ACD011',
    );
    expect(findings.map((f) => [f.file, f.severity, f.evidence])).toEqual([
      ['.cursor/rules/a.mdc', 'high', 'U+E0041, U+E0042'],
      ['CLAUDE.md', 'high', 'U+202C, U+202E'],
      ['AGENTS.md', 'medium', 'U+200B'],
    ]);
    expect(findings.find((f) => f.file === 'CLAUDE.md')).toMatchObject({ line: 1, column: 11 });
  });

  it('ignores a leading BOM, emoji joiners and ordinary non-ASCII text', () => {
    const findings = analyze({
      'CLAUDE.md': '\ufeff# Notes 👩\u200d💻 — café, 日本語, مرحبا',
      '.mcp.json': '\ufeff{"mcpServers": {}}',
    });
    expect(byRule(findings, 'ACD011')).toEqual([]);
  });
});
