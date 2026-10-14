import { describe, expect, it } from 'vitest';
import { isReportableLiteral, isSensitiveName } from '../../src/rules/acd004-env-literals.js';
import { analyze, byRule, fake, json, mcp } from '../helpers.js';

describe('ACD001 exposed credentials', () => {
  it('reports credential patterns with location, confidence and redacted evidence', () => {
    const token = fake.github();
    const findings = byRule(
      analyze({ '.mcp.json': mcp({ gh: { command: 'npx', args: ['-y', 'gh@1.0.0', token] } }) }),
      'ACD001',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'critical',
      confidence: 'high',
      evidence: 'ghp_****',
      file: '.mcp.json',
    });
    expect(findings[0]!.line).toBeTypeOf('number');
    expect(findings[0]!.column).toBeTypeOf('number');
    expect(JSON.stringify(findings)).not.toContain(token);
  });

  it('scans every supported file kind, including prose', () => {
    const secret = fake.anthropic();
    const findings = analyze({
      'CLAUDE.md': `Use key ${secret}`,
      '.cursor/rules/a.mdc': `---\nalwaysApply: true\n---\n${fake.npm()}`,
      '.claude/settings.json': json({ env: { X: fake.slack() } }),
    });
    expect(
      byRule(findings, 'ACD001')
        .map((f) => f.file)
        .sort(),
    ).toEqual(['.claude/settings.json', '.cursor/rules/a.mdc', 'CLAUDE.md']);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it('does not report variable references or placeholders', () => {
    const findings = analyze({
      '.mcp.json': mcp({
        a: { command: 'x', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
        b: {
          type: 'http',
          url: 'https://x.dev/mcp',
          headers: { Authorization: 'Bearer ${TOKEN}' },
        },
      }),
    });
    expect(byRule(findings, 'ACD001')).toEqual([]);
  });

  it('reports a credential in malformed JSON too', () => {
    const findings = analyze({ '.mcp.json': `{ "mcpServers": { "a": "${fake.npm()}" ` });
    expect(byRule(findings, 'ACD001')).toHaveLength(1);
  });

  it('produces stable fingerprints independent of line numbers', () => {
    const secret = fake.npm();
    const a = byRule(analyze({ 'CLAUDE.md': secret }), 'ACD001')[0]!;
    const b = byRule(analyze({ 'CLAUDE.md': `\n\n\n${secret}` }), 'ACD001')[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.line).not.toBe(b.line);
  });
});

describe('ACD004 hard-coded env values', () => {
  it('reports literal values under sensitive names in MCP env, headers and settings env', () => {
    const findings = byRule(
      analyze({
        '.mcp.json': mcp({
          a: { command: 'x', env: { API_KEY: 'literal-value-123456' } },
          b: {
            type: 'http',
            url: 'https://x.dev',
            headers: { 'X-Api-Key': 'literal-value-123456' },
          },
        }),
        '.claude/settings.json': json({ env: { DB_PASSWORD: 'hunter2hunter2' } }),
      }),
      'ACD004',
    );
    expect(findings.map((f) => f.message)).toEqual([
      'Settings "env" sets variable "DB_PASSWORD" to a literal value instead of a variable reference.',
      'MCP server "a" sets variable "API_KEY" to a literal value instead of a variable reference.',
      'MCP server "b" sets header "X-Api-Key" to a literal value instead of a variable reference.',
    ]);
    for (const f of findings) {
      expect(f.evidence).toMatch(/= \*\*\*\* \(\d+ chars\)$/);
      expect(f.evidence).not.toContain('literal-value');
      expect(f.evidence).not.toContain('hunter2');
    }
  });

  it('does not flag references, placeholders, short values or ordinary variables', () => {
    const findings = analyze({
      '.mcp.json': mcp({
        a: {
          command: 'x',
          env: {
            API_KEY: '${API_KEY}',
            TOKEN: '${env:TOKEN}',
            SECRET: '${input:secret}',
            PASSWORD: '<your password>',
            AUTH: 'true',
            CLIENT_SECRET: 'short',
            LOG_LEVEL: 'debug-verbose-mode',
            NODE_ENV: 'production',
            PWD: '/home/someone/project',
            SIGNING_KEY_FILE: '/run/secrets/key',
            SSH_KEY_PATH: '/home/someone/.ssh/id_ed25519',
          },
        },
      }),
    });
    expect(byRule(findings, 'ACD004')).toEqual([]);
  });

  it('defers known credential formats to ACD001 instead of double-reporting', () => {
    const findings = analyze({
      '.mcp.json': mcp({
        a: { command: 'x', env: { GITHUB_TOKEN: fake.github() } },
        b: {
          type: 'http',
          url: 'https://x.dev',
          headers: { Authorization: 'Bearer Zq8Ww2Lk5Pp7Rt3Yu1Io9As4' },
        },
      }),
    });
    expect(byRule(findings, 'ACD004')).toEqual([]);
    expect(byRule(findings, 'ACD001')).toHaveLength(2);
  });

  it('classifies names and literals', () => {
    expect(isSensitiveName('OPENAI_API_KEY')).toBe(true);
    expect(isSensitiveName('db-password')).toBe(true);
    expect(isSensitiveName('MONKEY')).toBe(false);
    expect(isSensitiveName('KEYBOARD_LAYOUT')).toBe(false);
    expect(isSensitiveName('Authorization', true)).toBe(true);
    expect(isSensitiveName('Content-Type', true)).toBe(false);
    expect(isReportableLiteral('12345678')).toBe(false);
    expect(isReportableLiteral('abcdefgh1')).toBe(true);
  });
});
