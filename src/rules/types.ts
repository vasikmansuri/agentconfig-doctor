import type {
  Confidence,
  ConfigDocument,
  ConfigKind,
  DoctorConfig,
  Severity,
  SourceLocation,
} from '../types/index.js';
import type { PermissionSnapshot } from '../baseline/snapshot.js';

export interface RuleContext {
  documents: readonly ConfigDocument[];
  config: DoctorConfig;
  /** Permission snapshot from a baseline, when one was supplied. */
  baselinePermissions?: PermissionSnapshot | undefined;
  /** Permission snapshot of the current scan. */
  currentPermissions: PermissionSnapshot;
}

export interface RuleFinding {
  file: string;
  kind: ConfigKind;
  severity: Severity;
  confidence: Confidence;
  message: string;
  evidence?: string | undefined;
  /** Command line after static variable expansion, when it differs from the source. */
  resolvedCommand?: string | undefined;
  location?: SourceLocation | undefined;
  /** Overrides the rule's default explanation. */
  why?: string | undefined;
  /** Overrides the rule's default remediation. */
  remediation?: string | undefined;
  /**
   * Identity of the finding within the file, used to build a fingerprint that
   * stays stable when lines move. Must not contain raw secret values.
   */
  key: string;
}

export interface Rule {
  id: string;
  name: string;
  title: string;
  /** The highest severity this rule normally reports. */
  severity: Severity;
  description: string;
  appliesTo: readonly ConfigKind[];
  why: string;
  remediation: string;
  /** Rules that only produce findings when a baseline is supplied. */
  requiresBaseline?: boolean;
  check(ctx: RuleContext): RuleFinding[];
}

export function findingFor(
  doc: ConfigDocument,
  fields: Omit<RuleFinding, 'file' | 'kind'>,
): RuleFinding {
  return { file: doc.path, kind: doc.kind, ...fields };
}
