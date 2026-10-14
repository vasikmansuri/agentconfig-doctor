import { isIP } from 'node:net';
import type { Confidence, Severity } from '../types/index.js';
import { scrubSecrets } from '../util/secrets.js';
import { truncate } from '../util/text.js';
import { basenameOf, getMcpServers, type McpServer } from './mcp-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

interface Observation {
  id: string;
  severity: Severity;
  confidence: Confidence;
  message: string;
  evidence?: string;
  why: string;
  remediation: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function isLocalHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || /^127\./.test(host) || host.endsWith('.localhost');
}

function isPrivateIp(host: string): boolean {
  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(?:fc|fd|fe80)/i.test(host)
  );
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().trim();
  if (p.startsWith('*.')) return h.endsWith(p.slice(1));
  return h === p;
}

function remoteObservations(server: McpServer, allowedHosts: readonly string[]): Observation[] {
  const out: Observation[] = [];
  const url = server.url;
  if (url === undefined || url.includes('${')) return out;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return out; // reported by ACD005
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const local = isLocalHost(host);
  const display = `${parsed.protocol}//${parsed.host}`;

  if ((parsed.protocol === 'http:' || parsed.protocol === 'ws:') && !local) {
    out.push({
      id: 'plaintext-remote',
      severity: 'medium',
      confidence: 'high',
      message: `MCP server "${server.name}" connects to a non-local endpoint over unencrypted ${parsed.protocol.slice(0, -1)}.`,
      evidence: display,
      why: 'Tool calls, results and any authentication headers travel in clear text and can be read or modified on the network.',
      remediation: 'Use an https:// (or wss://) endpoint.',
    });
  }
  if (isIP(host) && !local && !isPrivateIp(host)) {
    out.push({
      id: 'ip-literal-endpoint',
      severity: 'low',
      confidence: 'low',
      message: `MCP server "${server.name}" uses a public IP address instead of a host name.`,
      evidence: display,
      why: 'IP-literal endpoints cannot be tied to an identifiable operator and usually lack a valid TLS certificate. This is not evidence of malicious intent.',
      remediation: 'Prefer a named, documented endpoint operated by a party you trust.',
    });
  }
  if (allowedHosts.length > 0 && !local && !allowedHosts.some((p) => hostMatches(host, p))) {
    out.push({
      id: 'host-not-allowed',
      severity: 'medium',
      confidence: 'high',
      message: `MCP server "${server.name}" connects to "${host}", which is not in the configured allowedHosts list.`,
      evidence: display,
      why: 'Your policy lists the remote MCP hosts that are expected; this endpoint is outside it.',
      remediation: 'Remove the server, or add the host to "allowedHosts" after review.',
    });
  }
  return out;
}

/** Package runners, mapped to the sub-command that precedes the package (if any). */
const RUNNERS: Record<string, string | undefined> = {
  npx: undefined,
  pnpx: undefined,
  bunx: undefined,
  uvx: undefined,
  pnpm: 'dlx',
  yarn: 'dlx',
  bun: 'x',
  pipx: 'run',
};

/** Package spec passed to a package runner such as `npx -y pkg`, if any. */
export function runnerPackage(command: string, args: readonly string[]): string | undefined {
  const base = basenameOf(command).replace(/\.(?:cmd|exe)$/, '');
  if (!(base in RUNNERS)) return undefined;
  const sub = RUNNERS[base];
  let i = 0;
  if (sub !== undefined) {
    i = args.indexOf(sub);
    if (i === -1) return undefined;
    i++;
  }
  for (; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '-p' || arg === '--package' || arg === '--from') return args[i + 1];
    if (/^--(?:package|from)=/.test(arg)) return arg.slice(arg.indexOf('=') + 1);
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return undefined;
}

export function isPinnedPackage(spec: string): boolean {
  if (/^(?:\.|\/|~|file:|git\+|https?:|[A-Za-z]:\\)/.test(spec)) return true; // local path or URL
  if (spec.includes('==')) return !/==\s*$/.test(spec); // Python pin
  const at = spec.lastIndexOf('@');
  if (at <= 0) return false; // no version, or only a scope such as "@scope/name"
  const version = spec.slice(at + 1);
  return version !== '' && !/^(?:latest|next|\*|x)$/i.test(version);
}

const TEMP_COMMAND =
  /^(?:\/tmp\/|\/var\/tmp\/|\/dev\/shm\/|~\/Downloads\/|\$TMPDIR|%TEMP%|%TMP%|[A-Za-z]:\\Windows\\Temp\\|\/Users\/[^/]+\/Downloads\/|\/home\/[^/]+\/Downloads\/)/i;

const CONTAINER_FLAGS: {
  regex: RegExp;
  flag: string;
  id: string;
  severity: Severity;
  effect: string;
}[] = [
  {
    regex: /\s--privileged(?:=true)?\s/,
    flag: '--privileged',
    id: 'container-privileged',
    severity: 'high',
    effect: 'gives the container full access to the host kernel and devices',
  },
  {
    regex: /\s--cap-add(?:=|\s+)(?:ALL|SYS_ADMIN)\s/i,
    flag: '--cap-add ALL/SYS_ADMIN',
    id: 'container-cap-add',
    severity: 'high',
    effect: 'grants near-root kernel capabilities',
  },
  {
    regex: /\s(?:--network|--net)(?:=|\s+)host\s/,
    flag: '--network host',
    id: 'container-host-network',
    severity: 'medium',
    effect: 'shares the host network stack, exposing local services',
  },
  {
    regex: /\s--pid(?:=|\s+)host\s/,
    flag: '--pid host',
    id: 'container-host-pid',
    severity: 'medium',
    effect: 'lets the container see and signal host processes',
  },
  {
    regex: /\s--security-opt(?:=|\s+)(?:seccomp|apparmor)[=:]unconfined\s/,
    flag: '--security-opt ...=unconfined',
    id: 'container-unconfined',
    severity: 'medium',
    effect: 'disables kernel sandboxing profiles',
  },
];

function localObservations(server: McpServer): Observation[] {
  const out: Observation[] = [];
  const command = server.command;
  if (command === undefined) return out;
  const base = basenameOf(command);

  const pkg = runnerPackage(command, server.args);
  if (pkg !== undefined && !isPinnedPackage(pkg)) {
    out.push({
      id: 'unpinned-package',
      severity: 'low',
      confidence: 'medium',
      message: `MCP server "${server.name}" runs package "${truncate(pkg, 80)}" through ${base} without a pinned version.`,
      evidence: truncate(scrubSecrets([command, ...server.args].join(' ')), 120),
      why: 'The newest published version is downloaded and executed whenever the server starts, so a compromised or typo-squatted release runs automatically.',
      remediation:
        'Pin an exact, reviewed version, e.g. "some-mcp-server@1.4.2" (npm) or "some-mcp-server==1.4.2" (Python).',
    });
  }

  if (TEMP_COMMAND.test(command)) {
    out.push({
      id: 'temp-executable',
      severity: 'medium',
      confidence: 'medium',
      message: `MCP server "${server.name}" executes a program from a temporary or downloads directory.`,
      evidence: truncate(command, 120),
      why: 'Temporary and download directories are writable by many processes and are a common staging location for untrusted binaries.',
      remediation:
        'Install the server into a stable, access-controlled location or run it via a pinned package.',
    });
  }

  if (base === 'docker' || base === 'podman') {
    const joined = ` ${server.args.join(' ')} `;
    for (const f of CONTAINER_FLAGS) {
      if (!f.regex.test(joined)) continue;
      out.push({
        id: f.id,
        severity: f.severity,
        confidence: 'high',
        message: `MCP server "${server.name}" runs a container with ${f.flag}, which ${f.effect}.`,
        evidence: f.flag,
        why: 'Container isolation is often the main safety boundary for third-party MCP servers; this flag weakens it.',
        remediation: `Remove ${f.flag} unless the server genuinely requires it, and document why if it does.`,
      });
    }
  }

  for (const [name, value] of Object.entries(server.env)) {
    const v = String(value).trim().toLowerCase();
    if (
      (name === 'NODE_TLS_REJECT_UNAUTHORIZED' && v === '0') ||
      (name === 'PYTHONHTTPSVERIFY' && v === '0') ||
      (name === 'GIT_SSL_NO_VERIFY' && (v === '1' || v === 'true'))
    ) {
      out.push({
        id: `tls-disabled:${name}`,
        severity: 'medium',
        confidence: 'high',
        message: `MCP server "${server.name}" disables TLS certificate verification via ${name}.`,
        evidence: `${name}=${String(value)}`,
        why: 'Without certificate verification, network traffic from the server can be intercepted and modified.',
        remediation: `Remove ${name}; install the required CA certificate instead if a private CA is in use.`,
      });
    }
    if (/^(?:LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH)$/.test(name)) {
      out.push({
        id: `library-injection:${name}`,
        severity: 'high',
        confidence: 'medium',
        message: `MCP server "${server.name}" sets ${name}, which loads arbitrary shared libraries into the server process.`,
        evidence: `${name}=${truncate(scrubSecrets(String(value)), 80)}`,
        why: 'Library-injection variables are a common hijacking technique and are rarely needed by MCP servers.',
        remediation: `Remove ${name} from the server environment.`,
      });
    }
  }
  return out;
}

export const suspiciousServers: Rule = {
  id: 'ACD006',
  name: 'suspicious-server-definition',
  title: 'Suspicious MCP server definition',
  severity: 'high',
  description:
    'Flags server definitions with risky execution settings: unencrypted or IP-literal remote endpoints, hosts outside an optional allow-list, unpinned packages run via npx/uvx/pnpm dlx, executables in temp/download directories, privileged container flags, TLS-verification bypasses and library-injection environment variables.',
  appliesTo: ['claude-mcp', 'cursor-mcp', 'vscode-mcp'],
  why: 'These settings widen the trust placed in a server or in the network path to it. They are signals for review, not proof that a server is malicious.',
  remediation: 'Review the server definition and apply the specific remediation in each finding.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    for (const doc of ctx.documents) {
      for (const server of getMcpServers(doc)) {
        const observations = [
          ...localObservations(server),
          ...remoteObservations(server, ctx.config.allowedHosts),
        ];
        for (const o of observations) {
          findings.push(
            findingFor(doc, {
              severity: o.severity,
              confidence: o.confidence,
              message: o.message,
              evidence: o.evidence,
              location: doc.locate(server.path),
              key: `mcp:${server.name}:${o.id}`,
              why: o.why,
              remediation: o.remediation,
            }),
          );
        }
      }
    }
    return findings;
  },
};
