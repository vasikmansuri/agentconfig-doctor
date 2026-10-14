import type { ConfigDocument, SourceLocation } from '../types/index.js';
import { scrubSecrets } from '../util/secrets.js';
import { isRecord, shortHash, truncate } from '../util/text.js';
import { isShellWrapper, matchCommandPatterns } from './command-patterns.js';
import { commandLine, getMcpServers } from './mcp-model.js';
import { getSettings, hookCommands, parsePermissionRule, stringsAt } from './settings-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

interface CommandSource {
  text: string;
  label: string;
  key: string;
  /** Prose files are matched with reduced severity; location is derived per match. */
  prose: boolean;
  /** True for permission allow rules, which pre-approve rather than run a command. */
  allowRule?: boolean;
  location?: SourceLocation | undefined;
}

function commandSources(doc: ConfigDocument): CommandSource[] {
  if (doc.format === 'text') {
    return [{ text: doc.text, label: 'instruction text', key: 'text', prose: true }];
  }
  const sources: CommandSource[] = [];
  for (const server of getMcpServers(doc)) {
    if (server.command !== undefined) {
      sources.push({
        text: commandLine(server),
        label: `MCP server "${server.name}"`,
        key: `mcp:${server.name}`,
        prose: false,
        location: doc.locate(server.path),
      });
    }
    if (isRecord(server.def) && typeof server.def.headersHelper === 'string') {
      sources.push({
        text: server.def.headersHelper,
        label: `headersHelper of MCP server "${server.name}"`,
        key: `mcp:${server.name}:headersHelper`,
        prose: false,
        location: doc.locate([...server.path, 'headersHelper']),
      });
    }
  }
  const settings = getSettings(doc);
  if (settings) {
    for (const hook of hookCommands(settings)) {
      sources.push({
        text: hook.command,
        label: `${hook.event} hook`,
        key: `hook:${hook.path.join('.')}`,
        prose: false,
        location: doc.locate(hook.path),
      });
    }
    if (typeof settings.apiKeyHelper === 'string') {
      sources.push({
        text: settings.apiKeyHelper,
        label: 'apiKeyHelper',
        key: 'apiKeyHelper',
        prose: false,
        location: doc.locate(['apiKeyHelper']),
      });
    }
    if (isRecord(settings.statusLine) && typeof settings.statusLine.command === 'string') {
      sources.push({
        text: settings.statusLine.command,
        label: 'statusLine command',
        key: 'statusLine',
        prose: false,
        location: doc.locate(['statusLine', 'command']),
      });
    }
    for (const entry of stringsAt(settings, ['permissions', 'allow'])) {
      const rule = parsePermissionRule(entry.value);
      if (!rule?.specifier || !/^(?:Bash|PowerShell)$/.test(rule.tool)) continue;
      sources.push({
        text: rule.specifier,
        label: `permission allow rule ${entry.value}`,
        key: `allow:${entry.value}`,
        prose: false,
        allowRule: true,
        location: doc.locate(entry.path),
      });
    }
  }
  return sources;
}

export const riskyCommands: Rule = {
  id: 'ACD002',
  name: 'risky-commands',
  title: 'Risky command configuration',
  severity: 'critical',
  description:
    'Statically analyses commands in MCP server definitions, Claude Code hooks, apiKeyHelper/statusLine/headersHelper commands, Bash permission allow rules, and agent instruction files for dangerous patterns such as download-and-execute, destructive deletion, reverse shells, and obfuscated payloads.',
  appliesTo: [
    'claude-mcp',
    'cursor-mcp',
    'vscode-mcp',
    'claude-settings',
    'cursor-rule',
    'instructions',
  ],
  why: "These commands run automatically on a developer machine with the developer's privileges, often without a prompt. A malicious or careless command in a shared config runs for everyone who opens the project.",
  remediation:
    'Replace the command with a pinned, reviewed executable or package. Avoid piping downloads into a shell, avoid recursive deletes of broad paths, and never decode-and-execute payloads. If the command is intentional, document why and suppress the finding by fingerprint.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    for (const doc of ctx.documents) {
      for (const source of commandSources(doc)) {
        for (const match of matchCommandPatterns(source.text)) {
          const severity = source.prose ? match.pattern.proseSeverity : match.pattern.severity;
          const action = source.allowRule
            ? `pre-approves a command that ${match.pattern.reason}`
            : source.prose
              ? `contains a command that ${match.pattern.reason}`
              : `runs a command that ${match.pattern.reason}`;
          findings.push(
            findingFor(doc, {
              severity,
              confidence: source.prose ? 'low' : 'high',
              message: `${capitalise(source.label)} ${action}.`,
              evidence: truncate(scrubSecrets(match.text), 120),
              location: source.prose ? doc.locateOffset(match.index) : source.location,
              key: `${source.key}:${match.pattern.id}${source.prose ? `:${shortHash(match.text)}` : ''}`,
              why: source.prose
                ? 'Agents follow instruction files, so a dangerous command in one may be executed by the agent. Documentation examples also match this pattern; review the surrounding text before acting.'
                : undefined,
            }),
          );
        }
      }
      for (const server of getMcpServers(doc)) {
        if (server.command && isShellWrapper(server.command, server.args)) {
          findings.push(
            findingFor(doc, {
              severity: 'low',
              confidence: 'medium',
              message: `MCP server "${server.name}" starts through an inline shell script (${server.command} with an inline-command flag).`,
              evidence: truncate(scrubSecrets(commandLine(server)), 120),
              location: doc.locate(server.path),
              key: `mcp:${server.name}:shell-wrapper`,
              why: 'Shell wrappers hide the real executable inside a string, allow command chaining, and make reviews and allow-listing harder. This is common and not malicious by itself.',
              remediation:
                'Prefer invoking the server executable directly with "command" and "args". If a wrapper is needed, keep the script short and in a reviewed file.',
            }),
          );
        }
      }
    }
    return findings;
  },
};

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
