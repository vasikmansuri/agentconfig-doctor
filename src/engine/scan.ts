import {
  discover,
  readDiscoveredFile,
  DEFAULT_MAX_FILE_SIZE,
  type DiscoveryOptions,
} from '../discovery/discover.js';
import { loadDocument } from '../parsers/index.js';
import { snapshotPermissions, type PermissionSnapshot } from '../baseline/snapshot.js';
import { RULES, type Rule } from '../rules/index.js';
import type {
  ConfigDocument,
  ConfigKind,
  DoctorConfig,
  Finding,
  SkippedFile,
} from '../types/index.js';
import { SEVERITY_RANK } from '../types/index.js';
import { createMatcher } from '../util/glob.js';
import { scrubSecrets } from '../util/secrets.js';
import { shortHash } from '../util/text.js';
import { DEFAULT_CONFIG } from './config.js';

export interface AnalyzeOptions {
  config?: DoctorConfig;
  /** Permission snapshot from a baseline; enables ACD009. */
  baselinePermissions?: PermissionSnapshot | undefined;
  /** Restrict to these rule IDs. */
  ruleIds?: readonly string[];
}

export interface ScanOptions extends DiscoveryOptions, AnalyzeOptions {
  /** Restrict to these configuration kinds. */
  kinds?: readonly ConfigKind[];
}

export interface ScanResult {
  /** Real path of the scan root directory. */
  root: string;
  files: { path: string; kind: ConfigKind }[];
  skipped: SkippedFile[];
  truncated: boolean;
  findings: Finding[];
  /** Findings removed by config `ignore` entries. */
  suppressed: number;
  permissions: PermissionSnapshot;
}

export interface AnalysisResult {
  findings: Finding[];
  suppressed: number;
  permissions: PermissionSnapshot;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    cmp(a.file, b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    cmp(a.ruleId, b.ruleId) ||
    cmp(a.fingerprint, b.fingerprint)
  );
}

function activeRules(config: DoctorConfig, ruleIds?: readonly string[]): Rule[] {
  const disabled = new Set(config.disabledRules.map((r) => r.toUpperCase()));
  const only = ruleIds ? new Set(ruleIds.map((r) => r.toUpperCase())) : undefined;
  return RULES.filter((r) => !disabled.has(r.id) && (!only || only.has(r.id)));
}

/** Runs the rules over already-loaded documents. Pure and deterministic. */
export function analyzeDocuments(
  documents: readonly ConfigDocument[],
  options: AnalyzeOptions = {},
): AnalysisResult {
  const config = options.config ?? DEFAULT_CONFIG;
  const permissions = snapshotPermissions(documents);
  const ctx = {
    documents,
    config,
    baselinePermissions: options.baselinePermissions,
    currentPermissions: permissions,
  };

  const byFingerprint = new Map<string, Finding>();
  for (const rule of activeRules(config, options.ruleIds)) {
    for (const f of rule.check(ctx)) {
      const fingerprint = shortHash(`${rule.id}|${f.file}|${f.key}`);
      if (byFingerprint.has(fingerprint)) continue;
      const finding: Finding = {
        ruleId: rule.id,
        title: rule.title,
        severity: f.severity,
        confidence: f.confidence,
        file: f.file,
        kind: f.kind,
        message: scrubSecrets(f.message),
        why: f.why ?? rule.why,
        remediation: f.remediation ?? rule.remediation,
        fingerprint,
      };
      if (f.location) {
        finding.line = f.location.line;
        finding.column = f.location.column;
      }
      if (f.evidence !== undefined) finding.evidence = scrubSecrets(f.evidence);
      byFingerprint.set(fingerprint, finding);
    }
  }

  const ignores = config.ignore.map((entry) => ({
    rule: entry.rule.toUpperCase(),
    fingerprint: entry.fingerprint,
    matchPath: entry.path ? createMatcher([entry.path]) : undefined,
  }));
  let suppressed = 0;
  const findings: Finding[] = [];
  for (const finding of byFingerprint.values()) {
    const ignored = ignores.some(
      (i) =>
        i.rule === finding.ruleId &&
        (!i.fingerprint || i.fingerprint === finding.fingerprint) &&
        (!i.matchPath || i.matchPath(finding.file)),
    );
    if (ignored) suppressed++;
    else findings.push(finding);
  }
  findings.sort(compareFindings);
  return { findings, suppressed, permissions };
}

/**
 * Discovers, parses and analyses supported agent configuration files under
 * `target`. Never executes commands found in configuration and never makes
 * network requests.
 */
export async function scan(target: string, options: ScanOptions = {}): Promise<ScanResult> {
  const discovery = await discover(target, options);
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const kinds = options.kinds ? new Set(options.kinds) : undefined;
  const skipped = [...discovery.skipped];
  const documents: ConfigDocument[] = [];
  const files: ScanResult['files'] = [];

  for (const file of discovery.files) {
    if (kinds && !kinds.has(file.kind)) continue;
    const read = await readDiscoveredFile(discovery.root, file, maxFileSize);
    if (!read.ok) {
      skipped.push({ path: file.path, reason: read.reason });
      continue;
    }
    documents.push(loadDocument(file.kind, file.path, read.text));
    files.push({ path: file.path, kind: file.kind });
  }

  const analysis = analyzeDocuments(documents, options);
  skipped.sort((a, b) => cmp(a.path, b.path));
  return {
    root: discovery.root,
    files,
    skipped,
    truncated: discovery.truncated,
    ...analysis,
  };
}
