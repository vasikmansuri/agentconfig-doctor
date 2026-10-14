import { SEVERITIES } from '../types/index.js';
import { stripControlChars } from '../util/text.js';
import { createColors, severityLabel } from './colors.js';
import { DISCLAIMER, meetsThreshold, NO_FILES_NOTE, type Report } from './report.js';

export interface TerminalOptions {
  color: boolean;
  verbose: boolean;
}

export const SUPPORTED_FILES_HINT =
  'Looked for: .mcp.json, .cursor/mcp.json, .vscode/mcp.json, .claude/settings.json, .claude/settings.local.json, .cursor/rules/**/*.mdc, CLAUDE.md, CLAUDE.local.md, AGENTS.md, .cursorrules';

/** Escapes untrusted text so it cannot inject terminal control sequences or fake lines. */
const safe = (s: string) => stripControlChars(s);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderTerminal(report: Report, options: TerminalOptions): string {
  const c = createColors(options.color);
  const lines: string[] = [];
  const { summary } = report;

  lines.push(
    `${c.bold(report.tool.name)} ${report.tool.version} ${c.dim('·')} scanned ${plural(summary.filesScanned, 'file')} in ${safe(report.target)}`,
  );
  if (options.verbose) {
    for (const f of report.files) lines.push(c.dim(`  ✓ ${safe(f.path)} (${f.kind})`));
  }
  lines.push('');

  if (summary.filesScanned === 0) {
    lines.push(c.yellow(NO_FILES_NOTE));
    lines.push(c.dim(SUPPORTED_FILES_HINT));
    lines.push('');
  }

  for (const f of report.findings) {
    const where = `${safe(f.file)}${f.line !== undefined ? `:${f.line}:${f.column ?? 1}` : ''}`;
    const badge =
      f.baseline === 'existing'
        ? c.dim(' [baseline]')
        : f.baseline === 'new'
          ? c.cyan(' [new]')
          : '';
    lines.push(`${severityLabel(f.severity, c)} ${c.bold(f.ruleId)}  ${f.title}${badge}`);
    lines.push(`  ${c.cyan(where)}`);
    lines.push(`  ${safe(f.message)}`);
    if (f.evidence) lines.push(`  ${c.dim('evidence:')} ${safe(f.evidence)}`);
    if (options.verbose) {
      lines.push(`  ${c.dim('why:')} ${safe(f.why)}`);
      lines.push(
        `  ${c.dim('confidence:')} ${f.confidence}  ${c.dim('fingerprint:')} ${f.fingerprint}`,
      );
    }
    lines.push(`  ${c.green('fix:')} ${safe(f.remediation)}`);
    lines.push('');
  }

  if (report.skipped.length > 0) {
    lines.push(c.yellow(`Skipped ${plural(report.skipped.length, 'file')}:`));
    const shown = options.verbose ? report.skipped : report.skipped.slice(0, 5);
    for (const s of shown) lines.push(`  - ${safe(s.path)}: ${safe(s.reason)}`);
    if (shown.length < report.skipped.length) {
      lines.push(c.dim(`  ... ${report.skipped.length - shown.length} more (use --verbose)`));
    }
    lines.push('');
  }

  if (report.baseline) {
    const newCount = summary.newFindings ?? 0;
    lines.push(
      `Baseline ${safe(report.baseline.file)}: ${newCount} new, ${summary.findings - newCount} existing, ${summary.resolvedFindings ?? 0} resolved since baseline.`,
    );
    if (options.verbose) {
      for (const r of report.baseline.resolved) {
        lines.push(c.dim(`  resolved: ${r.ruleId} ${safe(r.file)} (${r.fingerprint})`));
      }
    }
  }

  const counts = SEVERITIES.map((s) => `${summary.bySeverity[s]} ${s}`).join(', ');
  const extras = [
    summary.filesSkipped ? `${summary.filesSkipped} skipped` : '',
    summary.suppressed ? `${summary.suppressed} suppressed by config` : '',
  ].filter(Boolean);
  lines.push(
    `${c.bold('Summary:')} ${counts} (${plural(summary.findings, 'finding')} in ${plural(summary.filesScanned, 'file')}${extras.length ? `, ${extras.join(', ')}` : ''})`,
  );

  const scope = report.baseline ? 'new findings' : 'findings';
  if (summary.failOn === 'none') {
    lines.push(c.dim('Result: not evaluated (--fail-on none).'));
  } else if (summary.failed) {
    const n = report.findings.filter(
      (f) =>
        (!report.baseline || f.baseline === 'new') && meetsThreshold(f.severity, summary.failOn),
    ).length;
    lines.push(c.bold(c.red(`Result: FAIL (${n} ${scope} at or above "${summary.failOn}")`)));
  } else if (summary.filesScanned > 0) {
    lines.push(c.green(`Result: PASS (no ${scope} at or above "${summary.failOn}")`));
  }
  if (summary.findings === 0 && summary.filesScanned > 0) lines.push(c.dim(DISCLAIMER));
  for (const note of report.notes) {
    if (note !== DISCLAIMER && note !== NO_FILES_NOTE) lines.push(c.yellow(note));
  }
  return `${lines.join('\n')}\n`;
}
