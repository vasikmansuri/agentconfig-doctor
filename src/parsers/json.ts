import {
  findNodeAtLocation,
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from 'jsonc-parser';
import type { ConfigKind, JsonDocument, JsonPath, ParseIssue } from '../types/index.js';
import { createOffsetLocator } from '../util/text.js';

export interface JsonParseOptions {
  /** Allow comments and trailing commas (JSONC). */
  jsonc: boolean;
}

export function parseJsonDocument(
  kind: ConfigKind,
  path: string,
  text: string,
  options: JsonParseOptions,
): JsonDocument {
  const locateOffset = createOffsetLocator(text);
  // Replace a leading BOM with a space so offsets stay aligned with `text`.
  const source = text.charCodeAt(0) === 0xfeff ? ` ${text.slice(1)}` : text;
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, {
    disallowComments: !options.jsonc,
    allowTrailingComma: options.jsonc,
    allowEmptyContent: false,
  });

  const parseErrors: ParseIssue[] = errors.map((e) => ({
    message: describeParseError(printParseErrorCode(e.error)),
    ...locateOffset(e.offset),
  }));
  if (source.trim() === '') {
    parseErrors.splice(0, parseErrors.length, { message: 'File is empty', line: 1, column: 1 });
  }

  const duplicateKeys: JsonDocument['duplicateKeys'] = [];
  if (tree) collectDuplicateKeys(tree, [], duplicateKeys, locateOffset);

  return {
    kind,
    path,
    text,
    format: 'json',
    value: tree && parseErrors.length === 0 ? (getNodeValue(tree) as unknown) : undefined,
    parseErrors,
    duplicateKeys,
    locateOffset,
    locate(jsonPath: JsonPath) {
      if (!tree) return undefined;
      const node = findNodeAtLocation(tree, jsonPath);
      if (!node) return undefined;
      // Point at the property key rather than the value when there is one.
      const anchor = node.parent?.type === 'property' ? node.parent : node;
      return locateOffset(anchor.offset);
    },
  };
}

function describeParseError(code: string): string {
  switch (code) {
    case 'InvalidCommentToken':
      return 'Comments are not allowed in this file format';
    case 'CommaExpected':
      return 'Expected a comma';
    case 'PropertyNameExpected':
      return 'Expected a property name (check for a trailing comma)';
    case 'ValueExpected':
      return 'Expected a value (check for a trailing comma)';
    case 'ColonExpected':
      return 'Expected a colon';
    case 'CloseBraceExpected':
      return 'Expected a closing brace "}"';
    case 'CloseBracketExpected':
      return 'Expected a closing bracket "]"';
    case 'EndOfFileExpected':
      return 'Unexpected content after the end of the JSON value';
    case 'UnexpectedEndOfComment':
    case 'UnexpectedEndOfString':
    case 'UnexpectedEndOfNumber':
      return 'Unexpected end of input';
    default:
      return `Invalid JSON (${code})`;
  }
}

function collectDuplicateKeys(
  node: Node,
  path: JsonPath,
  out: JsonDocument['duplicateKeys'],
  locateOffset: JsonDocument['locateOffset'],
): void {
  if (node.type === 'object') {
    const seen = new Set<string>();
    for (const prop of node.children ?? []) {
      const keyNode = prop.children?.[0];
      const valueNode = prop.children?.[1];
      if (!keyNode || typeof keyNode.value !== 'string') continue;
      const key = keyNode.value;
      if (seen.has(key)) out.push({ path, key, location: locateOffset(keyNode.offset) });
      seen.add(key);
      if (valueNode) collectDuplicateKeys(valueNode, [...path, key], out, locateOffset);
    }
  } else if (node.type === 'array') {
    (node.children ?? []).forEach((child, i) =>
      collectDuplicateKeys(child, [...path, i], out, locateOffset),
    );
  }
}
