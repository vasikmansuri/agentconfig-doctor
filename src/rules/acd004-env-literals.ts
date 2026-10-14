import type { ConfigDocument, JsonPath } from '../types/index.js';
import {
  findSecrets,
  isPlaceholderValue,
  isVariableReference,
  redactLiteral,
} from '../util/secrets.js';
import { isRecord } from '../util/text.js';
import { getMcpServers } from './mcp-model.js';
import { getSettings } from './settings-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

/** Name segments that indicate a value is sensitive. `PWD` (working directory) is deliberately absent. */
const SENSITIVE_NAME =
  /(?:^|[_-])(?:API[_-]?KEY|APIKEY|ACCESS[_-]?KEY|SECRET[_-]?KEY|PRIVATE[_-]?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?|AUTH|CLIENT[_-]?SECRET|SESSION|COOKIE|DSN|CONNECTION[_-]?STRING|DATABASE[_-]?URL)S?(?:$|[_-])/i;
const SENSITIVE_HEADER =
  /^(?:authorization|proxy-authorization|cookie|x-[\w-]*(?:key|token|secret|auth)[\w-]*|api-key|apikey)$/i;
/** Names that look sensitive but conventionally hold non-secret data. */
const NON_SECRET_NAME =
  /(?:^|[_-])(?:KEY[_-]?ID|KEY[_-]?NAME|KEY[_-]?PATH|KEY[_-]?FILE|TOKEN[_-]?URL|AUTH[_-]?URL|AUTH[_-]?TYPE|AUTH[_-]?MODE)$/i;

const MIN_LITERAL_LENGTH = 8;

export function isSensitiveName(name: string, header = false): boolean {
  if (header) return SENSITIVE_HEADER.test(name);
  return SENSITIVE_NAME.test(name) && !NON_SECRET_NAME.test(name);
}

/** True when a value is a hard-coded literal worth reporting under a sensitive name. */
export function isReportableLiteral(value: string): boolean {
  if (value.trim().length < MIN_LITERAL_LENGTH) return false;
  if (isVariableReference(value) || isPlaceholderValue(value)) return false;
  if (/^(?:true|false|null|none|\d+)$/i.test(value.trim())) return false;
  // Values matching a known credential format are reported by ACD001 instead.
  return findSecrets(value).length === 0;
}

export const envLiterals: Rule = {
  id: 'ACD004',
  name: 'hardcoded-env-secret',
  title: 'Hard-coded value in sensitive environment variable or header',
  severity: 'high',
  description:
    'Flags literal values assigned to sensitively named environment variables (..._TOKEN, ..._API_KEY, PASSWORD, ...) and authentication headers in MCP server definitions and Claude Code "env" settings. References such as ${API_KEY}, ${env:API_KEY} and ${input:api-key} are not flagged.',
  appliesTo: ['claude-mcp', 'cursor-mcp', 'vscode-mcp', 'claude-settings'],
  why: 'A literal value under a sensitive name is very likely a credential that is now stored in the repository, shared with every collaborator, and visible to the agent.',
  remediation:
    'Replace the literal with a variable reference (Claude Code: "${API_KEY}"; Cursor: "${env:API_KEY}"; VS Code: "${input:api-key}" with an "inputs" entry using "password": true) and rotate the credential if the file was ever committed.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    const inspect = (
      doc: ConfigDocument,
      map: Record<string, unknown>,
      basePath: JsonPath,
      owner: string,
      header: boolean,
    ) => {
      for (const [name, value] of Object.entries(map)) {
        if (typeof value !== 'string' || !isSensitiveName(name, header)) continue;
        // For headers like "Authorization: Bearer <x>", inspect the credential part.
        const credential = header ? value.replace(/^(?:Bearer|Basic|Token)\s+/i, '') : value;
        if (!isReportableLiteral(credential) || findSecrets(value).length > 0) continue;
        findings.push(
          findingFor(doc, {
            severity: 'high',
            confidence: 'medium',
            message: `${owner} sets ${header ? 'header' : 'variable'} "${name}" to a literal value instead of a variable reference.`,
            evidence: `${name} = ${redactLiteral(value)}`,
            location: doc.locate([...basePath, name]),
            key: `${basePath.join('.')}.${name}`,
          }),
        );
      }
    };

    for (const doc of ctx.documents) {
      for (const server of getMcpServers(doc)) {
        inspect(doc, server.env, [...server.path, 'env'], `MCP server "${server.name}"`, false);
        inspect(
          doc,
          server.headers,
          [...server.path, 'headers'],
          `MCP server "${server.name}"`,
          true,
        );
      }
      const settings = getSettings(doc);
      if (settings && isRecord(settings.env)) {
        inspect(doc, settings.env, ['env'], 'Settings "env"', false);
      }
    }
    return findings;
  },
};
