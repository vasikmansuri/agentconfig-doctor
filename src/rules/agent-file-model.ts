import type { ConfigDocument, ConfigKind, SourceLocation, TextDocument } from '../types/index.js';

/**
 * Helpers for Claude Code skills (`.claude/skills/<name>/SKILL.md`), legacy
 * custom commands (`.claude/commands/**.md`) and subagents
 * (`.claude/agents/**.md`). Formats: https://code.claude.com/docs/en/skills
 * and https://code.claude.com/docs/en/sub-agents.
 */

export const AGENT_FILE_KINDS: readonly ConfigKind[] = [
  'claude-skill',
  'claude-command',
  'claude-agent',
];

/** Kinds whose body supports `!` dynamic context injection. */
const INJECTION_KINDS: readonly ConfigKind[] = ['claude-skill', 'claude-command'];

export function isAgentFile(doc: ConfigDocument): doc is TextDocument {
  return doc.format === 'text' && AGENT_FILE_KINDS.includes(doc.kind);
}

/**
 * True for skills, commands and subagents that come from a plugin directory
 * rather than `.claude/`. Claude Code ignores the `hooks`, `mcpServers` and
 * `permissionMode` fields of plugin subagents.
 */
export function isPluginComponent(doc: ConfigDocument): boolean {
  return isAgentFile(doc) && !doc.path.split('/').includes('.claude');
}

export function agentFileLabel(kind: ConfigKind): string {
  return kind === 'claude-skill' ? 'skill' : kind === 'claude-command' ? 'command' : 'subagent';
}

export interface LocatedCommand {
  command: string;
  /** Character offset of the command in the document text. */
  index: number;
  /** Range of the whole construct, used to keep prose matching from reporting it twice. */
  range: [number, number];
}

/** Offset just after the closing `---` of the frontmatter, or 0. */
function bodyStart(doc: TextDocument): number {
  if (!doc.frontmatter?.terminated) return 0;
  const m = /^\ufeff?---[^\n]*\n[\s\S]*?^---[^\S\n]*(?:\n|$)/m.exec(doc.text);
  return m ? m[0].length : 0;
}

/**
 * Commands that Claude Code runs while rendering a skill or command, before
 * the model sees it: `` !`cmd` `` at the start of a line or after whitespace,
 * and fenced blocks opened with ```` ```! ````. They do not prompt; they run
 * when the skill's `allowed-tools` (or the permission rules) allow them.
 */
export function injectedCommands(doc: ConfigDocument): LocatedCommand[] {
  if (doc.format !== 'text' || !INJECTION_KINDS.includes(doc.kind)) return [];
  const start = bodyStart(doc);
  const body = doc.text.slice(start);
  const found: LocatedCommand[] = [];

  const fenced = /^[^\S\n]*```![^\S\n]*\n([\s\S]*?)^[^\S\n]*```[^\S\n]*$/gm;
  for (const m of body.matchAll(fenced)) {
    const inner = m[1] ?? '';
    const offset = start + m.index + m[0].indexOf(inner);
    found.push({
      command: inner.replace(/\n$/, ''),
      index: offset,
      range: [start + m.index, start + m.index + m[0].length],
    });
  }

  const inline = /(^|[ \t])!`([^`\n]+)`/gm;
  for (const m of body.matchAll(inline)) {
    const lead = m[1] ?? '';
    const at = start + m.index + lead.length;
    if (found.some((f) => at >= f.range[0] && at < f.range[1])) continue;
    found.push({
      command: (m[2] ?? '').trim(),
      index: at + 2,
      range: [at, at + m[0].length - lead.length],
    });
  }
  return found.sort((a, b) => a.index - b.index);
}

export interface FrontmatterCommand {
  /** Top-level frontmatter field the command was found under (`hooks` or `mcpServers`). */
  field: string;
  command: string;
  location: SourceLocation;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
  return v;
}

/**
 * `command:` values inside the `hooks` and `mcpServers` frontmatter blocks.
 * Frontmatter YAML is not fully parsed, so this reads `command:` lines only.
 */
export function frontmatterCommands(doc: ConfigDocument): FrontmatterCommand[] {
  if (!isAgentFile(doc)) return [];
  if (doc.kind === 'claude-agent' && isPluginComponent(doc)) return [];
  const out: FrontmatterCommand[] = [];
  for (const field of ['hooks', 'mcpServers']) {
    for (const line of doc.frontmatter?.blocks?.[field] ?? []) {
      const m = /^(\s*(?:-\s+)?)command\s*:\s*(\S.*)$/.exec(line.text);
      if (!m) continue;
      const command = unquote(m[2] ?? '');
      if (command === '' || command === '|' || command === '>') continue;
      out.push({ field, command, location: { line: line.line, column: (m[1]?.length ?? 0) + 1 } });
    }
  }
  return out;
}

/**
 * Splits a tool list that may be comma- or space-separated, without splitting
 * inside a permission specifier: `Read Bash(git log *), Grep`.
 */
export function splitToolList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim());
  }
  if (typeof value !== 'string') return [];
  const tools: string[] = [];
  let current = '';
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (current.trim() !== '') tools.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') tools.push(current.trim());
  return tools;
}

/** Tools a skill or command pre-approves while it is active (`allowed-tools`). */
export function allowedTools(doc: ConfigDocument): string[] {
  if (doc.format !== 'text' || !INJECTION_KINDS.includes(doc.kind)) return [];
  return splitToolList(doc.frontmatter?.fields['allowed-tools']);
}

/** Location of a top-level frontmatter field, for findings about it. */
export function frontmatterFieldLocation(
  doc: TextDocument,
  field: string,
): SourceLocation | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^${escaped}\\s*:`, 'm').exec(doc.text);
  return m ? doc.locateOffset(m.index) : undefined;
}
