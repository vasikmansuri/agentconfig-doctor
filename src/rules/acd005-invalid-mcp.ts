import { z } from 'zod';
import type { ConfigKind, JsonDocument, JsonPath } from '../types/index.js';
import { isRecord } from '../util/text.js';
import { isMcpDocument, normaliseTransport, serversKey } from './mcp-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

type McpKind = 'claude-mcp' | 'cursor-mcp' | 'vscode-mcp';

/** Transport `type` values accepted by each client, per its documentation. */
export const ALLOWED_TYPES: Record<McpKind, readonly string[]> = {
  'claude-mcp': ['stdio', 'http', 'sse', 'ws', 'streamable-http'],
  'cursor-mcp': ['stdio', 'http', 'sse', 'streamable-http'],
  'vscode-mcp': ['stdio', 'http', 'sse'],
};

const envValue = (kind: ConfigKind) =>
  kind === 'vscode-mcp' ? z.union([z.string(), z.number(), z.null()]) : z.string();

const serverShape = (kind: ConfigKind) =>
  z.looseObject({
    type: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), envValue(kind)).optional(),
    envFile: z.string().optional(),
    cwd: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  });

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function pathLabel(path: JsonPath): string {
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`)).join('');
}

function validateDocument(doc: JsonDocument): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const add = (
    message: string,
    path: JsonPath,
    key: string,
    severity: 'medium' | 'low' = 'medium',
    remediation?: string,
  ) =>
    findings.push(
      findingFor(doc, {
        severity,
        confidence: 'high',
        message,
        location: doc.locate(path) ?? { line: 1, column: 1 },
        key,
        remediation,
      }),
    );

  if (doc.parseErrors.length > 0) {
    for (const error of doc.parseErrors.slice(0, 5)) {
      findings.push(
        findingFor(doc, {
          severity: 'medium',
          confidence: 'high',
          message: `Invalid JSON: ${error.message}. The client will fail to load this file.`,
          location: { line: error.line, column: error.column },
          key: `parse:${error.message}`,
        }),
      );
    }
    return findings;
  }

  const kind = doc.kind as McpKind;
  const key = serversKey(kind);
  const root = doc.value;
  if (!isRecord(root)) {
    add(`Top-level value must be an object, got ${describeValue(root)}.`, [], 'root-type');
    return findings;
  }
  const otherKey = key === 'servers' ? 'mcpServers' : 'servers';
  if (!(key in root)) {
    const hint =
      otherKey in root
        ? ` The file uses "${otherKey}", which is the ${otherKey === 'servers' ? 'VS Code' : 'Claude Code/Cursor'} key; this client expects "${key}".`
        : '';
    add(`Missing "${key}" object, so no servers are defined.${hint}`, [], 'missing-container');
    return findings;
  }
  const container = root[key];
  if (!isRecord(container)) {
    add(
      `"${key}" must be an object mapping server names to definitions, got ${describeValue(container)}.`,
      [key],
      'container-type',
    );
    return findings;
  }

  const inputIds = new Set<string>();
  if (kind === 'vscode-mcp' && 'inputs' in root) {
    if (!Array.isArray(root.inputs)) {
      add('"inputs" must be an array.', ['inputs'], 'inputs-type');
    } else {
      root.inputs.forEach((input, i) => {
        if (!isRecord(input) || typeof input.id !== 'string' || input.id === '') {
          add(
            `inputs[${i}] must be an object with a non-empty string "id".`,
            ['inputs', i],
            `inputs:${i}`,
          );
        } else {
          inputIds.add(input.id);
        }
      });
    }
  }

  for (const [name, def] of Object.entries(container)) {
    const base: JsonPath = [key, name];
    const k = `server:${name}`;
    if (name.trim() === '') add('Server name is empty.', base, `${k}:empty-name`);
    if (!isRecord(def)) {
      add(`Server "${name}" must be an object, got ${describeValue(def)}.`, base, `${k}:type`);
      continue;
    }

    const parsed = serverShape(kind).safeParse(def);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const issuePath = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
        add(
          `Server "${name}": field "${pathLabel(issuePath)}" is invalid (${issue.message}).`,
          [...base, ...issuePath],
          `${k}:schema:${pathLabel(issuePath)}`,
        );
      }
    }

    const hasCommand = typeof def.command === 'string';
    const hasUrl = typeof def.url === 'string';
    if (typeof def.type === 'string' && !ALLOWED_TYPES[kind].includes(def.type)) {
      add(
        `Server "${name}" has unsupported type "${def.type}". Expected one of: ${ALLOWED_TYPES[kind].join(', ')}.`,
        [...base, 'type'],
        `${k}:unknown-type`,
      );
      continue;
    }
    const transport = normaliseTransport(def.type, def);

    if (hasCommand && hasUrl) {
      add(
        `Server "${name}" defines both "command" and "url". A server is either local (stdio, command) or remote (url), not both.`,
        base,
        `${k}:command-and-url`,
      );
      continue;
    }
    if (def.command === undefined && def.url === undefined) {
      const declared = typeof def.type === 'string' ? transport : undefined;
      add(
        declared === 'stdio'
          ? `Server "${name}" is type "stdio" but has no "command".`
          : declared !== undefined
            ? `Server "${name}" is a remote (${declared}) server but has no "url".`
            : `Server "${name}" has neither "command" (local) nor "url" (remote).`,
        base,
        `${k}:no-endpoint`,
      );
      continue;
    }

    if (kind === 'claude-mcp' && hasUrl && def.type === undefined) {
      add(
        `Server "${name}" has a "url" but no "type". Claude Code treats such entries as stdio and rejects them.`,
        base,
        `${k}:url-without-type`,
        'medium',
        'Add "type": "http" (or "sse"/"ws") to the server definition.',
      );
    }

    if (transport === 'stdio') {
      if (hasUrl) {
        add(
          `Server "${name}" is type "stdio" but defines "url"; stdio servers need "command".`,
          [...base, 'url'],
          `${k}:stdio-url`,
        );
      } else if (hasCommand) {
        const command = def.command as string;
        if (command.trim() === '') {
          add(
            `Server "${name}" has an empty "command".`,
            [...base, 'command'],
            `${k}:empty-command`,
          );
        } else {
          const looksLikePath = /[\\/]/.test(command);
          const noArgs = !Array.isArray(def.args) || def.args.length === 0;
          if (/\s/.test(command.trim()) && !looksLikePath && noArgs) {
            add(
              `Server "${name}" puts arguments inside "command". Clients execute "command" as a single program name, so this usually fails to start (heuristic).`,
              [...base, 'command'],
              `${k}:args-in-command`,
              'low',
              'Move each argument into the "args" array, e.g. "command": "npx", "args": ["-y", "package"].',
            );
          }
        }
      }
    } else if (transport === 'http' || transport === 'sse' || transport === 'ws') {
      if (hasCommand) {
        add(
          `Server "${name}" is a remote (${transport}) server but defines "command".`,
          [...base, 'command'],
          `${k}:remote-command`,
        );
      }
      if (hasUrl) validateUrl(def.url as string, transport, name, [...base, 'url'], k, add);
      if ('envFile' in def) {
        add(
          `Server "${name}" sets "envFile", which only applies to stdio servers.`,
          [...base, 'envFile'],
          `${k}:remote-envfile`,
          'low',
        );
      }
      for (const field of ['args', 'env'] as const) {
        if (field in def) {
          add(
            `Server "${name}" is remote but sets "${field}", which only applies to local stdio servers and is ignored.`,
            [...base, field],
            `${k}:remote-${field}`,
            'low',
          );
        }
      }
    }

    if (kind === 'vscode-mcp') {
      const text = JSON.stringify(def);
      for (const m of text.matchAll(/\$\{input:([^}]+)\}/g)) {
        const id = m[1] as string;
        if (!inputIds.has(id)) {
          add(
            `Server "${name}" references "\${input:${id}}" but no input with id "${id}" is declared in "inputs".`,
            base,
            `${k}:undefined-input:${id}`,
          );
        }
      }
    }
  }
  return findings;
}

function validateUrl(
  url: string,
  transport: 'http' | 'sse' | 'ws',
  name: string,
  path: JsonPath,
  k: string,
  add: (message: string, path: JsonPath, key: string) => void,
): void {
  // URLs built from variables cannot be validated statically.
  if (url.includes('${')) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    add(`Server "${name}" has an invalid URL.`, path, `${k}:invalid-url`);
    return;
  }
  const allowed = transport === 'ws' ? ['ws:', 'wss:'] : ['http:', 'https:'];
  if (!allowed.includes(parsed.protocol)) {
    add(
      `Server "${name}" uses URL scheme "${parsed.protocol}" which does not match transport "${transport}" (expected ${allowed.join(' or ')}).`,
      path,
      `${k}:url-scheme`,
    );
  }
}

export const invalidMcp: Rule = {
  id: 'ACD005',
  name: 'invalid-mcp-config',
  title: 'Invalid MCP configuration',
  severity: 'medium',
  description:
    'Validates .mcp.json, .cursor/mcp.json and .vscode/mcp.json: JSON syntax, the top-level servers object, field types, transport types, conflicting command/url definitions, malformed commands and URLs, env mappings, and (VS Code) undefined ${input:...} references.',
  appliesTo: ['claude-mcp', 'cursor-mcp', 'vscode-mcp'],
  why: 'Invalid definitions fail to load (often silently) or load differently from what the author intended, which hides servers from review or breaks the tool chain.',
  remediation:
    'Fix the field as described. See docs/supported-formats.md for the documented structure of each file.',
  check(ctx) {
    return ctx.documents.filter(isMcpDocument).flatMap(validateDocument);
  },
};
