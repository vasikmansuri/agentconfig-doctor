import type { Severity } from '../types/index.js';

export interface Colors {
  enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  blue(s: string): string;
  green(s: string): string;
  magenta(s: string): string;
  cyan(s: string): string;
}

const wrap = (enabled: boolean, open: number, close: number) => (s: string) =>
  enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;

export function createColors(enabled: boolean): Colors {
  return {
    enabled,
    bold: wrap(enabled, 1, 22),
    dim: wrap(enabled, 2, 22),
    red: wrap(enabled, 31, 39),
    yellow: wrap(enabled, 33, 39),
    blue: wrap(enabled, 34, 39),
    green: wrap(enabled, 32, 39),
    magenta: wrap(enabled, 35, 39),
    cyan: wrap(enabled, 36, 39),
  };
}

/**
 * Colour is used only for an interactive terminal, and is disabled by
 * NO_COLOR (https://no-color.org) or --no-color. FORCE_COLOR forces it on.
 */
export function shouldUseColor(
  requested: boolean,
  stream: { isTTY?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!requested) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  return stream.isTTY === true;
}

export function severityLabel(severity: Severity, c: Colors): string {
  const label = severity.toUpperCase().padEnd(8);
  switch (severity) {
    case 'critical':
      return c.bold(c.magenta(label));
    case 'high':
      return c.bold(c.red(label));
    case 'medium':
      return c.yellow(label);
    case 'low':
      return c.blue(label);
    case 'info':
      return c.dim(label);
  }
}
