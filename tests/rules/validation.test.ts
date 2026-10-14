import { describe, expect, it } from 'vitest';
import { analyze, byRule, json, mcp } from '../helpers.js';

const messages = (files: Record<string, string>, rule: string) =>
  byRule(analyze(files), rule).map((f) => f.message);

describe('ACD005 invalid MCP configuration', () => {
  it('accepts valid stdio and remote servers in every MCP format', () => {
    const findings = analyze({
      '.mcp.json': mcp({
        a: { type: 'stdio', command: 'npx', args: ['-y', 'a@1.0.0'], env: { X: '1' } },
        b: { type: 'http', url: 'https://x.dev/mcp', headers: { A: 'b' } },
        c: { type: 'ws', url: 'wss://x.dev/ws' },
        d: { type: 'streamable-http', url: 'https://x.dev/mcp' },
      }),
      '.cursor/mcp.json': mcp({
        e: { command: 'node', args: ['s.js'], envFile: '.env' },
        f: { url: 'https://x.dev/sse' },
      }),
      '.vscode/mcp.json':
        '{\n // comment\n "inputs": [{"type":"promptString","id":"tok","password":true}],\n "servers": {"g": {"type":"http","url":"https://x.dev","headers":{"A":"Bearer ${input:tok}"}}, "h": {"command":"node","env":{"N":1,"M":null}}},\n}',
    });
    expect(byRule(findings, 'ACD005')).toEqual([]);
  });

  it('reports JSON syntax errors with positions', () => {
    const findings = byRule(analyze({ '.mcp.json': '{\n  "mcpServers": {,}\n}' }), 'ACD005');
    expect(findings[0]).toMatchObject({ severity: 'medium', line: 2 });
    expect(findings[0]!.message).toMatch(/^Invalid JSON/);
  });

  it('reports structural problems', () => {
    expect(messages({ '.mcp.json': '[]' }, 'ACD005')).toEqual([
      'Top-level value must be an object, got an array.',
    ]);
    expect(messages({ '.mcp.json': json({ servers: {} }) }, 'ACD005')[0]).toMatch(
      /uses "servers", which is the VS Code key/,
    );
    expect(messages({ '.vscode/mcp.json': json({ mcpServers: {} }) }, 'ACD005')[0]).toMatch(
      /expects "servers"/,
    );
    expect(messages({ '.mcp.json': json({ mcpServers: [] }) }, 'ACD005')[0]).toMatch(
      /must be an object mapping/,
    );
    expect(messages({ '.mcp.json': mcp({ a: 'npx x' }) }, 'ACD005')).toEqual([
      'Server "a" must be an object, got a string.',
    ]);
  });

  it('reports field type errors from the schema', () => {
    const m = messages(
      { '.mcp.json': mcp({ a: { command: 'x', args: ['ok', 3], env: { A: true } } }) },
      'ACD005',
    );
    expect(m).toEqual([
      'Server "a": field "args[1]" is invalid (Invalid input: expected string, received number).',
      'Server "a": field "env.A" is invalid (Invalid input: expected string, received boolean).',
    ]);
  });

  it('reports conflicting and incomplete definitions', () => {
    const m = messages(
      {
        '.mcp.json': mcp({
          both: { command: 'x', url: 'https://x.dev' },
          none: { args: ['x'] },
          badType: { type: 'grpc', command: 'x' },
          noType: { url: 'https://x.dev' },
          stdioUrl: { type: 'stdio', url: 'https://x.dev' },
          emptyCmd: { command: '  ' },
          argsInCmd: { command: 'npx -y server' },
          remoteNoUrl: { type: 'http', headers: {} },
          remoteCmd: { type: 'sse', command: 'x' },
          badUrl: { type: 'http', url: 'not a url' },
          scheme: { type: 'http', url: 'ftp://x.dev' },
          wsScheme: { type: 'ws', url: 'https://x.dev' },
          remoteExtras: { type: 'http', url: 'https://x.dev', env: {}, args: [], envFile: '.env' },
          '': { command: 'x' },
        }),
      },
      'ACD005',
    );
    for (const expected of [
      'Server "both" defines both "command" and "url"',
      'Server "none" has neither "command" (local) nor "url" (remote).',
      'Server "badType" has unsupported type "grpc"',
      'Server "noType" has a "url" but no "type"',
      'Server "stdioUrl" is type "stdio" but defines "url"',
      'Server "emptyCmd" has an empty "command".',
      'Server "argsInCmd" puts arguments inside "command"',
      'Server "remoteNoUrl" is a remote (http) server but has no "url".',
      'Server "remoteCmd" is a remote (sse) server but defines "command".',
      'Server "badUrl" has an invalid URL.',
      'Server "scheme" uses URL scheme "ftp:"',
      'Server "wsScheme" uses URL scheme "https:"',
      'Server "remoteExtras" sets "envFile"',
      'Server "remoteExtras" is remote but sets "args"',
      'Server "remoteExtras" is remote but sets "env"',
      'Server name is empty.',
    ]) {
      expect(
        m.some((x) => x.startsWith(expected)),
        expected,
      ).toBe(true);
    }
  });

  it('does not require "type" for remote servers in Cursor', () => {
    const findings = analyze({ '.cursor/mcp.json': mcp({ r: { url: 'https://x.dev/mcp' } }) });
    expect(byRule(findings, 'ACD005')).toEqual([]);
  });

  it('validates VS Code inputs and ${input:...} references', () => {
    const m = messages(
      {
        '.vscode/mcp.json': json({
          inputs: [{ type: 'promptString', id: 'known' }, { type: 'promptString' }],
          servers: {
            s: {
              type: 'http',
              url: 'https://x.dev',
              headers: { A: '${input:known}', B: '${input:missing}' },
            },
          },
        }),
      },
      'ACD005',
    );
    expect(m).toEqual([
      'inputs[1] must be an object with a non-empty string "id".',
      'Server "s" references "${input:missing}" but no input with id "missing" is declared in "inputs".',
    ]);
    expect(messages({ '.vscode/mcp.json': json({ inputs: {}, servers: {} }) }, 'ACD005')).toEqual([
      '"inputs" must be an array.',
    ]);
  });
});

describe('ACD007 duplicate server names', () => {
  it('reports duplicate keys and case collisions within a file', () => {
    const m = messages(
      {
        '.mcp.json':
          '{"mcpServers": {"a": {"command": "x"}, "a": {"command": "y"}, "GitHub": {"command": "g"}, "github": {"command": "g"}}}',
      },
      'ACD007',
    );
    expect(m).toEqual([
      'Server "a" is defined more than once in "mcpServers". JSON parsers keep only the last definition.',
      'Server names "GitHub", "github" differ only by letter case.',
    ]);
  });

  it('reports the same name defined differently across files, but not identical ones', () => {
    const files = {
      '.mcp.json': mcp({ gh: { command: 'npx', args: ['gh@1'] }, same: { command: 'x' } }),
      '.cursor/mcp.json': mcp({ gh: { command: 'npx', args: ['gh@2'] }, same: { command: 'x' } }),
    };
    expect(messages(files, 'ACD007')).toEqual([
      'Server "gh" is defined differently here and in .mcp.json.',
    ]);
  });

  it('does not report unique names', () => {
    expect(
      messages({ '.mcp.json': mcp({ a: { command: 'x' }, b: { command: 'y' } }) }, 'ACD007'),
    ).toEqual([]);
  });
});

describe('ACD008 invalid settings', () => {
  it('accepts a valid settings file', () => {
    const findings = analyze({
      '.claude/settings.json': json({
        permissions: {
          allow: [
            'Bash(npm run test *)',
            'Read(./src/**)',
            'mcp__github',
            'WebFetch(domain:docs.x.dev)',
          ],
          ask: ['Bash(git push *)'],
          deny: ['Read(./.env)'],
          defaultMode: 'acceptEdits',
          additionalDirectories: ['../shared'],
        },
        env: { NODE_ENV: 'development' },
        enableAllProjectMcpServers: false,
        enabledMcpjsonServers: ['github'],
        hooks: {
          PostToolUse: [
            { matcher: 'Edit', hooks: [{ type: 'command', command: 'npm run format' }] },
          ],
        },
        sandbox: { enabled: true },
      }),
      '.mcp.json': mcp({ github: { command: 'npx', args: ['gh@1'] } }),
    });
    expect(byRule(findings, 'ACD008')).toEqual([]);
  });

  it('reports type errors, malformed rules and invalid modes', () => {
    const m = messages(
      {
        '.claude/settings.json': json({
          permissions: {
            allow: ['Bash(npm run', 42, 'mcp__github(tool)', 'Bash(command:rm *)'],
            deny: 'Read(.env)',
            defaultMode: 'yolo',
            additionalDirectories: [1],
          },
          env: { A: 1 },
          enableAllProjectMcpServers: 'yes',
          enabledMcpjsonServers: 'github',
          hooks: {
            PreToolUse: {},
            PostToolUse: [{ hooks: [{ type: 'command' }, { nope: 1 }] }, 'x'],
          },
          sandbox: { enabled: 'true' },
        }),
      },
      'ACD008',
    );
    for (const expected of [
      'Permission rule "Bash(npm run" is malformed',
      '"permissions.allow[1]" must be a string, got a number.',
      'Permission rule "mcp__github(tool)" uses parentheses on an MCP tool',
      'Permission rule "Bash(command:rm *)" matches a primary content field',
      '"permissions.deny" must be an array of strings, got a string.',
      '"permissions.defaultMode" is "yolo"',
      '"permissions.additionalDirectories[0]" must be a string',
      '"env.A" must be a string, got a number.',
      '"enableAllProjectMcpServers" must be true or false',
      '"enabledMcpjsonServers" must be an array of strings',
      '"hooks.PreToolUse" must be an array of matcher groups.',
      'Command hook "hooks.PostToolUse[0].hooks[0]" has no "command".',
      '"hooks.PostToolUse[0].hooks[1]" must be an object with a string "type".',
      '"hooks.PostToolUse[1]" must be an object with a "hooks" array.',
      '"sandbox.enabled" must be true or false.',
    ]) {
      expect(
        m.some((x) => x.startsWith(expected)),
        expected,
      ).toBe(true);
    }
  });

  it('reports conflicts, unknown approved servers and bypass modes', () => {
    const m = messages(
      {
        '.claude/settings.json': json({
          permissions: {
            allow: ['Bash(rm *)'],
            deny: ['Bash(rm *)'],
            defaultMode: 'bypassPermissions',
          },
          enabledMcpjsonServers: ['a', 'ghost'],
          disabledMcpjsonServers: ['a'],
        }),
        '.mcp.json': mcp({ a: { command: 'x' } }),
      },
      'ACD008',
    );
    expect(m).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Rule "Bash\(rm \*\)" appears in both "allow" and "deny"/),
        expect.stringMatching(
          /^"permissions.defaultMode" is "bypassPermissions" in a project settings file/,
        ),
        'Server "a" is listed in both enabledMcpjsonServers and disabledMcpjsonServers.',
        'enabledMcpjsonServers references "ghost", which is not defined in .mcp.json.',
      ]),
    );
  });

  it('reports invalid JSON and non-object roots', () => {
    expect(messages({ '.claude/settings.json': '{"a": 1,}' }, 'ACD008')[0]).toMatch(
      /^Invalid JSON/,
    );
    expect(messages({ '.claude/settings.json': '"x"' }, 'ACD008')).toEqual([
      'Settings must be a JSON object, got a string.',
    ]);
    expect(messages({ '.claude/settings.json': json({ permissions: [] }) }, 'ACD008')).toEqual([
      '"permissions" must be an object, got an array.',
    ]);
    expect(messages({ '.claude/settings.json': json({ hooks: [] }) }, 'ACD008')[0]).toMatch(
      /"hooks" must be an object/,
    );
    expect(messages({ '.claude/settings.json': json({ env: [] }) }, 'ACD008')[0]).toMatch(
      /"env" must be an object/,
    );
  });

  it('validates Cursor rule files', () => {
    expect(messages({ '.cursor/rules/a.md': '# rule' }, 'ACD008')[0]).toMatch(/Plain .md files/);
    expect(messages({ '.cursor/rules/a.mdc': '# rule' }, 'ACD008')[0]).toMatch(/no frontmatter/);
    expect(messages({ '.cursor/rules/a.mdc': '---\nalwaysApply: true\n' }, 'ACD008')).toEqual([
      'Frontmatter is not closed with a "---" line',
    ]);
    expect(
      messages(
        { '.cursor/rules/a.mdc': '---\nalwaysApply: "yes"\ndescription: 3\nglobs: 5\n---\n' },
        'ACD008',
      ).sort(),
    ).toEqual([
      '"alwaysApply" must be true or false.',
      '"description" must be a string.',
      '"globs" must be a comma-separated string or a list of strings.',
    ]);
    expect(
      messages(
        {
          '.cursor/rules/a.mdc':
            '---\ndescription: ok\nglobs: src/**\nalwaysApply: false\n---\nBody',
        },
        'ACD008',
      ),
    ).toEqual([]);
  });
});
