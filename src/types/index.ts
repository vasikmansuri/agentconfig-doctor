export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Higher number = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export type Confidence = 'high' | 'medium' | 'low';

export const CONFIG_KINDS = [
  'claude-mcp',
  'cursor-mcp',
  'vscode-mcp',
  'claude-settings',
  'cursor-rule',
  'instructions',
] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];

export const MCP_KINDS: readonly ConfigKind[] = ['claude-mcp', 'cursor-mcp', 'vscode-mcp'];

export interface SourceLocation {
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
}

export type JsonPath = (string | number)[];

export interface ParseIssue {
  message: string;
  line: number;
  column: number;
}

interface BaseDocument {
  kind: ConfigKind;
  /** POSIX path relative to the scan root. */
  path: string;
  text: string;
  /** Location of a character offset in `text`. */
  locateOffset(offset: number): SourceLocation;
  /** Best-effort location of a JSON property or array element (always undefined for text). */
  locate(path: JsonPath): SourceLocation | undefined;
}

export interface JsonDocument extends BaseDocument {
  format: 'json';
  /** Parsed value, or undefined when the document could not be parsed at all. */
  value: unknown;
  parseErrors: ParseIssue[];
  /** Duplicate object keys, which JSON parsers silently collapse. */
  duplicateKeys: { path: JsonPath; key: string; location: SourceLocation }[];
}

export interface Frontmatter {
  present: boolean;
  terminated: boolean;
  fields: Record<string, unknown>;
  issues: ParseIssue[];
}

export interface TextDocument extends BaseDocument {
  format: 'text';
  frontmatter?: Frontmatter;
}

export type ConfigDocument = JsonDocument | TextDocument;

export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  file: string;
  kind: ConfigKind;
  line?: number;
  column?: number;
  /** What was observed. Never contains an unredacted secret. */
  message: string;
  /** Redacted, truncated excerpt supporting the finding. */
  evidence?: string;
  why: string;
  remediation: string;
  /** Stable identifier used by baselines. Independent of line numbers. */
  fingerprint: string;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface DiscoveredFile {
  path: string;
  absolutePath: string;
  kind: ConfigKind;
}

export interface DoctorConfig {
  /** Rule IDs to disable entirely. */
  disabledRules: string[];
  /** Suppress specific findings. `path` is a glob relative to the scan root. */
  ignore: { rule: string; path?: string | undefined; fingerprint?: string | undefined }[];
  /** Paths that ACD003 should treat as intentionally granted (exact match after normalisation). */
  allowedPaths: string[];
  /** Remote MCP hosts that are expected. When non-empty, other hosts are reported by ACD006. */
  allowedHosts: string[];
}
