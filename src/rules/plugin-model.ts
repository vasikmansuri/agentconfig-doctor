import type { ConfigDocument, JsonPath } from '../types/index.js';
import { isRecord } from '../util/text.js';
import { hookCommandsAt, type HookCommand } from './settings-model.js';

/**
 * Claude Code plugin files: `<plugin>/hooks/hooks.json`,
 * `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`.
 * Formats: https://code.claude.com/docs/en/plugins-reference and
 * https://code.claude.com/docs/en/plugins/marketplace-reference.
 */

export interface PluginHookCommand extends HookCommand {
  /** Plugin name for marketplace entries. */
  plugin?: string | undefined;
}

/**
 * Inline hook definitions. hooks.json wraps the event map in "hooks"; a
 * manifest's `hooks` is the event map itself, or an array mixing event maps
 * and file paths (paths are not followed); marketplace entries take an inline
 * event map.
 */
export function pluginHookCommands(doc: ConfigDocument): PluginHookCommand[] {
  if (doc.format !== 'json' || !isRecord(doc.value)) return [];
  const value = doc.value;
  if (doc.kind === 'claude-plugin-hooks') return hookCommandsAt(value.hooks, ['hooks']);
  if (doc.kind === 'claude-plugin-manifest') return manifestHooks(value.hooks, ['hooks']);
  if (doc.kind === 'claude-marketplace' && Array.isArray(value.plugins)) {
    return value.plugins.flatMap((entry, i): PluginHookCommand[] => {
      if (!isRecord(entry)) return [];
      const plugin = typeof entry.name === 'string' ? entry.name : undefined;
      return manifestHooks(entry.hooks, ['plugins', i, 'hooks']).map((h) => ({ ...h, plugin }));
    });
  }
  return [];
}

function manifestHooks(hooks: unknown, path: JsonPath): HookCommand[] {
  if (Array.isArray(hooks)) {
    return hooks.flatMap((item, i) => (isRecord(item) ? hookCommandsAt(item, [...path, i]) : []));
  }
  return hookCommandsAt(hooks, path);
}

export interface MarketplaceSourceCommand {
  plugin: string;
  command: string;
  path: JsonPath;
}

/** Marketplace entries installed by running a command (`"source": "command"`). */
export function marketplaceSourceCommands(doc: ConfigDocument): MarketplaceSourceCommand[] {
  if (doc.kind !== 'claude-marketplace' || doc.format !== 'json' || !isRecord(doc.value)) return [];
  const plugins = doc.value.plugins;
  if (!Array.isArray(plugins)) return [];
  return plugins.flatMap((entry, i): MarketplaceSourceCommand[] => {
    if (!isRecord(entry) || !isRecord(entry.source)) return [];
    const { source } = entry;
    if (source.source !== 'command' || typeof source.command !== 'string') return [];
    return [
      {
        plugin: typeof entry.name === 'string' ? entry.name : `#${i + 1}`,
        command: source.command,
        path: ['plugins', i, 'source', 'command'],
      },
    ];
  });
}
