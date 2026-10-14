import type { ConfigDocument, ConfigKind, TextDocument } from '../types/index.js';
import { createOffsetLocator } from '../util/text.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseJsonDocument } from './json.js';

export { parseJsonDocument } from './json.js';
export { parseFrontmatter } from './frontmatter.js';

/**
 * Builds a document model for a discovered file. JSONC (comments, trailing
 * commas) is accepted only for VS Code's `.vscode/mcp.json`, which VS Code
 * documents as JSONC; the other JSON formats are parsed strictly.
 */
export function loadDocument(kind: ConfigKind, path: string, text: string): ConfigDocument {
  switch (kind) {
    case 'claude-mcp':
    case 'cursor-mcp':
    case 'claude-settings':
      return parseJsonDocument(kind, path, text, { jsonc: false });
    case 'vscode-mcp':
      return parseJsonDocument(kind, path, text, { jsonc: true });
    case 'cursor-rule':
    case 'instructions': {
      const doc: TextDocument = {
        kind,
        path,
        text,
        format: 'text',
        locateOffset: createOffsetLocator(text),
        locate: () => undefined,
      };
      if (kind === 'cursor-rule') doc.frontmatter = parseFrontmatter(text);
      return doc;
    }
  }
}
