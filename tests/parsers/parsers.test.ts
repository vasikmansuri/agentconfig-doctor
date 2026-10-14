import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../src/parsers/frontmatter.js';
import { loadDocument } from '../../src/parsers/index.js';
import { parseJsonDocument } from '../../src/parsers/json.js';

describe('JSON parsing', () => {
  it('parses strict JSON and locates properties', () => {
    const text = '{\n  "mcpServers": {\n    "a": { "command": "x" }\n  }\n}';
    const doc = parseJsonDocument('claude-mcp', '.mcp.json', text, { jsonc: false });
    expect(doc.parseErrors).toEqual([]);
    expect(doc.value).toEqual({ mcpServers: { a: { command: 'x' } } });
    expect(doc.locate(['mcpServers', 'a'])).toEqual({ line: 3, column: 5 });
    expect(doc.locate(['mcpServers', 'a', 'command'])).toEqual({ line: 3, column: 12 });
    expect(doc.locate(['missing'])).toBeUndefined();
  });

  it('rejects comments and trailing commas in strict formats', () => {
    const doc = parseJsonDocument('claude-mcp', '.mcp.json', '{ // c\n "a": 1, }', {
      jsonc: false,
    });
    expect(doc.parseErrors.length).toBeGreaterThan(0);
    expect(doc.parseErrors[0]!.message).toMatch(/Comments are not allowed/);
    expect(doc.value).toBeUndefined();
  });

  it('accepts comments and trailing commas in JSONC formats', () => {
    const doc = parseJsonDocument('vscode-mcp', '.vscode/mcp.json', '{ // c\n "servers": {}, }', {
      jsonc: true,
    });
    expect(doc.parseErrors).toEqual([]);
    expect(doc.value).toEqual({ servers: {} });
  });

  it('reports malformed and empty input with positions', () => {
    const doc = parseJsonDocument('claude-mcp', '.mcp.json', '{\n  "a": \n', { jsonc: false });
    expect(doc.parseErrors[0]?.line).toBeTypeOf('number');
    expect(doc.parseErrors[0]?.column).toBeTypeOf('number');
    const empty = parseJsonDocument('claude-mcp', '.mcp.json', '   ', { jsonc: false });
    expect(empty.parseErrors).toEqual([{ message: 'File is empty', line: 1, column: 1 }]);
  });

  it('tolerates a byte-order mark', () => {
    const doc = parseJsonDocument('claude-mcp', '.mcp.json', '\ufeff{"mcpServers":{}}', {
      jsonc: false,
    });
    expect(doc.parseErrors).toEqual([]);
    expect(doc.value).toEqual({ mcpServers: {} });
  });

  it('records duplicate keys that JSON.parse would silently collapse', () => {
    const text = '{"mcpServers": {"a": {"command": "x"}, "a": {"command": "y"}}}';
    const doc = parseJsonDocument('claude-mcp', '.mcp.json', text, { jsonc: false });
    expect(doc.duplicateKeys).toEqual([
      { path: ['mcpServers'], key: 'a', location: { line: 1, column: 40 } },
    ]);
  });

  it('loads documents with the right parser for each kind', () => {
    expect(loadDocument('vscode-mcp', '.vscode/mcp.json', '{/*c*/"servers":{}}').format).toBe(
      'json',
    );
    const rule = loadDocument(
      'cursor-rule',
      '.cursor/rules/a.mdc',
      '---\nalwaysApply: true\n---\nx',
    );
    expect(rule.format).toBe('text');
    expect(rule.locate(['x'])).toBeUndefined();
    expect(rule.format === 'text' && rule.frontmatter?.fields.alwaysApply).toBe(true);
  });
});

describe('frontmatter parsing', () => {
  it('parses scalars and lists', () => {
    const fm = parseFrontmatter(
      '---\ndescription: "Style rules"\nglobs: [src/**/*.ts, "test/*.ts"]\nalwaysApply: false\nlevel: 3\nnothing: null\ntags:\n  - a\n  - b\n---\nbody',
    );
    expect(fm).toMatchObject({ present: true, terminated: true, issues: [] });
    expect(fm.fields).toEqual({
      description: 'Style rules',
      globs: ['src/**/*.ts', 'test/*.ts'],
      alwaysApply: false,
      level: 3,
      nothing: null,
      tags: ['a', 'b'],
    });
  });

  it('reports a missing terminator and unrecognised lines', () => {
    const fm = parseFrontmatter('---\nalwaysApply: true\n???\n');
    expect(fm.terminated).toBe(false);
    expect(fm.issues.map((i) => i.message)).toEqual([
      'Unrecognised frontmatter line: ???',
      'Frontmatter is not closed with a "---" line',
    ]);
  });

  it('returns not-present when there is no frontmatter', () => {
    expect(parseFrontmatter('# Title').present).toBe(false);
    expect(parseFrontmatter('').present).toBe(false);
  });

  it('handles empty values, comments and CRLF line endings', () => {
    const fm = parseFrontmatter('---\r\n# comment\r\ndescription:\r\nglobs: []\r\n---\r\n');
    expect(fm.terminated).toBe(true);
    expect(fm.fields).toEqual({ description: [], globs: [] });
  });
});
