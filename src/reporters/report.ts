import type { BaselineComparison, BaselineEntry } from '../baseline/baseline.js';
import type { ScanResult } from '../engine/scan.js';
import type { ConfigKind, Finding, Severity, SkippedFile } from '../types/index.js';
import { SEVERITIES, SEVERITY_RANK } from '../types/index.js';
import { scrubSecrets } from '../util/secrets.js';
import { TOOL_NAME, VERSION } from '../version.js';

export const REPORT_SCHEMA_VERSION = 1;

export type FailOn = Severity | 'none';

export interface ReportFinding extends Finding {
  /** Present when a baseline was supplied. */
  baseline?: 'new' | 'existing';
}

export interface Report {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: { name: string; version: string };
  /** The scan target as given on the command line. */
  target: string;
  summary: {
    filesScanned: number;
    filesSkipped: number;
    findings: number;
    bySeverity: Record<Severity, number>;
    suppressed: number;
    failOn: FailOn;
    /** True when at least one counted finding is at or above `failOn`. */
    failed: boolean;
    newFindings?: number;
    resolvedFindings?: number;
  };
  files: { path: string; kind: ConfigKind }[];
  skipped: SkippedFile[];
  findings: ReportFinding[];
  baseline?: { file: string; resolved: BaselineEntry[] };
  notes: string[];
}

export const DISCLAIMER =
  'Findings come from static, heuristic rules. A clean result means no implemented rule matched; it does not prove a configuration is safe.';

export const NO_FILES_NOTE =
  'No supported agent configuration files were found, so nothing was checked.';

export function meetsThreshold(severity: Severity, failOn: FailOn): boolean {
  return failOn !== 'none' && SEVERITY_RANK[severity] >= SEVERITY_RANK[failOn];
}

function scrubFinding(f: ReportFinding): ReportFinding {
  const out: ReportFinding = {
    ...f,
    file: scrubSecrets(f.file),
    message: scrubSecrets(f.message),
    why: scrubSecrets(f.why),
    remediation: scrubSecrets(f.remediation),
  };
  if (f.evidence !== undefined) out.evidence = scrubSecrets(f.evidence);
  return out;
}

export function buildReport(
  target: string,
  result: ScanResult,
  options: {
    failOn: FailOn;
    baseline?: { file: string; comparison: BaselineComparison } | undefined;
  },
): Report {
  const comparison = options.baseline?.comparison;
  const newSet = comparison ? new Set(comparison.newFindings.map((f) => f.fingerprint)) : undefined;
  const findings: ReportFinding[] = result.findings.map((f) =>
    scrubFinding(newSet ? { ...f, baseline: newSet.has(f.fingerprint) ? 'new' : 'existing' } : f),
  );

  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) bySeverity[f.severity]++;

  const counted = newSet ? findings.filter((f) => f.baseline === 'new') : findings;
  const failed = counted.some((f) => meetsThreshold(f.severity, options.failOn));

  const notes: string[] = [];
  if (result.files.length === 0) notes.push(NO_FILES_NOTE);
  if (result.truncated) {
    notes.push(
      'The directory walk stopped early because the entry limit was reached; results are incomplete.',
    );
  }
  notes.push(DISCLAIMER);

  const report: Report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: TOOL_NAME, version: VERSION },
    target: scrubSecrets(target),
    summary: {
      filesScanned: result.files.length,
      filesSkipped: result.skipped.length,
      findings: findings.length,
      bySeverity,
      suppressed: result.suppressed,
      failOn: options.failOn,
      failed,
    },
    files: result.files.map((f) => ({ path: scrubSecrets(f.path), kind: f.kind })),
    skipped: result.skipped.map((s) => ({ path: scrubSecrets(s.path), reason: s.reason })),
    findings,
    notes,
  };
  if (comparison && options.baseline) {
    report.summary.newFindings = comparison.newFindings.length;
    report.summary.resolvedFindings = comparison.resolved.length;
    report.baseline = { file: options.baseline.file, resolved: comparison.resolved };
  }
  return report;
}
