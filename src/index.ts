export { scan, analyzeDocuments, compareFindings } from './engine/scan.js';
export type { ScanOptions, ScanResult, AnalyzeOptions, AnalysisResult } from './engine/scan.js';
export { loadConfig, parseConfig, DEFAULT_CONFIG } from './engine/config.js';
export { discover, InputError, DEFAULT_MAX_FILE_SIZE } from './discovery/discover.js';
export type { DiscoveryOptions, DiscoveryResult } from './discovery/discover.js';
export { classifyPath } from './discovery/classify.js';
export { loadDocument } from './parsers/index.js';
export { RULES, getRule } from './rules/index.js';
export type { Rule, RuleContext, RuleFinding } from './rules/index.js';
export {
  createBaseline,
  parseBaseline,
  readBaseline,
  writeBaseline,
  serializeBaseline,
  compareWithBaseline,
  BaselineError,
} from './baseline/baseline.js';
export type { Baseline, BaselineEntry, BaselineComparison } from './baseline/baseline.js';
export { snapshotPermissions } from './baseline/snapshot.js';
export type { PermissionSnapshot } from './baseline/snapshot.js';
export { buildReport } from './reporters/report.js';
export type { Report, ReportFinding, FailOn } from './reporters/report.js';
export { renderTerminal } from './reporters/terminal.js';
export { renderJson } from './reporters/json.js';
export { renderHtml } from './reporters/html.js';
export { findSecrets, scrubSecrets, redactSecret } from './util/secrets.js';
export { run, EXIT } from './cli/program.js';
export { VERSION, TOOL_NAME } from './version.js';
export * from './types/index.js';
