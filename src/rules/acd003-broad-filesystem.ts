import type { ConfigDocument, JsonPath, Severity } from '../types/index.js';
import { truncate } from '../util/text.js';
import { basenameOf, getMcpServers } from './mcp-model.js';
import { classifyBroadPath, normalisePath, type BroadPath } from './paths.js';
import { getSettings, parsePermissionRule, stringsAt } from './settings-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

const SEVERITY_BY_BREADTH: Record<BroadPath['breadth'], Severity> = {
  root: 'high',
  home: 'high',
  sensitive: 'high',
  system: 'medium',
};

interface IndexedArg {
  value: string;
  index: number;
}

/** Extracts host-side paths from docker `-v src:dst` / `--mount source=...` arguments. */
function dockerMountSources(args: readonly string[]): IndexedArg[] {
  const out: IndexedArg[] = [];
  args.forEach((arg, i) => {
    let spec: string | undefined;
    let index = i;
    if (['-v', '--volume', '--mount'].includes(arg) && args[i + 1] !== undefined) {
      spec = args[i + 1];
      index = i + 1;
    } else if (/^(?:-v|--volume|--mount)=/.test(arg)) {
      spec = arg.slice(arg.indexOf('=') + 1);
    }
    if (spec === undefined) return;
    const mount = /(?:^|,)(?:source|src)=([^,]+)/.exec(spec);
    if (mount?.[1]) {
      out.push({ value: mount[1], index });
      return;
    }
    const drive = /^[A-Za-z]:[\\/]/.test(spec) ? spec.slice(0, 2) : '';
    const rest = spec.slice(drive.length);
    out.push({ value: drive + (rest.split(':')[0] ?? ''), index });
  });
  return out;
}

/** Path-like values in plain args, including `--flag=/path` forms. */
function pathArgs(args: readonly string[]): IndexedArg[] {
  return args.flatMap((arg, index) => {
    const value = /^--?[\w-]+=/.test(arg) ? arg.slice(arg.indexOf('=') + 1) : arg;
    return normalisePath(value) === undefined ? [] : [{ value, index }];
  });
}

export const broadFilesystem: Rule = {
  id: 'ACD003',
  name: 'broad-filesystem-access',
  title: 'Broad filesystem access',
  severity: 'high',
  description:
    'Flags MCP server arguments and docker mounts that expose the filesystem root, a whole home directory, credential locations (~/.ssh, ~/.aws, ...) or system directories, and Claude Code settings (additionalDirectories, Read/Edit allow rules, sandbox allowWrite/allowRead) that grant the same.',
  appliesTo: ['claude-mcp', 'cursor-mcp', 'vscode-mcp', 'claude-settings'],
  why: 'An agent or MCP server with access to these locations can read SSH keys, cloud credentials and other projects, and a prompt-injected agent can exfiltrate or modify them. This is an observed setting, not a proven exploit.',
  remediation:
    'Grant access to the project directory (or a specific sub-directory) instead. If broad access is intentional, add the exact path to "allowedPaths" in an agentconfig-doctor config file passed with --config.',
  check(ctx) {
    const allowed = new Set(ctx.config.allowedPaths.map((p) => normalisePath(p) ?? p.trim()));
    const findings: RuleFinding[] = [];
    const report = (
      doc: ConfigDocument,
      raw: string,
      path: JsonPath,
      subject: string,
      keyPrefix: string,
      confidence: 'high' | 'medium' = 'high',
    ) => {
      const broad = classifyBroadPath(raw);
      if (!broad || allowed.has(broad.normalised)) return;
      findings.push(
        findingFor(doc, {
          severity: SEVERITY_BY_BREADTH[broad.breadth],
          confidence,
          message: `${subject} grants access to ${broad.label} (${broad.normalised}).`,
          evidence: truncate(raw, 120),
          location: doc.locate(path),
          key: `${keyPrefix}:${broad.normalised}`,
        }),
      );
    };

    for (const doc of ctx.documents) {
      for (const server of getMcpServers(doc)) {
        if (server.command === undefined) continue;
        const isContainer = ['docker', 'podman'].includes(basenameOf(server.command));
        const mounts = isContainer ? dockerMountSources(server.args) : [];
        const mountIndexes = new Set(mounts.map((m) => m.index));
        for (const m of mounts) {
          report(
            doc,
            m.value,
            [...server.path, 'args', m.index],
            `MCP server "${server.name}" container mount`,
            `mcp:${server.name}:mount`,
          );
        }
        for (const a of pathArgs(server.args)) {
          if (mountIndexes.has(a.index)) continue;
          report(
            doc,
            a.value,
            [...server.path, 'args', a.index],
            `MCP server "${server.name}" argument`,
            `mcp:${server.name}:arg`,
            'medium',
          );
        }
      }

      const settings = getSettings(doc);
      if (!settings) continue;
      for (const entry of stringsAt(settings, ['permissions', 'additionalDirectories'])) {
        report(
          doc,
          entry.value,
          entry.path,
          'permissions.additionalDirectories',
          'additionalDirectories',
        );
      }
      for (const entry of stringsAt(settings, ['permissions', 'allow'])) {
        const rule = parsePermissionRule(entry.value);
        if (!rule?.specifier || !/^(?:Read|Edit|Write|Glob|Grep)$/.test(rule.tool)) continue;
        // Claude Code: "//path" is absolute and "~/path" is home-relative;
        // "/path" and "./path" are relative to the settings source and are not broad.
        const spec = rule.specifier.trim();
        const candidate = spec.startsWith('//')
          ? spec.slice(1)
          : spec.startsWith('~')
            ? spec
            : undefined;
        if (candidate === undefined) continue;
        report(
          doc,
          candidate,
          entry.path,
          `Permission allow rule ${entry.value}`,
          `allow:${rule.tool}`,
        );
      }
      for (const key of ['allowWrite', 'allowRead'] as const) {
        for (const entry of stringsAt(settings, ['sandbox', 'filesystem', key])) {
          const value = entry.value.startsWith('//') ? entry.value.slice(1) : entry.value;
          report(doc, value, entry.path, `sandbox.filesystem.${key}`, `sandbox:${key}`);
        }
      }
    }
    return findings;
  },
};
