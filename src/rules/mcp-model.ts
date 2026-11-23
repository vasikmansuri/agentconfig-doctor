import type { ConfigDocument, ConfigKind, JsonDocument, JsonPath } from '../types/index.js';
import { MCP_KINDS } from '../types/index.js';
import { isRecord } from '../util/text.js';

export type Transport = 'stdio' | 'http' | 'sse' | 'ws' | 'unknown';

export interface McpServer {
  doc: JsonDocument;
  name: string;
  /** Raw server definition (may be any JSON type when invalid). */
  def: unknown;
  path: JsonPath;
  transport: Transport;
  command?: string | undefined;
  args: string[];
  env: Record<string, unknown>;
  url?: string | undefined;
  headers: Record<string, unknown>;
}

export function serversKey(kind: ConfigKind): 'servers' | 'mcpServers' {
  return kind === 'vscode-mcp' ? 'servers' : 'mcpServers';
}

export function isMcpDocument(
  doc: ConfigDocument,
): doc is JsonDocument & { kind: 'claude-mcp' | 'cursor-mcp' | 'vscode-mcp' } {
  return doc.format === 'json' && MCP_KINDS.includes(doc.kind);
}

export function normaliseTransport(type: unknown, def: Record<string, unknown>): Transport {
  if (typeof type === 'string') {
    const t = type.toLowerCase();
    if (t === 'stdio') return 'stdio';
    if (t === 'http' || t === 'streamable-http') return 'http';
    if (t === 'sse') return 'sse';
    if (t === 'ws') return 'ws';
    return 'unknown';
  }
  if (typeof def.url === 'string') return 'http';
  if (typeof def.command === 'string') return 'stdio';
  return 'unknown';
}

/**
 * JSON paths of the server maps a document defines: the top-level servers
 * object of an MCP file, inline `mcpServers` in a plugin manifest, and inline
 * `mcpServers` in marketplace plugin entries. Paths and bundles referenced by
 * a manifest are not followed.
 */
function serverContainers(doc: JsonDocument): JsonPath[] {
  if (!isRecord(doc.value)) return [];
  if (isMcpDocument(doc)) return [[serversKey(doc.kind)]];
  if (doc.kind === 'claude-plugin-manifest') return [['mcpServers']];
  if (doc.kind === 'claude-marketplace' && Array.isArray(doc.value.plugins)) {
    return doc.value.plugins.map((_, i): JsonPath => ['plugins', i, 'mcpServers']);
  }
  return [];
}

function valueAt(root: unknown, path: JsonPath): unknown {
  let value = root;
  for (const segment of path) {
    if (Array.isArray(value) && typeof segment === 'number') value = value[segment];
    else if (isRecord(value) && typeof segment === 'string') value = value[segment];
    else return undefined;
  }
  return value;
}

/** Returns the server definitions of a parsed MCP document or plugin file. */
export function getMcpServers(doc: ConfigDocument): McpServer[] {
  if (doc.format !== 'json') return [];
  return serverContainers(doc).flatMap((containerPath) => {
    const container = valueAt(doc.value, containerPath);
    return isRecord(container) ? serversIn(doc, container, containerPath) : [];
  });
}

function serversIn(
  doc: JsonDocument,
  container: Record<string, unknown>,
  containerPath: JsonPath,
): McpServer[] {
  return Object.entries(container).map(([name, def]) => {
    const record = isRecord(def) ? def : {};
    return {
      doc,
      name,
      def,
      path: [...containerPath, name],
      transport: normaliseTransport(record.type, record),
      command: typeof record.command === 'string' ? record.command : undefined,
      args: Array.isArray(record.args)
        ? record.args.filter((a): a is string => typeof a === 'string')
        : [],
      env: isRecord(record.env) ? record.env : {},
      url: typeof record.url === 'string' ? record.url : undefined,
      headers: isRecord(record.headers) ? record.headers : {},
    };
  });
}

export function allMcpServers(docs: readonly ConfigDocument[]): McpServer[] {
  return docs.flatMap(getMcpServers);
}

/** Command line as a single string, for pattern matching only (never executed). */
export function commandLine(server: McpServer): string {
  return [server.command ?? '', ...server.args].join(' ').trim();
}

export function basenameOf(command: string): string {
  const base = command.split(/[\\/]/).pop() ?? command;
  return base.toLowerCase();
}
