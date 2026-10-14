import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BaselineError,
  compareWithBaseline,
  createBaseline,
  parseBaseline,
  readBaseline,
  serializeBaseline,
  writeBaseline,
} from '../../src/baseline/baseline.js';
import { snapshotPermissions } from '../../src/baseline/snapshot.js';
import { analyzeDocuments } from '../../src/engine/scan.js';
import { byRule, docsFrom, fake, json, makeTree, mcp } from '../helpers.js';

const settingsV1 = {
  permissions: {
    allow: ['Bash(npm test)'],
    ask: ['Bash(git push *)'],
    deny: ['Read(./.env)'],
    defaultMode: 'default',
    additionalDirectories: [],
  },
  enabledMcpjsonServers: ['gh'],
  disabledMcpjsonServers: ['old'],
  sandbox: { enabled: true },
  hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'npm run format' }] }] },
};
const mcpV1 = mcp({ gh: { command: 'npx', args: ['gh@1'] }, gone: { command: 'x' } });

const stateOf = (files: Record<string, string>) => analyzeDocuments(docsFrom(files));

describe('permission snapshot', () => {
  it('captures permission state without secret values', () => {
    const token = fake.github();
    const snap = snapshotPermissions(
      docsFrom({
        '.claude/settings.json': json({
          ...settingsV1,
          permissions: { ...settingsV1.permissions, allow: [`Bash(curl -H ${token})`] },
        }),
        '.mcp.json': mcp({ gh: { command: 'npx', args: [token], env: { GITHUB_TOKEN: token } } }),
      }),
    );
    expect(JSON.stringify(snap)).not.toContain(token);
    expect(snap.settings['.claude/settings.json']).toMatchObject({
      allow: ['Bash(curl -H ghp_****)'],
      defaultMode: 'default',
      sandboxEnabled: true,
    });
    expect(Object.keys(snap.mcpServers['.mcp.json']!)).toEqual(['gh']);
  });

  it('is deterministic', () => {
    const files = { '.claude/settings.json': json(settingsV1), '.mcp.json': mcpV1 };
    expect(JSON.stringify(snapshotPermissions(docsFrom(files)))).toBe(
      JSON.stringify(snapshotPermissions(docsFrom(files))),
    );
  });
});

describe('baseline files', () => {
  it('round-trips through serialisation and excludes ACD009 findings', () => {
    const state = stateOf({ 'CLAUDE.md': fake.npm() });
    const baseline = createBaseline(
      [...state.findings, { ...state.findings[0]!, ruleId: 'ACD009', fingerprint: 'f'.repeat(16) }],
      state.permissions,
    );
    expect(baseline.findings.map((f) => f.ruleId)).toEqual(['ACD001']);
    expect(parseBaseline(serializeBaseline(baseline))).toEqual(baseline);
    expect(serializeBaseline(baseline)).not.toContain('npm_');
  });

  it('rejects invalid, newer-version and malformed baselines', () => {
    expect(() => parseBaseline('not json')).toThrow(BaselineError);
    expect(() => parseBaseline('{"schemaVersion": 99}')).toThrow(/newer than this tool supports/);
    expect(() => parseBaseline('{"schemaVersion": 1}')).toThrow(
      /not a valid agentconfig-doctor baseline/,
    );
    const valid = JSON.parse(
      serializeBaseline(createBaseline([], snapshotPermissions([]))),
    ) as Record<string, unknown>;
    for (const broken of [
      { ...valid, findings: [{ fingerprint: 'zz' }] },
      { ...valid, extra: true },
      { ...valid, tool: 'other' },
    ]) {
      expect(() => parseBaseline(JSON.stringify(broken))).toThrow(BaselineError);
    }
  });

  it('refuses to overwrite on create and to create on update', async () => {
    const dir = await makeTree({});
    const file = path.join(dir, 'b.json');
    const baseline = createBaseline([], snapshotPermissions([]));
    await expect(writeBaseline(file, baseline, 'update')).rejects.toThrow(/does not exist/);
    await writeBaseline(file, baseline, 'create');
    await expect(writeBaseline(file, baseline, 'create')).rejects.toThrow(/already exists/);
    await writeBaseline(file, baseline, 'update');
    expect(await readBaseline(file)).toEqual(baseline);
    await expect(readBaseline(path.join(dir, 'missing.json'))).rejects.toThrow(
      /Cannot read baseline/,
    );
  });

  it('rejects an oversized baseline file', async () => {
    const dir = await makeTree({});
    const file = path.join(dir, 'big.json');
    await writeFile(file, ' '.repeat(10 * 1024 * 1024 + 1));
    await expect(readBaseline(file)).rejects.toThrow(/larger than/);
  });
});

describe('baseline comparison', () => {
  it('classifies new, existing and resolved findings (partial match)', () => {
    const before = stateOf({ 'CLAUDE.md': `${fake.npm()} ${fake.github()}` });
    const baseline = createBaseline(before.findings, before.permissions);
    const after = stateOf({ 'CLAUDE.md': `${fake.npm()} ${fake.slack()}` });
    const cmp = compareWithBaseline(after.findings, baseline);
    expect(cmp.existingFindings.map((f) => f.evidence)).toEqual(['npm_****']);
    expect(cmp.newFindings.map((f) => f.evidence)).toEqual(['xoxb-****']);
    expect(cmp.resolved.map((r) => r.ruleId)).toEqual(['ACD001']);
  });

  it('treats a stale baseline for files that no longer exist as resolved', () => {
    const before = stateOf({ 'old/CLAUDE.md': fake.npm() });
    const cmp = compareWithBaseline([], createBaseline(before.findings, before.permissions));
    expect(cmp.resolved).toHaveLength(1);
    expect(cmp.newFindings).toEqual([]);
  });
});

describe('ACD009 permission changes', () => {
  const baselineFor = (files: Record<string, string>) => stateOf(files).permissions;

  it('reports nothing without a baseline or without changes', () => {
    const files = { '.claude/settings.json': json(settingsV1), '.mcp.json': mcpV1 };
    expect(byRule(stateOf(files).findings, 'ACD009')).toEqual([]);
    const same = analyzeDocuments(docsFrom(files), { baselinePermissions: baselineFor(files) });
    expect(byRule(same.findings, 'ACD009')).toEqual([]);
  });

  it('explains loosening and tightening changes', () => {
    const baselinePermissions = baselineFor({
      '.claude/settings.json': json(settingsV1),
      '.mcp.json': mcpV1,
    });
    const changed = {
      permissions: {
        allow: ['Bash(npm test)', 'Bash(rm *)'],
        ask: [],
        deny: ['Read(./.env)', 'Read(./secrets/**)'],
        defaultMode: 'acceptEdits',
        additionalDirectories: ['../other'],
      },
      enableAllProjectMcpServers: true,
      enabledMcpjsonServers: ['gh', 'new'],
      disabledMcpjsonServers: [],
      sandbox: { enabled: false },
      hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'npm run lint' }] }] },
    };
    const result = analyzeDocuments(
      docsFrom({
        '.claude/settings.json': json(changed),
        '.mcp.json': mcp({ gh: { command: 'npx', args: ['gh@2'] }, added: { command: 'y' } }),
      }),
      { baselinePermissions },
    );
    const findings = byRule(result.findings, 'ACD009');
    expect(findings.map((f) => `${f.severity}: ${f.message}`).sort()).toEqual(
      [
        'high: enableAllProjectMcpServers was turned on: every project MCP server now starts without approval.',
        'medium: Allow rule "Bash(rm *)" was added: matching actions now run without a prompt.',
        'low: Ask rule "Bash(git push *)" was removed: matching actions may no longer prompt.',
        'info: Deny rule "Read(./secrets/**)" was added.',
        'medium: Additional directory "../other" was added: the agent can now access it.',
        'medium: Approved project MCP server "new" was added to enabledMcpjsonServers.',
        'medium: Rejected project MCP server "old" was removed from disabledMcpjsonServers and may now be started.',
        'medium: permissions.defaultMode changed from default to acceptEdits.',
        'medium: The Bash sandbox is no longer enabled.',
        'medium: A new or changed PostToolUse hook command was added; hooks run automatically.',
        'info: A PostToolUse hook command was removed or changed.',
        'medium: MCP server "added" was added since the baseline.',
        'medium: MCP server "gh" changed its command, arguments, URL or variable names since the baseline.',
        'info: MCP server "gone" was removed since the baseline.',
      ].sort(),
    );
    expect(findings.find((f) => f.message.includes('"Bash(rm *)"'))?.line).toBeDefined();
  });

  it('reports removed deny rules when a settings file is deleted', () => {
    const baselinePermissions = baselineFor({ '.claude/settings.json': json(settingsV1) });
    const findings = byRule(analyzeDocuments([], { baselinePermissions }).findings, 'ACD009');
    expect(findings.map((f) => f.message)).toContain(
      'Deny rule "Read(./.env)" was removed: matching actions are no longer blocked (settings file no longer present).',
    );
  });

  it('does not store secret values in the baseline file', async () => {
    const token = fake.github();
    const dir = await makeTree({});
    const file = path.join(dir, 'b.json');
    const state = stateOf({
      '.claude/settings.json': json({ permissions: { allow: [`Bash(echo ${token})`] } }),
    });
    await writeBaseline(file, createBaseline(state.findings, state.permissions), 'create');
    expect(await readFile(file, 'utf8')).not.toContain(token);
  });
});
