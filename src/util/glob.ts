const ESCAPE = /[.+^${}()|[\]\\]/g;

/**
 * Minimal, dependency-free glob matcher for POSIX-style relative paths.
 * Supports `**` (any number of path segments), `*` (within a segment), `?`,
 * and `{a,b}` alternatives. A pattern without a slash matches a path segment
 * anywhere in the tree, mirroring .gitignore behaviour. A pattern that matches
 * a directory also matches everything below it.
 */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, '/').trim();
  if (p.startsWith('./')) p = p.slice(2);
  if (p.endsWith('/')) p = p.slice(0, -1);
  const anchored = p.includes('/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i] as string;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const atSegmentEnd = p[i + 2] === '/';
        re += atSegmentEnd ? '(?:.*/)?' : '.*';
        i += atSegmentEnd ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{' && p.indexOf('}', i) !== -1) {
      const end = p.indexOf('}', i);
      const alts = p
        .slice(i + 1, end)
        .split(',')
        .map((a) => a.replace(ESCAPE, '\\$&').replace(/\*/g, '[^/]*'));
      re += `(?:${alts.join('|')})`;
      i = end;
    } else {
      re += ch.replace(ESCAPE, '\\$&');
    }
  }
  return new RegExp(anchored ? `^${re}(?:/.*)?$` : `(?:^|/)${re}(?:/.*)?$`);
}

export function createMatcher(patterns: readonly string[]): (path: string) => boolean {
  const regexes = patterns.filter((p) => p.trim() !== '').map(globToRegExp);
  return (path) => regexes.some((r) => r.test(path));
}
