import type { ConfigKind } from '../types/index.js';

/**
 * Statically expands the variable references an MCP client would substitute
 * in a server's command line, so reviewers and rules see what will actually
 * run. Nothing is read from the environment, the file system or the user:
 * values that depend on the machine running the client are kept as visible
 * markers such as ⟨env:NAME⟩.
 *
 * - Claude Code: `${VAR}` stays a marker; `${VAR:-default}` becomes the
 *   default, which is what runs wherever VAR is unset.
 * - Cursor and VS Code: `${userHome}` becomes `~`, `${workspaceFolder}`
 *   becomes `.` (the project directory), `${/}` and `${pathSeparator}`
 *   become `/`; `${env:NAME}`, `${input:ID}` and anything unknown stay markers.
 */
export function resolveInterpolation(text: string, kind: ConfigKind): string {
  if (kind === 'claude-mcp') {
    return text.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
      (_m, name: string, fallback: string | undefined) => fallback ?? `⟨env:${name}⟩`,
    );
  }
  if (kind === 'cursor-mcp' || kind === 'vscode-mcp') {
    return text.replace(/\$\{([^}]+)\}/g, (_m, ref: string) => {
      switch (ref) {
        case 'userHome':
          return '~';
        case 'workspaceFolder':
          return '.';
        case '/':
        case 'pathSeparator':
          return '/';
        default:
          return `⟨${ref}⟩`;
      }
    });
  }
  return text;
}
