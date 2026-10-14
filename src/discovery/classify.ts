import type { ConfigKind } from '../types/index.js';

/** File names treated as agent instruction files. */
export const INSTRUCTION_FILES = new Set([
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  '.cursorrules',
]);

/** Directory names never descended into by default. */
export const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
]);

/**
 * Classifies a POSIX path by its trailing segments. Returns undefined for
 * files that are not a supported agent configuration format; arbitrary JSON
 * files are never treated as agent configuration.
 */
export function classifyPath(posixPath: string): ConfigKind | undefined {
  const segments = posixPath.split('/').filter((s) => s !== '');
  const base = segments.at(-1);
  const parent = segments.at(-2);
  if (base === undefined) return undefined;

  if (base === '.mcp.json') return 'claude-mcp';
  if (base === 'mcp.json' && parent === '.cursor') return 'cursor-mcp';
  if (base === 'mcp.json' && parent === '.vscode') return 'vscode-mcp';
  if ((base === 'settings.json' || base === 'settings.local.json') && parent === '.claude') {
    return 'claude-settings';
  }
  const rulesIndex = segments.lastIndexOf('rules');
  if (
    rulesIndex > 0 &&
    rulesIndex < segments.length - 1 &&
    segments[rulesIndex - 1] === '.cursor' &&
    (base.endsWith('.mdc') || base.endsWith('.md'))
  ) {
    return 'cursor-rule';
  }
  if (INSTRUCTION_FILES.has(base)) return 'instructions';
  return undefined;
}
