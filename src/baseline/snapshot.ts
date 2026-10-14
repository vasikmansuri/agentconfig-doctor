import { z } from 'zod';
import type { ConfigDocument } from '../types/index.js';
import { getMcpServers, isMcpDocument, type McpServer } from '../rules/mcp-model.js';
import {
  getSettings,
  hookCommands,
  isSettingsDocument,
  stringsAt,
} from '../rules/settings-model.js';
import { scrubSecrets } from '../util/secrets.js';
import { isRecord, shortHash } from '../util/text.js';

export const SettingsSnapshotSchema = z
  .object({
    allow: z.array(z.string()),
    ask: z.array(z.string()),
    deny: z.array(z.string()),
    defaultMode: z.string().optional(),
    additionalDirectories: z.array(z.string()),
    enableAllProjectMcpServers: z.boolean().optional(),
    enabledMcpjsonServers: z.array(z.string()),
    disabledMcpjsonServers: z.array(z.string()),
    sandboxEnabled: z.boolean().optional(),
    hooks: z.array(z.string()),
  })
  .strict();

export const PermissionSnapshotSchema = z
  .object({
    settings: z.record(z.string(), SettingsSnapshotSchema),
    mcpServers: z.record(z.string(), z.record(z.string(), z.string().regex(/^[0-9a-f]{16}$/))),
  })
  .strict();

export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>;
export type PermissionSnapshot = z.infer<typeof PermissionSnapshotSchema>;

export const EMPTY_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  allow: [],
  ask: [],
  deny: [],
  additionalDirectories: [],
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hooks: [],
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values: string[]) => [...new Set(values)].sort(byString);
const scrubbed = (values: string[]) => sortedUnique(values.map(scrubSecrets));

/**
 * Hash of the parts of a server definition that determine what runs and where
 * it connects. Environment and header *values* are excluded (they may hold
 * secrets); their names are included.
 */
export function serverFingerprint(server: McpServer): string {
  return shortHash(
    JSON.stringify({
      transport: server.transport,
      command: server.command ?? null,
      args: server.args,
      url: server.url ?? null,
      env: Object.keys(server.env).sort(byString),
      headers: Object.keys(server.headers).sort(byString),
    }),
  );
}

/**
 * Captures the permission-relevant state of the scanned configuration. The
 * snapshot is written into baselines, so it must never contain secret values.
 */
export function snapshotPermissions(documents: readonly ConfigDocument[]): PermissionSnapshot {
  const settings: PermissionSnapshot['settings'] = {};
  const mcpServers: PermissionSnapshot['mcpServers'] = {};

  for (const doc of [...documents].sort((a, b) => byString(a.path, b.path))) {
    if (isSettingsDocument(doc)) {
      const s = getSettings(doc);
      if (!s) continue;
      const perms = isRecord(s.permissions) ? s.permissions : {};
      const values = (path: (string | number)[]) => stringsAt(s, path).map((e) => e.value);
      const snap: SettingsSnapshot = {
        allow: scrubbed(values(['permissions', 'allow'])),
        ask: scrubbed(values(['permissions', 'ask'])),
        deny: scrubbed(values(['permissions', 'deny'])),
        additionalDirectories: scrubbed(values(['permissions', 'additionalDirectories'])),
        enabledMcpjsonServers: scrubbed(values(['enabledMcpjsonServers'])),
        disabledMcpjsonServers: scrubbed(values(['disabledMcpjsonServers'])),
        hooks: sortedUnique(hookCommands(s).map((h) => `${h.event}:${shortHash(h.command)}`)),
      };
      if (typeof perms.defaultMode === 'string') snap.defaultMode = perms.defaultMode;
      if (typeof s.enableAllProjectMcpServers === 'boolean') {
        snap.enableAllProjectMcpServers = s.enableAllProjectMcpServers;
      }
      if (isRecord(s.sandbox) && typeof s.sandbox.enabled === 'boolean') {
        snap.sandboxEnabled = s.sandbox.enabled;
      }
      settings[doc.path] = snap;
    } else if (isMcpDocument(doc) && doc.parseErrors.length === 0) {
      const servers: Record<string, string> = {};
      for (const server of getMcpServers(doc).sort((a, b) => byString(a.name, b.name))) {
        servers[server.name] = serverFingerprint(server);
      }
      mcpServers[doc.path] = servers;
    }
  }
  return { settings, mcpServers };
}
