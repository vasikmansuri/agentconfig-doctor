import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { InputError } from '../discovery/discover.js';
import { RULES } from '../rules/index.js';
import type { DoctorConfig } from '../types/index.js';

const ruleId = z
  .string()
  .transform((s) => s.toUpperCase())
  .refine((id) => RULES.some((r) => r.id === id), { message: 'unknown rule ID' });

const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    disabledRules: z.array(ruleId).default([]),
    ignore: z
      .array(
        z
          .object({
            rule: ruleId,
            path: z.string().optional(),
            fingerprint: z
              .string()
              .regex(/^[0-9a-f]{16}$/)
              .optional(),
            reason: z.string().optional(),
          })
          .strict(),
      )
      .default([]),
    allowedPaths: z.array(z.string()).default([]),
    allowedHosts: z.array(z.string()).default([]),
  })
  .strict();

export const DEFAULT_CONFIG: DoctorConfig = {
  disabledRules: [],
  ignore: [],
  allowedPaths: [],
  allowedHosts: [],
};

export function parseConfig(value: unknown, source = 'config'): DoctorConfig {
  const parsed = ConfigSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new InputError(`Invalid ${source}:\n${details}`);
  }
  const { disabledRules, ignore, allowedPaths, allowedHosts } = parsed.data;
  return {
    disabledRules,
    ignore: ignore.map(({ rule, path, fingerprint }) => ({ rule, path, fingerprint })),
    allowedPaths,
    allowedHosts,
  };
}

/**
 * Loads an explicit agentconfig-doctor config file. Config is never read from
 * the scanned directory automatically, because a malicious repository could
 * otherwise disable the rules that would flag it.
 */
export async function loadConfig(file: string): Promise<DoctorConfig> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new InputError(`Cannot read config file "${file}": ${(error as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError(`Config file "${file}" is not valid JSON.`);
  }
  return parseConfig(value, `config file "${file}"`);
}
