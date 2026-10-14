import type { ConfigDocument, JsonDocument, JsonPath } from '../types/index.js';
import { isRecord } from '../util/text.js';

export function isSettingsDocument(
  doc: ConfigDocument,
): doc is JsonDocument & { kind: 'claude-settings' } {
  return doc.format === 'json' && doc.kind === 'claude-settings';
}

export function getSettings(doc: ConfigDocument): Record<string, unknown> | undefined {
  if (!isSettingsDocument(doc) || !isRecord(doc.value)) return undefined;
  return doc.value;
}

export interface IndexedString {
  value: string;
  path: JsonPath;
}

/** String entries of an array at `path`, with their JSON paths. Non-strings are skipped. */
export function stringsAt(root: unknown, path: JsonPath): IndexedString[] {
  let node: unknown = root;
  for (const segment of path) {
    if (typeof segment === 'number') node = Array.isArray(node) ? node[segment] : undefined;
    else node = isRecord(node) ? node[segment] : undefined;
  }
  if (!Array.isArray(node)) return [];
  return node.flatMap((value, i) =>
    typeof value === 'string' ? [{ value, path: [...path, i] }] : [],
  );
}

export interface PermissionRule {
  raw: string;
  tool: string;
  specifier?: string | undefined;
}

/** Parses `Tool` or `Tool(specifier)` permission rule syntax. */
export function parsePermissionRule(raw: string): PermissionRule | undefined {
  const m = /^\s*([A-Za-z0-9_*.-]+)\s*(?:\((.*)\))?\s*$/s.exec(raw);
  if (!m) return undefined;
  return { raw, tool: m[1] as string, specifier: m[2] };
}

/** Project directory that a `.claude/settings*.json` file belongs to ('' for the scan root). */
export function projectDirOf(settingsPath: string): string {
  return settingsPath.split('/').slice(0, -2).join('/');
}

export interface HookCommand {
  event: string;
  command: string;
  path: (string | number)[];
}

/** Command hooks from Claude Code `hooks` settings: { Event: [{ matcher, hooks: [{ type, command }] }] }. */
export function hookCommands(settings: Record<string, unknown>): HookCommand[] {
  const hooks = settings.hooks;
  if (!isRecord(hooks)) return [];
  const out: HookCommand[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, gi) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) return;
      group.hooks.forEach((hook, hi) => {
        if (isRecord(hook) && typeof hook.command === 'string') {
          out.push({
            event,
            command: hook.command,
            path: ['hooks', event, gi, 'hooks', hi, 'command'],
          });
        }
      });
    });
  }
  return out;
}
