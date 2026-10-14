import { createHash } from 'node:crypto';
import type { SourceLocation } from '../types/index.js';

/** Returns a function that maps a character offset to a 1-based line/column. */
export function createOffsetLocator(text: string): (offset: number) => SourceLocation {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (lineStarts[lo] ?? 0) + 1 };
  };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Short stable hash used in fingerprints. */
export function shortHash(value: string): string {
  return sha256(value).slice(0, 16);
}

// C0/C1 controls (everything except tab), bidi overrides and invisible
// formatting characters. Matching control characters is the point here.
const UNSAFE_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u0008\\u000a-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]',
  'g',
);

/**
 * Escapes control characters (including ANSI escape introducers and newlines)
 * and Unicode bidi/invisible characters so untrusted strings cannot
 * manipulate a terminal or forge extra output lines.
 */
export function stripControlChars(value: string): string {
  return value.replace(UNSAFE_CHARS, (ch) => `\\u{${(ch.codePointAt(0) ?? 0).toString(16)}}`);
}

export function truncate(value: string, max = 160): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
