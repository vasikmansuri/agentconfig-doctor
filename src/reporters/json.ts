import type { Report } from './report.js';

/** Stable, machine-readable output. See docs/json-report.md for the schema. */
export function renderJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
