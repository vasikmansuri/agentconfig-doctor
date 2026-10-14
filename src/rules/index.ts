import { exposedCredentials } from './acd001-exposed-credentials.js';
import { riskyCommands } from './acd002-risky-commands.js';
import { broadFilesystem } from './acd003-broad-filesystem.js';
import { envLiterals } from './acd004-env-literals.js';
import { invalidMcp } from './acd005-invalid-mcp.js';
import { suspiciousServers } from './acd006-suspicious-servers.js';
import { duplicateServers } from './acd007-duplicate-servers.js';
import { invalidSettings } from './acd008-invalid-settings.js';
import { permissionChanges } from './acd009-permission-changes.js';
import { riskyCombinations } from './acd010-risky-combinations.js';
import { hiddenUnicode } from './acd011-hidden-unicode.js';
import type { Rule } from './types.js';

/** All rules, in stable ID order. IDs are never reused or renumbered. */
export const RULES: readonly Rule[] = [
  exposedCredentials,
  riskyCommands,
  broadFilesystem,
  envLiterals,
  invalidMcp,
  suspiciousServers,
  duplicateServers,
  invalidSettings,
  permissionChanges,
  riskyCombinations,
  hiddenUnicode,
];

/** Rules used by `check-mcp`: structural validation only. */
export const MCP_VALIDATION_RULE_IDS: readonly string[] = ['ACD005', 'ACD007'];

export function getRule(id: string): Rule | undefined {
  return RULES.find((r) => r.id === id.toUpperCase());
}

export type { Rule, RuleContext, RuleFinding } from './types.js';
