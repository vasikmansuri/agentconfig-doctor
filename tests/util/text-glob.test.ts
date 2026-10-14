import { describe, expect, it } from 'vitest';
import { createMatcher, globToRegExp } from '../../src/util/glob.js';
import { createOffsetLocator, stripControlChars, truncate } from '../../src/util/text.js';

describe('glob matching', () => {
  it('matches basenames anywhere when the pattern has no slash', () => {
    const m = createMatcher(['*.mdc']);
    expect(m('.cursor/rules/a.mdc')).toBe(true);
    expect(m('a.md')).toBe(false);
  });

  it('anchors patterns that contain a slash', () => {
    const m = createMatcher(['packages/*/.mcp.json']);
    expect(m('packages/a/.mcp.json')).toBe(true);
    expect(m('x/packages/a/.mcp.json')).toBe(false);
  });

  it('supports ** and directory prefixes', () => {
    expect(globToRegExp('examples/**').test('examples/a/b/.mcp.json')).toBe(true);
    expect(globToRegExp('**/.mcp.json').test('.mcp.json')).toBe(true);
    expect(globToRegExp('**/.mcp.json').test('a/b/.mcp.json')).toBe(true);
    expect(createMatcher(['examples'])('examples/x/.mcp.json')).toBe(true);
    expect(createMatcher(['examples/'])('examples/x/.mcp.json')).toBe(true);
  });

  it('supports ? and {a,b}', () => {
    const m = createMatcher(['.{cursor,vscode}/mcp.json', 'a?.md']);
    expect(m('.cursor/mcp.json')).toBe(true);
    expect(m('.vscode/mcp.json')).toBe(true);
    expect(m('.claude/mcp.json')).toBe(false);
    expect(m('ab.md')).toBe(true);
  });

  it('treats regex metacharacters literally', () => {
    expect(createMatcher(['a+b(c).json'])('a+b(c).json')).toBe(true);
    expect(createMatcher(['a+b(c).json'])('aab(c).json')).toBe(false);
  });

  it('accepts Windows separators and ./ prefixes', () => {
    expect(createMatcher(['.\\examples\\*'])('examples/x')).toBe(true);
    expect(createMatcher(['./examples'])('examples/x')).toBe(true);
  });

  it('ignores empty patterns', () => {
    expect(createMatcher(['', '  '])('anything')).toBe(false);
  });
});

describe('text helpers', () => {
  it('locates offsets as 1-based line and column', () => {
    const locate = createOffsetLocator('ab\ncd\n\nef');
    expect(locate(0)).toEqual({ line: 1, column: 1 });
    expect(locate(4)).toEqual({ line: 2, column: 2 });
    expect(locate(7)).toEqual({ line: 4, column: 1 });
  });

  it('escapes terminal control and bidi characters', () => {
    const out = stripControlChars('a\u001b[31mred\nfake line\u202eevil');
    expect(out).not.toContain('\u001b');
    expect(out).not.toContain('\n');
    expect(out).not.toContain('\u202e');
    expect(out).toContain('\\u{1b}');
  });

  it('truncates long values', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
