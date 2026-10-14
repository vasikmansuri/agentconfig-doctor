import type { ConfigKind, JsonPath, Severity, SourceLocation } from '../types/index.js';
import { classifyPath } from '../discovery/classify.js';
import { EMPTY_SETTINGS_SNAPSHOT, type SettingsSnapshot } from '../baseline/snapshot.js';
import type { Rule, RuleFinding } from './types.js';

const PERMISSIVE_MODES = new Set(['acceptEdits', 'auto', 'bypassPermissions']);

type Push = (
  file: string,
  kind: ConfigKind,
  severity: Severity,
  message: string,
  key: string,
  location?: SourceLocation,
) => void;
type Locate = (file: string, path: JsonPath) => SourceLocation | undefined;

type ListField =
  | 'allow'
  | 'ask'
  | 'deny'
  | 'additionalDirectories'
  | 'enabledMcpjsonServers'
  | 'disabledMcpjsonServers';

interface ListSpec {
  field: ListField;
  path: JsonPath;
  label: string;
  addedSeverity: Severity;
  removedSeverity: Severity;
  addedText: string;
  removedText: string;
}

const LIST_SPECS: ListSpec[] = [
  {
    field: 'allow',
    path: ['permissions', 'allow'],
    label: 'Allow rule',
    addedSeverity: 'medium',
    removedSeverity: 'info',
    addedText: 'was added: matching actions now run without a prompt',
    removedText: 'was removed',
  },
  {
    field: 'ask',
    path: ['permissions', 'ask'],
    label: 'Ask rule',
    addedSeverity: 'info',
    removedSeverity: 'low',
    addedText: 'was added',
    removedText: 'was removed: matching actions may no longer prompt',
  },
  {
    field: 'deny',
    path: ['permissions', 'deny'],
    label: 'Deny rule',
    addedSeverity: 'info',
    removedSeverity: 'medium',
    addedText: 'was added',
    removedText: 'was removed: matching actions are no longer blocked',
  },
  {
    field: 'additionalDirectories',
    path: ['permissions', 'additionalDirectories'],
    label: 'Additional directory',
    addedSeverity: 'medium',
    removedSeverity: 'info',
    addedText: 'was added: the agent can now access it',
    removedText: 'was removed',
  },
  {
    field: 'enabledMcpjsonServers',
    path: ['enabledMcpjsonServers'],
    label: 'Approved project MCP server',
    addedSeverity: 'medium',
    removedSeverity: 'info',
    addedText: 'was added to enabledMcpjsonServers',
    removedText: 'was removed from enabledMcpjsonServers',
  },
  {
    field: 'disabledMcpjsonServers',
    path: ['disabledMcpjsonServers'],
    label: 'Rejected project MCP server',
    addedSeverity: 'info',
    removedSeverity: 'medium',
    addedText: 'was added to disabledMcpjsonServers',
    removedText: 'was removed from disabledMcpjsonServers and may now be started',
  },
];

function diffSettings(
  file: string,
  before: SettingsSnapshot,
  after: SettingsSnapshot,
  gone: string,
  push: Push,
  locate: Locate,
): void {
  const kind: ConfigKind = 'claude-settings';
  const missingFrom = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));

  for (const spec of LIST_SPECS) {
    for (const value of missingFrom(before[spec.field], after[spec.field])) {
      const index = after[spec.field].indexOf(value);
      push(
        file,
        kind,
        spec.addedSeverity,
        `${spec.label} "${value}" ${spec.addedText}.`,
        `${spec.field}-added:${value}`,
        locate(file, [...spec.path, index]) ?? locate(file, spec.path),
      );
    }
    for (const value of missingFrom(after[spec.field], before[spec.field])) {
      push(
        file,
        kind,
        spec.removedSeverity,
        `${spec.label} "${value}" ${spec.removedText}${gone}.`,
        `${spec.field}-removed:${value}`,
      );
    }
  }

  if (before.defaultMode !== after.defaultMode) {
    const loosened = after.defaultMode !== undefined && PERMISSIVE_MODES.has(after.defaultMode);
    push(
      file,
      kind,
      loosened ? 'medium' : 'info',
      `permissions.defaultMode changed from ${before.defaultMode ?? '(unset)'} to ${after.defaultMode ?? '(unset)'}${gone}.`,
      `defaultMode:${before.defaultMode ?? ''}->${after.defaultMode ?? ''}`,
      locate(file, ['permissions', 'defaultMode']),
    );
  }
  if (before.enableAllProjectMcpServers !== true && after.enableAllProjectMcpServers === true) {
    push(
      file,
      kind,
      'high',
      'enableAllProjectMcpServers was turned on: every project MCP server now starts without approval.',
      'enableAll:on',
      locate(file, ['enableAllProjectMcpServers']),
    );
  } else if (
    before.enableAllProjectMcpServers === true &&
    after.enableAllProjectMcpServers !== true
  ) {
    push(file, kind, 'info', `enableAllProjectMcpServers was turned off${gone}.`, 'enableAll:off');
  }
  if (before.sandboxEnabled === true && after.sandboxEnabled !== true) {
    push(
      file,
      kind,
      'medium',
      `The Bash sandbox is no longer enabled${gone}.`,
      'sandbox:off',
      locate(file, ['sandbox']),
    );
  }
  for (const hook of missingFrom(before.hooks, after.hooks)) {
    const event = hook.split(':')[0] ?? 'unknown';
    push(
      file,
      kind,
      'medium',
      `A new or changed ${event} hook command was added; hooks run automatically.`,
      `hook-added:${hook}`,
      locate(file, ['hooks', event]),
    );
  }
  for (const hook of missingFrom(after.hooks, before.hooks)) {
    push(
      file,
      kind,
      'info',
      `A ${hook.split(':')[0] ?? ''} hook command was removed or changed${gone}.`,
      `hook-removed:${hook}`,
    );
  }
}

const sortedUnion = (a: string[], b: string[]) =>
  [...new Set([...a, ...b])].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

export const permissionChanges: Rule = {
  id: 'ACD009',
  name: 'permission-changes',
  title: 'Permission change since baseline',
  severity: 'high',
  description:
    'When a baseline is supplied (--baseline), reports permission-relevant changes: added allow rules, removed ask/deny rules, defaultMode changes, new additionalDirectories, MCP auto-approval and approval-list changes, the sandbox being disabled, new hook commands, and added or changed MCP server definitions. Tightening changes are reported as info.',
  appliesTo: ['claude-settings', 'claude-mcp', 'cursor-mcp', 'vscode-mcp'],
  requiresBaseline: true,
  why: 'Permission expansions are easy to miss in review. A change is not necessarily a vulnerability, but each one widens what the agent or its tools can do without asking.',
  remediation:
    'Review the change. If it is intended, update the baseline explicitly with "agentconfig-doctor baseline update".',
  check(ctx) {
    const baseline = ctx.baselinePermissions;
    if (!baseline) return [];
    const current = ctx.currentPermissions;
    const findings: RuleFinding[] = [];

    const locate: Locate = (file, path) => {
      const doc = ctx.documents.find((d) => d.path === file);
      return doc?.format === 'json' ? doc.locate(path) : undefined;
    };
    const push: Push = (file, kind, severity, message, key, location) =>
      findings.push({ file, kind, severity, confidence: 'high', message, key, location });

    for (const file of sortedUnion(Object.keys(baseline.settings), Object.keys(current.settings))) {
      const gone = current.settings[file] === undefined ? ' (settings file no longer present)' : '';
      diffSettings(
        file,
        baseline.settings[file] ?? EMPTY_SETTINGS_SNAPSHOT,
        current.settings[file] ?? EMPTY_SETTINGS_SNAPSHOT,
        gone,
        push,
        locate,
      );
    }

    for (const file of sortedUnion(
      Object.keys(baseline.mcpServers),
      Object.keys(current.mcpServers),
    )) {
      const kind = classifyPath(file) ?? 'claude-mcp';
      const before = baseline.mcpServers[file] ?? {};
      const after = current.mcpServers[file] ?? {};
      const key = kind === 'vscode-mcp' ? 'servers' : 'mcpServers';
      for (const name of Object.keys(after).sort()) {
        if (!(name in before)) {
          push(
            file,
            kind,
            'medium',
            `MCP server "${name}" was added since the baseline.`,
            `mcp-added:${name}`,
            locate(file, [key, name]),
          );
        } else if (before[name] !== after[name]) {
          push(
            file,
            kind,
            'medium',
            `MCP server "${name}" changed its command, arguments, URL or variable names since the baseline.`,
            `mcp-changed:${name}:${after[name]}`,
            locate(file, [key, name]),
          );
        }
      }
      for (const name of Object.keys(before).sort()) {
        if (!(name in after)) {
          push(
            file,
            kind,
            'info',
            `MCP server "${name}" was removed since the baseline.`,
            `mcp-removed:${name}`,
          );
        }
      }
    }
    return findings;
  },
};
