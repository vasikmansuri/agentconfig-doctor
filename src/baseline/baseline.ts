import { readFile, stat, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Finding } from '../types/index.js';
import { TOOL_NAME, VERSION } from '../version.js';
import { PermissionSnapshotSchema, type PermissionSnapshot } from './snapshot.js';

export const BASELINE_SCHEMA_VERSION = 1;
const MAX_BASELINE_SIZE = 10 * 1024 * 1024;

const BaselineEntrySchema = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/, 'must be a 16-character hex fingerprint'),
    ruleId: z.string().regex(/^ACD\d{3}$/, 'must look like ACD001'),
    file: z.string(),
    title: z.string(),
  })
  .strict();

const BaselineSchema = z
  .object({
    schemaVersion: z.literal(BASELINE_SCHEMA_VERSION),
    tool: z.literal(TOOL_NAME),
    toolVersion: z.string(),
    findings: z.array(BaselineEntrySchema),
    permissions: PermissionSnapshotSchema,
  })
  .strict();

export type BaselineEntry = z.infer<typeof BaselineEntrySchema>;
export type Baseline = z.infer<typeof BaselineSchema>;

/** Invalid or unreadable baseline. Maps to exit code 2: the scan fails safely. */
export class BaselineError extends Error {
  override name = 'BaselineError';
}

/** Rules whose findings are relative to a baseline and therefore never stored in one. */
const RELATIVE_RULES = new Set(['ACD009']);

const byFingerprint = (a: BaselineEntry, b: BaselineEntry) =>
  a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;

export function createBaseline(
  findings: readonly Finding[],
  permissions: PermissionSnapshot,
): Baseline {
  const entries = findings
    .filter((f) => !RELATIVE_RULES.has(f.ruleId))
    .map((f) => ({ fingerprint: f.fingerprint, ruleId: f.ruleId, file: f.file, title: f.title }))
    .sort(byFingerprint);
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    tool: TOOL_NAME,
    toolVersion: VERSION,
    findings: entries,
    permissions,
  };
}

export function serializeBaseline(baseline: Baseline): string {
  return `${JSON.stringify(baseline, null, 2)}\n`;
}

export function parseBaseline(text: string, source = 'Baseline'): Baseline {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BaselineError(`${source} is not valid JSON.`);
  }
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion > BASELINE_SCHEMA_VERSION
  ) {
    throw new BaselineError(
      `${source} uses schema version ${value.schemaVersion}, which is newer than this tool supports (${BASELINE_SCHEMA_VERSION}). Upgrade agentconfig-doctor.`,
    );
  }
  const parsed = BaselineSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new BaselineError(`${source} is not a valid agentconfig-doctor baseline:\n${details}`);
  }
  return parsed.data;
}

export async function readBaseline(file: string): Promise<Baseline> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
    throw new BaselineError(`Cannot read baseline "${file}": ${code}`);
  }
  if (size > MAX_BASELINE_SIZE) {
    throw new BaselineError(`Baseline "${file}" is larger than ${MAX_BASELINE_SIZE} bytes.`);
  }
  return parseBaseline(await readFile(file, 'utf8'), `Baseline "${file}"`);
}

export interface BaselineComparison {
  /** Findings not present in the baseline (always includes ACD009 findings). */
  newFindings: Finding[];
  existingFindings: Finding[];
  /** Baseline entries that no longer occur (fixed, removed, or suppressed). */
  resolved: BaselineEntry[];
}

export function compareWithBaseline(
  findings: readonly Finding[],
  baseline: Baseline,
): BaselineComparison {
  const known = new Set(baseline.findings.map((f) => f.fingerprint));
  const current = new Set(findings.map((f) => f.fingerprint));
  const newFindings: Finding[] = [];
  const existingFindings: Finding[] = [];
  for (const f of findings) {
    if (!RELATIVE_RULES.has(f.ruleId) && known.has(f.fingerprint)) existingFindings.push(f);
    else newFindings.push(f);
  }
  const resolved = baseline.findings.filter((f) => !current.has(f.fingerprint));
  return { newFindings, existingFindings, resolved };
}

/**
 * Writes a baseline file. `create` refuses to overwrite an existing file and
 * `update` refuses to create a new one, so a baseline is never silently replaced.
 */
export async function writeBaseline(
  file: string,
  baseline: Baseline,
  mode: 'create' | 'update',
): Promise<void> {
  const exists = await stat(file).then(
    () => true,
    () => false,
  );
  if (mode === 'create' && exists) {
    throw new BaselineError(
      `Baseline "${file}" already exists. Use "agentconfig-doctor baseline update" to replace it deliberately.`,
    );
  }
  if (mode === 'update' && !exists) {
    throw new BaselineError(
      `Baseline "${file}" does not exist. Use "agentconfig-doctor baseline create" first.`,
    );
  }
  await writeFile(file, serializeBaseline(baseline), {
    encoding: 'utf8',
    flag: mode === 'create' ? 'wx' : 'w',
  });
}
