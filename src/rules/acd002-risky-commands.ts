import type { ConfigDocument, SourceLocation } from '../types/index.js';
import { scrubSecrets } from '../util/secrets.js';
import { isRecord, shortHash, truncate } from '../util/text.js';
import { isShellWrapper, matchCommandPatterns } from './command-patterns.js';
import { resolveInterpolation } from './interpolation.js';
import { commandLine, getMcpServers } from './mcp-model.js';
import { getSettings, hookCommands, parsePermissionRule, stringsAt } from './settings-model.js';
import {
  agentFileLabel,
  allowedTools,
  frontmatterCommands,
  injectedCommands,
  frontmatterFieldLocation,
} from './agent-file-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

interface CommandSource {
  text: string;
  /** Command line after static variable expansion, when it differs from text. */
  resolved?: string | undefined;
  label: string;
  key: string;
  /** Prose files are matched with reduced severity; location is derived per match. */
  prose: boolean;
  /** True for permission allow rules, which pre-approve rather than run a command. */
  allowRule?: boolean;
  location?: SourceLocation | undefined;
  /** Prose only: character ranges already reported as real commands. */
  exclude?: [number, number][];
  /** Overrides the rule's default explanation. */
  why?: string;
}

const INJECTION_WHY =
  'Claude Code runs this command while it loads the skill or command, before the model sees the text, and without a prompt when allowed-tools or the permission rules pre-approve it.';

const FRONTMATTER_COMMAND_WHY =
  "Commands in skill, command and subagent frontmatter run automatically while that file is active, with the developer's privileges.";

function lineRange(text: string, line: number): [number, number] {
  let start = 0;
  for (let i = 1; i < line; i++) {
    const next = text.indexOf('\n', start);
    if (next === -1) return [text.length, text.length];
    start = next + 1;
  }
  const end = text.indexOf('\n', start);
  return [start, end === -1 ? text.length : end];
}

function textCommandSources(doc: ConfigDocument & { format: 'text' }): CommandSource[] {
  const sources: CommandSource[] = [];
  const exclude: [number, number][] = [];
  const what = agentFileLabel(doc.kind);
  for (const c of injectedCommands(doc)) {
    sources.push({
      text: c.command,
      label: `dynamic context command in this ${what}`,
      key: `inject:${shortHash(c.command)}`,
      prose: false,
      location: doc.locateOffset(c.index),
      why: INJECTION_WHY,
    });
    exclude.push(c.range);
  }
  for (const c of frontmatterCommands(doc)) {
    sources.push({
      text: c.command,
      label: c.field === 'hooks' ? `${what} frontmatter hook` : `${what} frontmatter MCP server`,
      key: `frontmatter:${c.field}:${shortHash(c.command)}`,
      prose: false,
      location: c.location,
      why: FRONTMATTER_COMMAND_WHY,
    });
    exclude.push(lineRange(doc.text, c.location.line));
  }
  for (const tool of allowedTools(doc)) {
    const rule = parsePermissionRule(tool);
    if (!rule?.specifier || !/^(?:Bash|PowerShell)$/.test(rule.tool)) continue;
    sources.push({
      text: rule.specifier,
      label: `allowed-tools entry ${tool}`,
      key: `allowed-tools:${tool}`,
      prose: false,
      allowRule: true,
      location: frontmatterFieldLocation(doc, 'allowed-tools'),
    });
  }
  sources.push({ text: doc.text, label: 'instruction text', key: 'text', prose: true, exclude });
  return sources;
}

function commandSources(doc: ConfigDocument): CommandSource[] {
  if (doc.format === 'text') return textCommandSources(doc);
  const sources: CommandSource[] = [];
  for (const server of getMcpServers(doc)) {
    if (server.command !== undefined) {
      const text = commandLine(server);
      const resolved = resolveInterpolation(text, doc.kind);
      sources.push({
        text,
        resolved: resolved === text ? undefined : resolved,
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
    'Statically analyses commands in MCP server definitions, Claude Code hooks, apiKeyHelper/statusLine/headersHelper commands, Bash permission allow rules, dynamic context commands and frontmatter hooks in Claude Code skills, commands and subagents, and agent instruction files for dangerous patterns such as download-and-execute, destructive deletion, reverse shells, and obfuscated payloads.',
  appliesTo: [
    'claude-mcp',
    'cursor-mcp',
    'vscode-mcp',
    'claude-settings',
    'cursor-rule',
    'instructions',
    'claude-skill',
    'claude-command',
    'claude-agent',
  ],
  why: "These commands run automatically on a developer machine with the developer's privileges, often without a prompt. A malicious or careless command in a shared config runs for everyone who opens the project.",
  remediation:
    'Replace the command with a pinned, reviewed executable or package. Avoid piping downloads into a shell, avoid recursive deletes of broad paths, and never decode-and-execute payloads. If the command is intentional, document why and suppress the finding by fingerprint.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    for (const doc of ctx.documents) {
      for (const source of commandSources(doc)) {
        const resolvedCommand = source.resolved
          ? truncate(scrubSecrets(source.resolved), 300)
          : undefined;
        const rawIds = new Set(matchCommandPatterns(source.text).map((m) => m.pattern.id));
        const matches = [
          ...matchCommandPatterns(source.text).map((m) => ({ ...m, expanded: false })),
          ...(source.resolved ? matchCommandPatterns(source.resolved) : [])
            .filter((m) => !rawIds.has(m.pattern.id))
            .map((m) => ({ ...m, expanded: true })),
        ];
        for (const match of matches) {
          if (source.exclude?.some(([from, to]) => match.index >= from && match.index < to)) {
            continue;
          }
          const severity = source.prose ? match.pattern.proseSeverity : match.pattern.severity;
          const action = source.allowRule
            ? `pre-approves a command that ${match.pattern.reason}`
            : source.prose
              ? `contains a command that ${match.pattern.reason}`
              : `runs a command that ${match.pattern.reason}`;
          const after = match.expanded ? ' after variable expansion' : '';
          findings.push(
            findingFor(doc, {
              severity,
              confidence: source.prose ? 'low' : 'high',
              message: `${capitalise(source.label)} ${action}${after}.`,
              evidence: truncate(scrubSecrets(match.text), 120),
              resolvedCommand,
              location: source.prose ? doc.locateOffset(match.index) : source.location,
              key: `${source.key}:${match.pattern.id}${source.prose ? `:${shortHash(match.text)}` : ''}`,
              why: source.prose
                ? 'Agents follow instruction files, so a dangerous command in one may be executed by the agent. Documentation examples also match this pattern; review the surrounding text before acting.'
                : source.why,
            }),
          );
        }
      }
      for (const server of getMcpServers(doc)) {
        if (server.command && isShellWrapper(server.command, server.args)) {
          const text = commandLine(server);
          const resolved = resolveInterpolation(text, doc.kind);
          findings.push(
            findingFor(doc, {
              severity: 'low',
              confidence: 'medium',
              message: `MCP server "${server.name}" starts through an inline shell script (${server.command} with an inline-command flag).`,
              evidence: truncate(scrubSecrets(text), 120),
              resolvedCommand:
                resolved === text ? undefined : truncate(scrubSecrets(resolved), 300),
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
