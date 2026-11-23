import type { Frontmatter, ParseIssue } from '../types/index.js';

/**
 * Parses the small YAML subset used by Cursor `.mdc` rule frontmatter:
 * `key: value` scalars (strings, booleans, numbers), flow lists `[a, b]`,
 * and block lists (`- item`). Anything else is reported as an issue rather
 * than guessed at.
 */
export interface FrontmatterOptions {
  /**
   * Keep indented YAML that is not a plain list (nested maps, lists of maps)
   * as raw lines in `blocks` instead of reporting it. Used for Claude Code
   * skills, commands and subagents, whose `hooks` and `mcpServers` fields are
   * nested.
   */
  nested?: boolean;
}

export function parseFrontmatter(text: string, options: FrontmatterOptions = {}): Frontmatter {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/);
  const result: Frontmatter = { present: false, terminated: false, fields: {}, issues: [] };
  if (lines[0]?.trim() !== '---') return result;
  result.present = true;
  if (options.nested) result.blocks = {};

  let currentListKey: string | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trimEnd();
    if (line.trim() === '---') {
      result.terminated = true;
      return result;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    if (result.blocks && currentListKey !== undefined && /^\s/.test(line)) {
      // Inside a nested value: keep every line, and keep the plain list only
      // while each line is a "- scalar" item.
      const block = (result.blocks[currentListKey] ??= []);
      block.push({ text: line, line: i + 1 });
      const item = /^\s*-\s+(.*)$/.exec(line);
      const list = result.fields[currentListKey];
      if (item && Array.isArray(list) && !/^[\w-]+\s*:(?:\s|$)/.test(item[1] ?? '')) {
        list.push(parseScalar(item[1] ?? ''));
      } else {
        result.fields[currentListKey] = undefined;
      }
      continue;
    }

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentListKey !== undefined) {
      const list = result.fields[currentListKey];
      if (Array.isArray(list)) list.push(parseScalar(listItem[1] ?? ''));
      continue;
    }

    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      result.issues.push(issue(`Unrecognised frontmatter line: ${line.trim().slice(0, 60)}`, i));
      currentListKey = undefined;
      continue;
    }
    const key = kv[1] as string;
    const rawValue = (kv[2] ?? '').trim();
    if (rawValue === '') {
      // Either an empty value or the start of a block list.
      result.fields[key] = [];
      currentListKey = key;
      continue;
    }
    currentListKey = undefined;
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      result.fields[key] = inner === '' ? [] : splitFlowList(inner).map(parseScalar);
    } else {
      result.fields[key] = parseScalar(rawValue);
    }
  }
  result.issues.push(issue('Frontmatter is not closed with a "---" line', 0));
  return result;
}

function splitFlowList(inner: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = undefined;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current.trim());
  return parts;
}

function parseScalar(value: string): unknown {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function issue(message: string, lineIndex: number): ParseIssue {
  return { message, line: lineIndex + 1, column: 1 };
}
