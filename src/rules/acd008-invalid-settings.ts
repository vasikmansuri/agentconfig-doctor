import type { JsonDocument, JsonPath, TextDocument } from '../types/index.js';
import { isRecord } from '../util/text.js';
import { getMcpServers } from './mcp-model.js';
import {
  isSettingsDocument,
  parsePermissionRule,
  projectDirOf,
  stringsAt,
} from './settings-model.js';
import { findingFor, type Rule, type RuleContext, type RuleFinding } from './types.js';

/** Documented Claude Code permission modes (`manual` is an accepted alias of `default`). */
export const PERMISSION_MODES = [
  'default',
  'manual',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
];

type Level = 'medium' | 'low' | 'info';

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

function validateSettings(doc: JsonDocument, ctx: RuleContext): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const add = (
    message: string,
    path: JsonPath,
    key: string,
    severity: Level = 'medium',
    extra: { why?: string; remediation?: string } = {},
  ) =>
    findings.push(
      findingFor(doc, {
        severity,
        confidence: 'high',
        message,
        location: doc.locate(path) ?? { line: 1, column: 1 },
        key,
        ...extra,
      }),
    );

  if (doc.parseErrors.length > 0) {
    for (const error of doc.parseErrors.slice(0, 5)) {
      findings.push(
        findingFor(doc, {
          severity: 'medium',
          confidence: 'high',
          message: `Invalid JSON: ${error.message}. Claude Code will not apply this settings file as written.`,
          location: { line: error.line, column: error.column },
          key: `parse:${error.message}`,
        }),
      );
    }
    return findings;
  }
  const settings = doc.value;
  if (!isRecord(settings)) {
    add(`Settings must be a JSON object, got ${describeValue(settings)}.`, [], 'root-type');
    return findings;
  }

  const expectStringArray = (path: JsonPath, label: string) => {
    let node: unknown = settings;
    for (const seg of path) node = isRecord(node) ? node[seg as string] : undefined;
    if (node === undefined) return;
    if (!Array.isArray(node)) {
      add(
        `"${label}" must be an array of strings, got ${describeValue(node)}.`,
        path,
        `type:${label}`,
      );
      return;
    }
    node.forEach((item, i) => {
      if (typeof item !== 'string') {
        add(
          `"${label}[${i}]" must be a string, got ${describeValue(item)}.`,
          [...path, i],
          `type:${label}[${i}]`,
        );
      }
    });
  };

  const permissions = settings.permissions;
  if (permissions !== undefined && !isRecord(permissions)) {
    add(
      `"permissions" must be an object, got ${describeValue(permissions)}.`,
      ['permissions'],
      'type:permissions',
    );
  } else if (isRecord(permissions)) {
    for (const list of ['allow', 'ask', 'deny'] as const) {
      expectStringArray(['permissions', list], `permissions.${list}`);
      for (const entry of stringsAt(settings, ['permissions', list])) {
        const rule = parsePermissionRule(entry.value);
        if (!rule) {
          add(
            `Permission rule "${entry.value}" is malformed. Expected "Tool" or "Tool(specifier)".`,
            entry.path,
            `rule:${list}:${entry.value}`,
          );
          continue;
        }
        if (rule.tool.startsWith('mcp__') && rule.specifier !== undefined) {
          add(
            `Permission rule "${entry.value}" uses parentheses on an MCP tool. Claude Code skips such rules when loading settings.`,
            entry.path,
            `rule:${list}:${entry.value}:mcp-parens`,
            'medium',
            { remediation: 'Use "mcp__server" or "mcp__server__tool" without parentheses.' },
          );
        }
        if (
          rule.specifier !== undefined &&
          /^(?:command|file_path|path|url|notebook_path):/.test(rule.specifier.trim())
        ) {
          add(
            `Permission rule "${entry.value}" matches a primary content field with "field:" syntax, which Claude Code ignores because it is bypassable.`,
            entry.path,
            `rule:${list}:${entry.value}:field-syntax`,
            'medium',
            {
              remediation:
                'Use the direct form instead, e.g. "Bash(rm *)", "Read(./path)" or "WebFetch(domain:example.com)".',
            },
          );
        }
      }
    }
    const allow = new Set(stringsAt(settings, ['permissions', 'allow']).map((e) => e.value));
    for (const entry of stringsAt(settings, ['permissions', 'deny'])) {
      if (allow.has(entry.value)) {
        add(
          `Rule "${entry.value}" appears in both "allow" and "deny". Deny takes precedence, so the allow entry has no effect.`,
          entry.path,
          `conflict:${entry.value}`,
          'low',
        );
      }
    }
    expectStringArray(
      ['permissions', 'additionalDirectories'],
      'permissions.additionalDirectories',
    );
    const mode = permissions.defaultMode;
    if (mode !== undefined) {
      if (typeof mode !== 'string' || !PERMISSION_MODES.includes(mode)) {
        add(
          `"permissions.defaultMode" is ${typeof mode === 'string' ? `"${mode}"` : describeValue(mode)}; expected one of ${PERMISSION_MODES.join(', ')}.`,
          ['permissions', 'defaultMode'],
          'defaultMode:unknown',
        );
      } else if (mode === 'bypassPermissions' || mode === 'auto') {
        add(
          `"permissions.defaultMode" is "${mode}" in a project settings file. Current Claude Code versions ignore this value from project and local settings, but older versions (before v2.1.257 for bypassPermissions) applied it.`,
          ['permissions', 'defaultMode'],
          `defaultMode:${mode}`,
          'medium',
          {
            why: 'A committed settings file that tries to disable permission prompts for everyone who opens the repository is a red flag, and it takes effect on older clients.',
            remediation:
              'Remove defaultMode from project settings; choose a mode per session or in user settings.',
          },
        );
      }
    }
  }

  if (
    'enableAllProjectMcpServers' in settings &&
    typeof settings.enableAllProjectMcpServers !== 'boolean'
  ) {
    add(
      `"enableAllProjectMcpServers" must be true or false, got ${describeValue(settings.enableAllProjectMcpServers)}.`,
      ['enableAllProjectMcpServers'],
      'type:enableAllProjectMcpServers',
    );
  }
  expectStringArray(['enabledMcpjsonServers'], 'enabledMcpjsonServers');
  expectStringArray(['disabledMcpjsonServers'], 'disabledMcpjsonServers');
  const enabled = stringsAt(settings, ['enabledMcpjsonServers']);
  const disabled = new Set(stringsAt(settings, ['disabledMcpjsonServers']).map((e) => e.value));
  for (const entry of enabled) {
    if (disabled.has(entry.value)) {
      add(
        `Server "${entry.value}" is listed in both enabledMcpjsonServers and disabledMcpjsonServers.`,
        entry.path,
        `mcp-conflict:${entry.value}`,
        'low',
      );
    }
  }
  const projectDir = projectDirOf(doc.path);
  const mcpPath = projectDir ? `${projectDir}/.mcp.json` : '.mcp.json';
  const mcpDoc = ctx.documents.find((d) => d.path === mcpPath && d.kind === 'claude-mcp');
  if (mcpDoc && mcpDoc.format === 'json' && mcpDoc.parseErrors.length === 0) {
    const known = new Set(getMcpServers(mcpDoc).map((s) => s.name));
    for (const entry of enabled) {
      if (!known.has(entry.value)) {
        add(
          `enabledMcpjsonServers references "${entry.value}", which is not defined in ${mcpPath}.`,
          entry.path,
          `mcp-unknown:${entry.value}`,
          'low',
        );
      }
    }
  }

  if (settings.env !== undefined) {
    if (!isRecord(settings.env)) {
      add(
        `"env" must be an object of string values, got ${describeValue(settings.env)}.`,
        ['env'],
        'type:env',
      );
    } else {
      for (const [name, value] of Object.entries(settings.env)) {
        if (typeof value !== 'string') {
          add(
            `"env.${name}" must be a string, got ${describeValue(value)}.`,
            ['env', name],
            `type:env.${name}`,
          );
        }
      }
    }
  }

  if (settings.hooks !== undefined) {
    if (!isRecord(settings.hooks)) {
      add(
        `"hooks" must be an object keyed by event name, got ${describeValue(settings.hooks)}.`,
        ['hooks'],
        'type:hooks',
      );
    } else {
      for (const [event, groups] of Object.entries(settings.hooks)) {
        if (!Array.isArray(groups)) {
          add(
            `"hooks.${event}" must be an array of matcher groups.`,
            ['hooks', event],
            `hooks:${event}`,
          );
          continue;
        }
        groups.forEach((group, gi) => {
          if (!isRecord(group) || !Array.isArray(group.hooks)) {
            add(
              `"hooks.${event}[${gi}]" must be an object with a "hooks" array.`,
              ['hooks', event, gi],
              `hooks:${event}:${gi}`,
            );
            return;
          }
          group.hooks.forEach((hook, hi) => {
            const p: JsonPath = ['hooks', event, gi, 'hooks', hi];
            if (!isRecord(hook) || typeof hook.type !== 'string') {
              add(
                `"hooks.${event}[${gi}].hooks[${hi}]" must be an object with a string "type".`,
                p,
                `hooks:${event}:${gi}:${hi}`,
              );
            } else if (
              hook.type === 'command' &&
              (typeof hook.command !== 'string' || hook.command.trim() === '')
            ) {
              add(
                `Command hook "hooks.${event}[${gi}].hooks[${hi}]" has no "command".`,
                p,
                `hooks:${event}:${gi}:${hi}:command`,
              );
            }
          });
        });
      }
    }
  }

  if (
    isRecord(settings.sandbox) &&
    'enabled' in settings.sandbox &&
    typeof settings.sandbox.enabled !== 'boolean'
  ) {
    add('"sandbox.enabled" must be true or false.', ['sandbox', 'enabled'], 'type:sandbox.enabled');
  }
  return findings;
}

function validateCursorRule(doc: TextDocument): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const add = (
    message: string,
    line: number,
    key: string,
    severity: 'medium' | 'low',
    remediation?: string,
  ) =>
    findings.push(
      findingFor(doc, {
        severity,
        confidence: 'high',
        message,
        location: { line, column: 1 },
        key,
        remediation,
      }),
    );

  if (doc.path.endsWith('.md')) {
    add(
      'Plain .md files in .cursor/rules are ignored by Cursor; project rules must use the .mdc extension.',
      1,
      'md-extension',
      'low',
      'Rename the file to .mdc and add frontmatter (description, globs, alwaysApply).',
    );
    return findings;
  }
  const fm = doc.frontmatter;
  if (!fm?.present) {
    add(
      'Rule has no frontmatter, so it has no description, globs or alwaysApply setting and may never be applied.',
      1,
      'no-frontmatter',
      'low',
      'Add a frontmatter block with description, globs and alwaysApply between "---" lines.',
    );
    return findings;
  }
  for (const issue of fm.issues) {
    add(
      issue.message,
      issue.line,
      `frontmatter:${issue.message}`,
      fm.terminated ? 'low' : 'medium',
    );
  }
  const { alwaysApply, description, globs } = fm.fields;
  if (alwaysApply !== undefined && typeof alwaysApply !== 'boolean') {
    add('"alwaysApply" must be true or false.', 1, 'alwaysApply-type', 'medium');
  }
  const emptyList = (v: unknown) => Array.isArray(v) && v.length === 0;
  if (description !== undefined && typeof description !== 'string' && !emptyList(description)) {
    add('"description" must be a string.', 1, 'description-type', 'low');
  }
  if (
    globs !== undefined &&
    globs !== null &&
    typeof globs !== 'string' &&
    !(Array.isArray(globs) && globs.every((g) => typeof g === 'string'))
  ) {
    add('"globs" must be a comma-separated string or a list of strings.', 1, 'globs-type', 'low');
  }
  return findings;
}

export const invalidSettings: Rule = {
  id: 'ACD008',
  name: 'invalid-settings',
  title: 'Missing or invalid setting',
  severity: 'medium',
  description:
    'Validates Claude Code .claude/settings.json and settings.local.json (JSON syntax, permission rule syntax and lists, defaultMode values, MCP approval lists, env, hooks, sandbox) and Cursor .cursor/rules files (extension, frontmatter structure and field types).',
  appliesTo: ['claude-settings', 'cursor-rule'],
  why: 'Invalid settings are skipped or misinterpreted by the client, so the protection or behaviour the author expected is not what actually runs.',
  remediation:
    'Correct the value as described. See docs/supported-formats.md for the documented fields.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    for (const doc of ctx.documents) {
      if (isSettingsDocument(doc)) findings.push(...validateSettings(doc, ctx));
      else if (doc.kind === 'cursor-rule' && doc.format === 'text') {
        findings.push(...validateCursorRule(doc));
      }
    }
    return findings;
  },
};
