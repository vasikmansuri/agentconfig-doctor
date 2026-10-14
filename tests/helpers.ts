import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { classifyPath } from '../src/discovery/classify.js';
import { analyzeDocuments, type AnalyzeOptions } from '../src/engine/scan.js';
import { loadDocument } from '../src/parsers/index.js';
import type { ConfigDocument, Finding } from '../src/types/index.js';

const created: string[] = [];

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

/** Creates a temporary directory tree. Removed automatically after each test. */
export async function makeTree(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'acd-test-'));
  created.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

export function trackDir(dir: string): void {
  created.push(dir);
}

export function docsFrom(files: Record<string, string>): ConfigDocument[] {
  return Object.entries(files).map(([p, text]) => {
    const kind = classifyPath(p);
    if (!kind) throw new Error(`test file ${p} is not a supported config path`);
    return loadDocument(kind, p, text);
  });
}

export function analyze(files: Record<string, string>, options?: AnalyzeOptions): Finding[] {
  return analyzeDocuments(docsFrom(files), options).findings;
}

export function byRule(findings: Finding[], ruleId: string): Finding[] {
  return findings.filter((f) => f.ruleId === ruleId);
}

export const json = (value: unknown): string => JSON.stringify(value, null, 2);

export const mcp = (servers: Record<string, unknown>): string => json({ mcpServers: servers });

const rep = (unit: string, n: number) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);

/**
 * Synthetic credential-shaped strings, assembled at runtime so no complete
 * token-like literal is committed to the repository. None are real.
 */
export const fake = {
  github: () => ['gh', 'p_', rep('Qz7Wx3Kp9Lm2', 36)].join(''),
  githubFineGrained: () => ['github', '_pat_', rep('Qz7Wx3Kp9Lm2_', 60)].join(''),
  gitlab: () => ['gl', 'pat-', rep('Qz7Wx3Kp9Lm2', 20)].join(''),
  anthropic: () => ['sk-', 'ant-', 'api03-', rep('Qz7Wx3Kp9Lm2', 40)].join(''),
  openai: () => ['sk-', 'proj-', rep('Qz7Wx3Kp9Lm2', 40)].join(''),
  aws: () => ['AK', 'IA', rep('QZ7WX3KP9LM2', 16)].join(''),
  slack: () => ['xo', 'xb-', rep('1234567890-Qz7W', 30)].join(''),
  stripeLive: () => ['sk', '_live_', rep('Qz7Wx3Kp9Lm2', 24)].join(''),
  stripeTest: () => ['sk', '_test_', rep('Qz7Wx3Kp9Lm2', 24)].join(''),
  google: () => ['AI', 'za', rep('Qz7Wx3Kp9Lm2', 35)].join(''),
  npm: () => ['np', 'm_', rep('Qz7Wx3Kp9Lm2', 36)].join(''),
  huggingface: () => ['h', 'f_', rep('Qz7Wx3Kp9Lm2', 34)].join(''),
  jwt: () =>
    [
      'ey',
      'J',
      rep('hbGciOiJIUzI1', 20),
      '.ey',
      'J',
      rep('zdWIiOiIxMjM0', 24),
      '.',
      rep('SflKxwRJSMeK', 30),
    ].join(''),
  privateKey: () =>
    [
      '-----BEGIN ',
      'RSA PRIVATE',
      ' KEY-----\\n',
      rep('MIIEowIBAAKCAQEA', 64),
      '\\n-----END ',
      'RSA PRIVATE',
      ' KEY-----',
    ].join(''),
  slackWebhook: () =>
    ['https://hooks.slack.com', '/services/', 'T0000000/B0000000/', rep('Qz7Wx3Kp9Lm2', 24)].join(
      '',
    ),
};
