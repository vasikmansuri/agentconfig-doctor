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
export interface ClassifyContext {
  /**
   * POSIX path of the nearest enclosing Claude Code plugin root (a directory
   * with a `.claude-plugin/plugin.json` manifest), relative to the same base as the path;
   * '' when the base itself is the plugin root. Plugin component files are
   * only recognised inside a plugin root, because other agents use the same
   * directory names with different formats.
   */
  pluginRoot?: string | undefined;
}

/** Kind of a file inside a Claude Code plugin, by its path relative to the plugin root. */
function classifyPluginComponent(segments: string[]): ConfigKind | undefined {
  const [area] = segments;
  const base = segments.at(-1) ?? '';
  if (segments.length === 2 && area === 'hooks' && base === 'hooks.json') {
    return 'claude-plugin-hooks';
  }
  if (area === 'skills' && segments.length === 3 && base === 'SKILL.md') return 'claude-skill';
  if (area === 'commands' && segments.length >= 2 && base.endsWith('.md')) return 'claude-command';
  if (area === 'agents' && segments.length >= 2 && base.endsWith('.md')) return 'claude-agent';
  return undefined;
}

export function classifyPath(
  posixPath: string,
  context: ClassifyContext = {},
): ConfigKind | undefined {
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
  // Claude Code skills, legacy custom commands and subagents. Only SKILL.md is
  // the skill itself; other files in a skill directory are supporting material.
  const claudeIndex = segments.lastIndexOf('.claude');
  if (claudeIndex >= 0 && claudeIndex < segments.length - 2 && base.endsWith('.md')) {
    const area = segments[claudeIndex + 1];
    if (area === 'skills' && base === 'SKILL.md' && claudeIndex === segments.length - 4) {
      return 'claude-skill';
    }
    if (area === 'commands') return 'claude-command';
    if (area === 'agents') return 'claude-agent';
  }
  if (INSTRUCTION_FILES.has(base)) return 'instructions';
  if (parent === '.claude-plugin' && base === 'plugin.json') return 'claude-plugin-manifest';
  if (parent === '.claude-plugin' && base === 'marketplace.json') return 'claude-marketplace';
  if (context.pluginRoot !== undefined) {
    const rootSegments = context.pluginRoot.split('/').filter((s) => s !== '');
    const inside = rootSegments.every((s, i) => segments[i] === s);
    if (inside) return classifyPluginComponent(segments.slice(rootSegments.length));
  }
  return undefined;
}
