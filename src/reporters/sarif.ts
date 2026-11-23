import { RULES, type Rule } from '../rules/index.js';
import type { Severity } from '../types/index.js';
import { TOOL_NAME, VERSION } from '../version.js';
import type { Report, ReportFinding } from './report.js';

/**
 * SARIF 2.1.0 output for GitHub code scanning and other SARIF consumers.
 * See docs/sarif.md for the field mapping.
 */

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const REPOSITORY = 'https://github.com/vasikmansuri/agentconfig-doctor';
const SRCROOT = '%SRCROOT%';

type SarifLevel = 'error' | 'warning' | 'note';

/** Finding severity to SARIF result level. */
export const SARIF_LEVEL: Record<Severity, SarifLevel> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'note',
  info: 'note',
};

/**
 * Rule severity to GitHub's `security-severity` score: above 9.0 is critical,
 * 7.0-8.9 high, 4.0-6.9 medium, 0.1-3.9 low. GitHub reads it per rule only.
 */
export const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: '9.5',
  high: '8.0',
  medium: '5.5',
  low: '3.0',
  info: '1.0',
};

const PRECISION = { high: 'high', medium: 'medium', low: 'low' } as const;

export interface SarifOptions {
  /**
   * POSIX path of the scan root relative to the repository root, prepended to
   * every file path. Empty when the scan root is the repository root.
   */
  pathPrefix?: string;
}

function ruleDescriptor(rule: Rule) {
  const helpUri = `${REPOSITORY}/blob/main/docs/rules.md#${rule.id.toLowerCase()}`;
  return {
    id: rule.id,
    name: rule.name,
    shortDescription: { text: rule.title },
    fullDescription: { text: rule.description },
    helpUri,
    help: {
      text: `${rule.why}\n\nFix: ${rule.remediation}`,
      markdown: `${rule.why}\n\n**Fix:** ${rule.remediation}\n\n[${rule.id} documentation](${helpUri})`,
    },
    defaultConfiguration: { level: SARIF_LEVEL[rule.severity] },
    properties: {
      tags: ['security'],
      'security-severity': SECURITY_SEVERITY[rule.severity],
    },
  };
}

function joinPath(prefix: string, file: string): string {
  const clean = prefix.replace(/^\.\/?/, '').replace(/\/+$/, '');
  return clean === '' ? file : `${clean}/${file}`;
}

/** Percent-encodes characters that are not valid in a relative URI reference. */
function toUri(posixPath: string): string {
  return posixPath.split('/').map(encodeURIComponent).join('/');
}

function messageText(f: ReportFinding): string {
  const parts = [f.message];
  if (f.evidence) parts.push(`Evidence: ${f.evidence}`);
  if (f.resolvedCommand) parts.push(`Resolved command: ${f.resolvedCommand}`);
  return parts.join('\n');
}

function result(f: ReportFinding, ruleIndex: number | undefined, prefix: string) {
  // GitHub requires a region on every result; file-level findings point at line 1.
  const startLine = f.line ?? 1;
  const startColumn = f.column ?? 1;
  const out: Record<string, unknown> = {
    ruleId: f.ruleId,
    ...(ruleIndex === undefined ? {} : { ruleIndex }),
    level: SARIF_LEVEL[f.severity],
    message: { text: messageText(f) },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: toUri(joinPath(prefix, f.file)), uriBaseId: SRCROOT },
          region: { startLine, startColumn, endLine: startLine, endColumn: startColumn + 1 },
        },
      },
    ],
    // GitHub matches alerts across runs by this key. Our fingerprint does not
    // depend on line numbers, so alerts survive edits elsewhere in the file.
    partialFingerprints: {
      primaryLocationLineHash: `${f.fingerprint}:1`,
      'agentconfigDoctor/v1': f.fingerprint,
    },
    properties: {
      severity: f.severity,
      precision: PRECISION[f.confidence],
      kind: f.kind,
    },
  };
  if (f.baseline) out['baselineState'] = f.baseline === 'new' ? 'new' : 'unchanged';
  return out;
}

export function renderSarif(report: Report, options: SarifOptions = {}): string {
  const prefix = options.pathPrefix ?? '';
  const index = new Map(RULES.map((rule, i) => [rule.id, i]));
  const sarif = {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            semanticVersion: VERSION,
            informationUri: REPOSITORY,
            rules: RULES.map(ruleDescriptor),
          },
        },
        originalUriBaseIds: {
          [SRCROOT]: { description: { text: 'The repository root.' } },
        },
        results: report.findings.map((f) => result(f, index.get(f.ruleId), prefix)),
        properties: {
          filesScanned: report.summary.filesScanned,
          filesSkipped: report.summary.filesSkipped,
          suppressed: report.summary.suppressed,
          notes: report.notes,
        },
      },
    ],
  };
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
