import type { Confidence, Severity } from '../types/index.js';

export interface SecretPattern {
  id: string;
  name: string;
  /** Must not use the `g` or `y` flags; matching is driven by `findSecrets`. */
  regex: RegExp;
  severity: Severity;
  confidence: Confidence;
  /** Capture group holding the secret part. 0 = whole match. */
  group?: number;
  /** Number of leading characters that are safe to show (a public type prefix). */
  keepPrefix?: number | ((secret: string) => number);
  /**
   * The vendor prefix is distinctive enough to match even when glued to
   * preceding word characters (e.g. inside an identifier), so a leading `\b`
   * is not required.
   */
  distinctivePrefix?: boolean;
}

const PRIVATE_KEY_HEADER = /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/;

/**
 * Patterns for well-known credential formats. They are deliberately anchored
 * on documented vendor prefixes to keep false positives low. Matching a
 * pattern does not prove that a credential is valid.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: 'private-key',
    name: 'Private key',
    regex:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----(?:[A-Za-z0-9+/=\s:,-]|\\[nr])*(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----)?/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: (s) => PRIVATE_KEY_HEADER.exec(s)?.[0].length ?? 0,
  },
  {
    id: 'aws-access-key-id',
    distinctivePrefix: true,
    name: 'AWS access key ID',
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    severity: 'high',
    confidence: 'high',
    keepPrefix: 4,
  },
  {
    id: 'aws-secret-access-key',
    name: 'AWS secret access key',
    regex: /aws_?secret_?access_?key["'\s]*[:=]\s*["']?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/i,
    group: 1,
    severity: 'critical',
    confidence: 'medium',
  },
  {
    id: 'github-token',
    distinctivePrefix: true,
    name: 'GitHub token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: 4,
  },
  {
    id: 'github-fine-grained-token',
    distinctivePrefix: true,
    name: 'GitHub fine-grained token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: 11,
  },
  {
    id: 'gitlab-token',
    distinctivePrefix: true,
    name: 'GitLab personal access token',
    regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: 6,
  },
  {
    id: 'anthropic-api-key',
    distinctivePrefix: true,
    name: 'Anthropic API key',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: 7,
  },
  {
    id: 'openai-api-key',
    name: 'OpenAI-style API key',
    regex: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/,
    severity: 'critical',
    confidence: 'medium',
    keepPrefix: 3,
  },
  {
    id: 'slack-token',
    distinctivePrefix: true,
    name: 'Slack token',
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: 5,
  },
  {
    id: 'slack-webhook',
    name: 'Slack incoming webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/]{20,}/,
    severity: 'high',
    confidence: 'high',
    keepPrefix: 'https://hooks.slack.com/services/'.length,
  },
  {
    id: 'stripe-live-key',
    distinctivePrefix: true,
    name: 'Stripe live secret key',
    regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: 8,
  },
  {
    id: 'stripe-test-key',
    distinctivePrefix: true,
    name: 'Stripe test secret key',
    regex: /\b(?:sk|rk)_test_[A-Za-z0-9]{16,}/,
    severity: 'medium',
    confidence: 'high',
    keepPrefix: 8,
  },
  {
    id: 'google-api-key',
    distinctivePrefix: true,
    name: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/,
    severity: 'high',
    confidence: 'high',
    keepPrefix: 4,
  },
  {
    id: 'npm-token',
    distinctivePrefix: true,
    name: 'npm access token',
    regex: /\bnpm_[A-Za-z0-9]{36}\b/,
    severity: 'critical',
    confidence: 'high',
    keepPrefix: 4,
  },
  {
    id: 'huggingface-token',
    name: 'Hugging Face token',
    regex: /\bhf_[A-Za-z0-9]{30,}\b/,
    severity: 'high',
    confidence: 'high',
    keepPrefix: 3,
  },
  {
    id: 'jwt',
    name: 'JSON Web Token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    severity: 'high',
    confidence: 'medium',
    keepPrefix: 3,
  },
  {
    id: 'url-credentials',
    name: 'Password embedded in URL',
    regex: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/"'`]{1,100}:([^\s@/"'`]{1,200})@/i,
    group: 1,
    severity: 'high',
    confidence: 'medium',
  },
  {
    id: 'bearer-token',
    name: 'Literal bearer token',
    regex: /\b[Bb]earer\s+([A-Za-z0-9._~+/-]{20,}=*)/,
    group: 1,
    severity: 'high',
    confidence: 'medium',
  },
];

export interface SecretMatch {
  pattern: SecretPattern;
  /** Offset of the secret part (not the whole match) within the text. */
  start: number;
  end: number;
  secret: string;
}

const PLACEHOLDER =
  /^(?:x+|X+|\*+|0+|\.+|<[^>]*>|.*(?:EXAMPLE|example|placeholder|PLACEHOLDER|your[-_]|YOUR[-_]|changeme|CHANGEME|REDACTED|redacted).*)$/;

/** True for values that reference a variable (`${VAR}`, `$VAR`, `{{VAR}}`) instead of holding literal data. */
export function isVariableReference(value: string): boolean {
  return /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\{\{[^}]*\}\}/.test(value);
}

export function isPlaceholderValue(value: string): boolean {
  return value.trim() === '' || PLACEHOLDER.test(value.trim());
}

/** Finds credential-like strings in arbitrary text. Matches never overlap. */
export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const source = pattern.distinctivePrefix
      ? pattern.regex.source.replace(/^\\b/, '')
      : pattern.regex.source;
    const re = new RegExp(source, `${pattern.regex.flags}gd`);
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const group = pattern.group ?? 0;
      const span = m.indices?.[group];
      const secret = m[group];
      if (!span || secret === undefined) continue;
      if (
        pattern.id !== 'private-key' &&
        (isPlaceholderValue(secret) || isVariableReference(secret))
      ) {
        continue;
      }
      const [start, end] = span;
      if (matches.some((x) => start < x.end && end > x.start)) continue;
      matches.push({ pattern, start, end, secret });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

/** Redacts a detected secret, keeping only a public type prefix when known. */
export function redactSecret(secret: string, pattern?: SecretPattern): string {
  const keep = pattern?.keepPrefix;
  let n = typeof keep === 'function' ? keep(secret) : (keep ?? 0);
  // Never reveal more than half of a value.
  n = Math.min(n, Math.floor(secret.length / 2));
  return `${secret.slice(0, n)}****`;
}

/** Redacts an arbitrary literal value without revealing any characters. */
export function redactLiteral(value: string): string {
  return `**** (${value.length} chars)`;
}

/** Replaces every recognised credential in `text` with a redacted form. */
export function scrubSecrets(text: string): string {
  const matches = findSecrets(text);
  if (matches.length === 0) return text;
  let out = '';
  let last = 0;
  for (const m of matches) {
    out += text.slice(last, m.start) + redactSecret(m.secret, m.pattern);
    last = m.end;
  }
  return out + text.slice(last);
}
