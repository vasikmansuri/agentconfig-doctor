import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/engine/config.js';
import {
  hostMatches,
  isPinnedPackage,
  runnerPackage,
} from '../../src/rules/acd006-suspicious-servers.js';
import { classifyBroadPath, normalisePath } from '../../src/rules/paths.js';
import { analyze, byRule, json, mcp } from '../helpers.js';

describe('path classification', () => {
  it.each([
    ['/', 'root'],
    ['C:\\', 'root'],
    ['/**', 'root'],
    ['~', 'home'],
    ['$HOME', 'home'],
    ['${userHome}', 'home'],
    ['%USERPROFILE%', 'home'],
    ['/Users/alice', 'home'],
    ['/home/bob/', 'home'],
    ['/Users', 'home'],
    ['~/.ssh', 'sensitive'],
    ['~/.aws/credentials', 'sensitive'],
    ['/home/bob/.kube/config', 'sensitive'],
    ['/var/run/docker.sock', 'sensitive'],
    ['/etc', 'system'],
    ['~/projects/app', undefined],
    ['/Users/alice/src/app', undefined],
    ['./data', undefined],
    ['relative/path', undefined],
    ['/tmp/x', undefined],
  ])('%s -> %s', (raw, breadth) => {
    expect(classifyBroadPath(raw)?.breadth).toBe(breadth);
  });

  it('normalises variants to a comparable form', () => {
    expect(normalisePath('${HOME}/.ssh/**')).toBe('~/.ssh');
    expect(normalisePath('"/Users/a/"')).toBe('~');
    expect(normalisePath('npx')).toBeUndefined();
  });
});

describe('ACD003 broad filesystem access', () => {
  it('flags broad MCP arguments, docker mounts and Claude settings', () => {
    const findings = byRule(
      analyze({
        '.mcp.json': mcp({
          fs: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem@1.0.0', '/', '--allow=~/.aws'],
          },
          box: {
            command: 'docker',
            args: [
              'run',
              '-v',
              '/:/host',
              '--mount',
              'type=bind,source=/Users/me,target=/w',
              'img:1',
            ],
          },
        }),
        '.claude/settings.json': json({
          permissions: {
            additionalDirectories: ['~/', '../sibling'],
            allow: [
              'Read(//**)',
              'Edit(~/.ssh/**)',
              'Read(/src/**)',
              'Read(./docs/**)',
              'Bash(ls)',
            ],
          },
          sandbox: { filesystem: { allowWrite: ['//etc'] } },
        }),
      }),
      'ACD003',
    );
    expect(findings.map((f) => f.message).sort()).toEqual(
      [
        'MCP server "fs" argument grants access to the entire filesystem (/).',
        'MCP server "fs" argument grants access to credential location ~/.aws (~/.aws).',
        'MCP server "box" container mount grants access to the entire filesystem (/).',
        'MCP server "box" container mount grants access to a whole home directory (~).',
        'permissions.additionalDirectories grants access to a whole home directory (~).',
        'Permission allow rule Read(//**) grants access to the entire filesystem (/).',
        'Permission allow rule Edit(~/.ssh/**) grants access to credential location ~/.ssh (~/.ssh).',
        'sandbox.filesystem.allowWrite grants access to system directory /etc (/etc).',
      ].sort(),
    );
    expect(findings.every((f) => f.line !== undefined)).toBe(true);
  });

  it('does not flag project-scoped paths', () => {
    const findings = analyze({
      '.mcp.json': mcp({
        fs: { command: 'npx', args: ['-y', 'fs-server@1.0.0', './data', '/tmp/cache'] },
      }),
      '.claude/settings.json': json({
        permissions: { additionalDirectories: ['../shared'], allow: ['Read(/src/**)'] },
      }),
    });
    expect(byRule(findings, 'ACD003')).toEqual([]);
  });

  it('respects configured allowedPaths exceptions', () => {
    const files = { '.mcp.json': mcp({ fs: { command: 'node', args: ['s.js', '/Users/me'] } }) };
    expect(byRule(analyze(files), 'ACD003')).toHaveLength(1);
    const config = { ...DEFAULT_CONFIG, allowedPaths: ['~'] };
    expect(byRule(analyze(files, { config }), 'ACD003')).toEqual([]);
  });

  it('handles Windows-style mount sources', () => {
    const findings = analyze({
      '.mcp.json': mcp({
        box: { command: 'podman', args: ['run', '--volume=C:\\:/host', 'img:1'] },
      }),
    });
    expect(byRule(findings, 'ACD003')[0]?.message).toContain('entire filesystem');
  });
});

describe('ACD006 suspicious servers', () => {
  it('flags plaintext, IP-literal and non-allowed remote endpoints', () => {
    const files = {
      '.mcp.json': mcp({
        plain: { type: 'http', url: 'http://mcp.vendor.dev/mcp' },
        ip: { type: 'sse', url: 'https://198.51.100.7/sse' },
        local: { type: 'http', url: 'http://localhost:3000/mcp' },
        lan: { type: 'http', url: 'https://192.168.1.10/mcp' },
        templated: { type: 'http', url: '${BASE_URL}/mcp' },
      }),
    };
    expect(byRule(analyze(files), 'ACD006').map((f) => f.message)).toEqual([
      'MCP server "plain" connects to a non-local endpoint over unencrypted http.',
      'MCP server "ip" uses a public IP address instead of a host name.',
    ]);
    const config = { ...DEFAULT_CONFIG, allowedHosts: ['*.vendor.dev'] };
    const withPolicy = byRule(analyze(files, { config }), 'ACD006').map((f) => f.message);
    expect(withPolicy).toContain(
      'MCP server "ip" connects to "198.51.100.7", which is not in the configured allowedHosts list.',
    );
    expect(withPolicy).toContain(
      'MCP server "lan" connects to "192.168.1.10", which is not in the configured allowedHosts list.',
    );
    expect(withPolicy.join('\n')).not.toContain('"plain" connects to "mcp.vendor.dev"');
  });

  it('flags unpinned packages, temp executables, container flags and env tampering', () => {
    const findings = byRule(
      analyze({
        '.mcp.json': mcp({
          a: { command: 'npx', args: ['-y', '@scope/server'] },
          b: { command: 'uvx', args: ['mcp-server-x'] },
          c: { command: 'pnpm', args: ['dlx', 'srv@latest'] },
          d: { command: '/tmp/downloaded-server', args: [] },
          e: {
            command: 'docker',
            args: ['run', '--privileged', '--network=host', '--cap-add', 'SYS_ADMIN', 'img:1'],
          },
          f: {
            command: 'node',
            args: ['s.js'],
            env: { NODE_TLS_REJECT_UNAUTHORIZED: '0', LD_PRELOAD: '/tmp/x.so' },
          },
        }),
      }),
      'ACD006',
    );
    expect(findings).toHaveLength(9);
    expect(findings.filter((f) => f.severity === 'low')).toHaveLength(3);
    expect(findings.some((f) => f.message.includes('--privileged') && f.severity === 'high')).toBe(
      true,
    );
    expect(findings.some((f) => f.message.includes('LD_PRELOAD') && f.severity === 'high')).toBe(
      true,
    );
  });

  it('accepts pinned packages and ordinary local servers', () => {
    const findings = analyze({
      '.mcp.json': mcp({
        a: { command: 'npx', args: ['-y', '@scope/server@1.2.3'] },
        b: { command: 'uvx', args: ['mcp-server-x==0.4.1'] },
        c: { command: 'uvx', args: ['--from', 'pkg==1.0', 'tool'] },
        d: { command: 'npx', args: ['./local-server'] },
        e: { command: 'node', args: ['server.js'], env: { NODE_ENV: 'production' } },
        f: { type: 'http', url: 'https://mcp.vendor.dev/mcp' },
      }),
    });
    expect(byRule(findings, 'ACD006')).toEqual([]);
  });

  it('parses runner package specs and host patterns', () => {
    expect(runnerPackage('npx', ['-y', 'a@1'])).toBe('a@1');
    expect(runnerPackage('npx.cmd', ['--package=b', 'bin'])).toBe('b');
    expect(runnerPackage('bun', ['x', 'c'])).toBe('c');
    expect(runnerPackage('pnpm', ['install'])).toBeUndefined();
    expect(runnerPackage('node', ['x'])).toBeUndefined();
    expect(isPinnedPackage('@scope/name')).toBe(false);
    expect(isPinnedPackage('@scope/name@2.0.0')).toBe(true);
    expect(isPinnedPackage('name@next')).toBe(false);
    expect(isPinnedPackage('name==')).toBe(false);
    expect(hostMatches('api.vendor.dev', '*.vendor.dev')).toBe(true);
    expect(hostMatches('vendor.dev.evil.io', '*.vendor.dev')).toBe(false);
  });
});
