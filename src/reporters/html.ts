import { SEVERITIES } from '../types/index.js';
import type { Report } from './report.js';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"'`]/g, (ch) => ESCAPES[ch] ?? ch);
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#666;--border:#ddd;--card:#f7f7f8;
--critical:#8b1fa9;--high:#c62828;--medium:#9a5b00;--low:#1565c0;--info:#616161;--pass:#2e7d32}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#e8e8e8;--muted:#a0a0a0;--border:#333;--card:#1c1c1e;
--critical:#d58cf0;--high:#ff7b7b;--medium:#ffb74d;--low:#82b1ff;--info:#bdbdbd;--pass:#81c784}}
*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:960px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}.muted{color:var(--muted)}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.summary{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.pill{border:1px solid var(--border);border-radius:999px;padding:2px 12px}
.result{font-weight:600;margin:8px 0 16px}.fail{color:var(--high)}.pass{color:var(--pass)}
.finding{border:1px solid var(--border);border-left:4px solid var(--sev);background:var(--card);border-radius:6px;padding:12px 16px;margin:12px 0}
.finding h2{font-size:16px;margin:0 0 4px}
.sev{color:var(--sev);font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.04em}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0}dt{color:var(--muted)}dd{margin:0}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}
`;

/**
 * Self-contained HTML report. All scanned content is HTML-escaped, no scripts
 * are included, and a restrictive Content-Security-Policy blocks any that
 * might be injected.
 */
export function renderHtml(report: Report): string {
  const e = escapeHtml;
  const { summary } = report;
  const scope = report.baseline ? 'new findings' : 'findings';
  const pills = SEVERITIES.map(
    (s) =>
      `<span class="pill" style="--sev:var(--${s})"><span class="sev">${s}</span> ${summary.bySeverity[s]}</span>`,
  ).join('');
  let result = '';
  if (summary.failOn === 'none') {
    result = '<p class="result muted">Result not evaluated (--fail-on none).</p>';
  } else if (summary.failed) {
    result = `<p class="result fail">FAIL: ${scope} at or above "${e(summary.failOn)}".</p>`;
  } else if (summary.filesScanned > 0) {
    result = `<p class="result pass">PASS: no ${scope} at or above "${e(summary.failOn)}".</p>`;
  }

  const findings = report.findings
    .map((f) => {
      const where = `${f.file}${f.line !== undefined ? `:${f.line}:${f.column ?? 1}` : ''}`;
      return `<section class="finding" style="--sev:var(--${f.severity})">
<span class="sev">${e(f.severity)}</span> <code>${e(f.ruleId)}</code>${f.baseline ? ` <span class="muted">[${e(f.baseline)}]</span>` : ''}
<h2>${e(f.title)}</h2>
<p><code>${e(where)}</code></p>
<p>${e(f.message)}</p>
<dl>${f.evidence ? `<dt>Evidence</dt><dd><code>${e(f.evidence)}</code></dd>` : ''}${f.resolvedCommand ? `<dt>Resolved command</dt><dd><code>${e(f.resolvedCommand)}</code> <span class="muted">(variables expanded statically from <code>${e(where)}</code>; ⟨…⟩ marks values only known at run time)</span></dd>` : ''}
<dt>Why it matters</dt><dd>${e(f.why)}</dd>
<dt>Remediation</dt><dd>${e(f.remediation)}</dd>
<dt>Confidence</dt><dd>${e(f.confidence)}</dd>
<dt>Fingerprint</dt><dd><code>${e(f.fingerprint)}</code></dd></dl>
</section>`;
    })
    .join('\n');

  const files = report.files.length
    ? `<table><thead><tr><th>File</th><th>Format</th></tr></thead><tbody>${report.files
        .map((f) => `<tr><td><code>${e(f.path)}</code></td><td>${e(f.kind)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No supported agent configuration files were found. Nothing was checked.</p>';
  const skipped = report.skipped.length
    ? `<h3>Skipped</h3><table><tbody>${report.skipped
        .map((s) => `<tr><td><code>${e(s.path)}</code></td><td>${e(s.reason)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>AgentConfig Doctor report</title>
<style>${STYLE}</style>
</head>
<body><main>
<h1>AgentConfig Doctor report</h1>
<p class="muted">${e(report.tool.name)} ${e(report.tool.version)} · target <code>${e(report.target)}</code> · ${summary.filesScanned} file(s) scanned, ${summary.filesSkipped} skipped${summary.suppressed ? `, ${summary.suppressed} suppressed` : ''}</p>
<div class="summary">${pills}</div>
${result}
${report.baseline ? `<p>Baseline <code>${e(report.baseline.file)}</code>: ${summary.newFindings ?? 0} new, ${summary.resolvedFindings ?? 0} resolved.</p>` : ''}
${findings || '<p>No findings.</p>'}
<h3>Files</h3>
${files}
${skipped}
${report.notes.map((n) => `<p class="muted">${e(n)}</p>`).join('\n')}
</main></body>
</html>
`;
}
