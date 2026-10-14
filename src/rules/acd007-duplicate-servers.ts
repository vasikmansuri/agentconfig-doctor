import { shortHash } from '../util/text.js';
import { getMcpServers, isMcpDocument, serversKey, type McpServer } from './mcp-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

function definitionHash(server: McpServer): string {
  return shortHash(
    JSON.stringify({
      transport: server.transport,
      command: server.command ?? null,
      args: server.args,
      url: server.url ?? null,
    }),
  );
}

export const duplicateServers: Rule = {
  id: 'ACD007',
  name: 'duplicate-server-names',
  title: 'Duplicate or conflicting MCP server name',
  severity: 'medium',
  description:
    'Detects server names defined twice in the same file (JSON duplicate keys, where only one definition takes effect), names that differ only by letter case within a file, and the same server name defined differently across the scanned MCP files.',
  appliesTo: ['claude-mcp', 'cursor-mcp', 'vscode-mcp'],
  why: 'With duplicate keys, reviewers may read one definition while the client silently uses another, which can hide a malicious or broken entry. Conflicting definitions across files mean different tools run different code under the same name.',
  remediation:
    'Keep a single definition per server name. Give genuinely different servers different names, and keep shared servers identical across .mcp.json, .cursor/mcp.json and .vscode/mcp.json.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    const mcpDocs = ctx.documents.filter(isMcpDocument);

    for (const doc of mcpDocs) {
      const key = serversKey(doc.kind);
      for (const dup of doc.duplicateKeys) {
        if (dup.path.length === 1 && dup.path[0] === key) {
          findings.push(
            findingFor(doc, {
              severity: 'medium',
              confidence: 'high',
              message: `Server "${dup.key}" is defined more than once in "${key}". JSON parsers keep only the last definition.`,
              location: dup.location,
              key: `duplicate-key:${dup.key}`,
            }),
          );
        }
      }
      const byLower = new Map<string, string[]>();
      for (const server of getMcpServers(doc)) {
        const lower = server.name.toLowerCase();
        byLower.set(lower, [...(byLower.get(lower) ?? []), server.name]);
      }
      for (const names of byLower.values()) {
        const unique = [...new Set(names)];
        if (unique.length > 1) {
          findings.push(
            findingFor(doc, {
              severity: 'low',
              confidence: 'medium',
              message: `Server names ${unique.map((n) => `"${n}"`).join(', ')} differ only by letter case.`,
              location: doc.locate([key, unique[1] as string]),
              key: `case-collision:${unique.join('|')}`,
            }),
          );
        }
      }
    }

    // Same name, different definition, across files.
    const byName = new Map<string, McpServer[]>();
    for (const server of mcpDocs.flatMap(getMcpServers)) {
      byName.set(server.name, [...(byName.get(server.name) ?? []), server]);
    }
    for (const [name, servers] of byName) {
      const files = new Set(servers.map((s) => s.doc.path));
      if (files.size < 2) continue;
      if (new Set(servers.map(definitionHash)).size < 2) continue;
      const first = servers[0] as McpServer;
      for (const server of servers.slice(1)) {
        if (server.doc.path === first.doc.path) continue;
        findings.push(
          findingFor(server.doc, {
            severity: 'low',
            confidence: 'medium',
            message: `Server "${name}" is defined differently here and in ${first.doc.path}.`,
            location: server.doc.locate(server.path),
            key: `cross-file:${name}`,
          }),
        );
      }
    }
    return findings;
  },
};
