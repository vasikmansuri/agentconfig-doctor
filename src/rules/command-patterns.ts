import type { Severity } from '../types/index.js';

export interface CommandPattern {
  id: string;
  regex: RegExp;
  severity: Severity;
  /** Severity when the pattern appears in prose instruction files, where examples are common. */
  proseSeverity: Severity;
  reason: string;
}

const DELETE_TARGET = String.raw`["']?(?:\/|\/\*|~\/?|\$HOME\/?|\$\{HOME\}\/?|\*|\.\/?\*?|\.\.\/?)["']?(?=\s|$|;|&|\|)`;
const RECURSIVE_FORCE = String.raw`(?:-[a-zA-Z]*[rR][a-zA-Z]*[fF][a-zA-Z]*|-[a-zA-Z]*[fF][a-zA-Z]*[rR][a-zA-Z]*|-[rR]\s+-[fF]|-[fF]\s+-[rR]|--recursive\s+--force|--force\s+--recursive)`;

/**
 * Static patterns for shell commands whose effect is dangerous regardless of
 * context. Matching is purely textual: commands are never executed or resolved.
 */
export const COMMAND_PATTERNS: readonly CommandPattern[] = [
  {
    id: 'reverse-shell',
    regex:
      /\/dev\/tcp\/[^\s/]+\/\d+|\b(?:nc|ncat|netcat)\b[^\n]*\s-[ec]\s|\bbash\s+-i\s*>&|\bsocat\b[^\n]*\bexec:/i,
    severity: 'critical',
    proseSeverity: 'high',
    reason: 'opens an interactive shell over the network (reverse-shell pattern)',
  },
  {
    id: 'credential-exfiltration',
    regex:
      /(?:~|\$HOME|\$\{HOME\})\/\.(?:ssh\/id_[a-z0-9]+|aws\/credentials|netrc|npmrc|git-credentials|docker\/config\.json)\b[^\n]*\|\s*(?:curl|wget|nc)\b|\b(?:curl|wget)\b[^\n]*(?:-d|--data(?:-binary)?|-F|--form|--upload-file|-T)\s+(?:[\w-]+=)?@?(?:~|\$HOME)\/\.(?:ssh|aws|netrc|npmrc|git-credentials)/i,
    severity: 'critical',
    proseSeverity: 'high',
    reason: 'reads a local credential file and sends it over the network',
  },
  {
    id: 'disk-destruction',
    regex:
      /\bmkfs(?:\.\w+)?\s+\/dev\/|\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|disk|hd|xvd)|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    severity: 'critical',
    proseSeverity: 'high',
    reason: 'formats or overwrites a disk device, or is a fork bomb',
  },
  {
    id: 'download-and-execute',
    regex:
      /\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:env\s+)?(?:ba|z|da|k|fi)?sh\b|\b(?:curl|wget)\b[^|;&\n]*\|\s*(?:sudo\s+)?(?:python3?|node|perl|ruby|php)\b/i,
    severity: 'high',
    proseSeverity: 'low',
    reason:
      'downloads content and pipes it straight into an interpreter, so whatever the server returns is executed without review',
  },
  {
    id: 'execute-remote-output',
    regex:
      /\b(?:eval|source|(?:ba|z|da)?sh\s+-c)\s+["']?\$\(\s*(?:curl|wget)\b|\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/i,
    severity: 'high',
    proseSeverity: 'low',
    reason: 'executes the output of a network download',
  },
  {
    id: 'powershell-download-execute',
    regex:
      /\b(?:iex|Invoke-Expression)\b[^\n]*\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString|Net\.WebClient)\b|\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(?:iex|Invoke-Expression)\b/i,
    severity: 'high',
    proseSeverity: 'low',
    reason: 'downloads a PowerShell script and executes it without review',
  },
  {
    id: 'encoded-payload',
    regex:
      /\bbase64\s+(?:-d|--decode|-D)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*\s-(?:e|ec|enc|encodedcommand)\s+[A-Za-z0-9+/=]{16,}/i,
    severity: 'high',
    proseSeverity: 'medium',
    reason:
      'decodes an obfuscated payload and executes it; the real command cannot be reviewed in the config',
  },
  {
    id: 'destructive-delete',
    regex: new RegExp(
      String.raw`\brm\s+(?:-[a-zA-Z-]+\s+)*${RECURSIVE_FORCE}\s+(?:-[a-zA-Z-]+\s+)*(?:--\s+)?${DELETE_TARGET}|\b(?:rd|rmdir)\s+\/s\s+\/q\s+[A-Za-z]:\\?(?=\s|$)|\bRemove-Item\b[^\n]*-Recurse[^\n]*\s(?:[A-Za-z]:\\|~|\$HOME|\$env:USERPROFILE)(?=\s|$)`,
    ),
    severity: 'high',
    proseSeverity: 'medium',
    reason:
      'recursively force-deletes the filesystem root, a home directory, or the current/parent directory',
  },
  {
    id: 'world-writable',
    regex: /\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx)\b/,
    severity: 'medium',
    proseSeverity: 'low',
    reason: 'makes files world-writable',
  },
  {
    id: 'privilege-escalation',
    regex: /(?:^|[\s;&|(])sudo(?:\s|:)/,
    severity: 'medium',
    proseSeverity: 'info',
    reason: 'runs with elevated (root) privileges; agent tooling should not need root',
  },
  {
    id: 'tls-verification-disabled',
    regex:
      /\bcurl\b[^\n]*\s(?:-k|--insecure)(?=\s|$)|--no-check-certificate|NODE_TLS_REJECT_UNAUTHORIZED=0|GIT_SSL_NO_VERIFY=(?:1|true)/i,
    severity: 'medium',
    proseSeverity: 'low',
    reason: 'disables TLS certificate verification, enabling man-in-the-middle tampering',
  },
];

export interface CommandMatch {
  pattern: CommandPattern;
  index: number;
  text: string;
}

export function matchCommandPatterns(text: string): CommandMatch[] {
  const out: CommandMatch[] = [];
  for (const pattern of COMMAND_PATTERNS) {
    const re = new RegExp(pattern.regex.source, `${pattern.regex.flags.replace('g', '')}g`);
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      out.push({ pattern, index: m.index, text: m[0] });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

const SHELL_WRAPPERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
]);
const SHELL_INLINE_FLAGS = new Set(['-c', '/c', '/k', '-command', '-encodedcommand']);

/** True when a command/args pair runs an inline shell script (e.g. `bash -c "..."`). */
export function isShellWrapper(command: string, args: readonly string[]): boolean {
  const base = (command.split(/[\\/]/).pop() ?? command).toLowerCase();
  if (!SHELL_WRAPPERS.has(base)) return false;
  return args.some((a) => SHELL_INLINE_FLAGS.has(a.toLowerCase()));
}
