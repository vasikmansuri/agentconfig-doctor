import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { DiscoveredFile, SkippedFile } from '../types/index.js';
import { createMatcher } from '../util/glob.js';
import { classifyPath, DEFAULT_IGNORED_DIRS } from './classify.js';

export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1 MiB
export const DEFAULT_MAX_ENTRIES = 200_000;
const MAX_DEPTH = 40;

export interface DiscoveryOptions {
  include?: readonly string[];
  exclude?: readonly string[];
  maxFileSize?: number;
  maxEntries?: number;
}

export interface DiscoveryResult {
  /** Real (symlink-resolved) absolute path of the scan root directory. */
  root: string;
  files: DiscoveredFile[];
  skipped: SkippedFile[];
  /** True when the directory walk stopped early at `maxEntries`. */
  truncated: boolean;
}

/** An error caused by user input (bad path, unsupported file). Maps to exit code 2. */
export class InputError extends Error {
  override name = 'InputError';
}

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  if (rel === '') return true;
  return !path.isAbsolute(rel) && rel.split(path.sep)[0] !== '..';
}

const byPath = (a: { path: string }, b: { path: string }) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

/**
 * Finds supported agent configuration files under `target`. Never follows a
 * symlink to a location outside the scan root, never descends into symlinked
 * directories (avoids cycles), and skips oversized files.
 */
export async function discover(
  target: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const absolute = path.resolve(target);
  let info;
  try {
    info = await stat(absolute);
  } catch (error) {
    throw new InputError(`Cannot access "${target}": ${errorCode(error)}`);
  }
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

  if (info.isFile()) {
    const real = await realpath(absolute);
    const kind = classifyPath(toPosix(absolute)) ?? classifyPath(toPosix(real));
    if (!kind) {
      throw new InputError(
        `"${target}" is not a supported agent configuration file. Run "agentconfig-doctor rules" to see supported formats.`,
      );
    }
    const display = toPosix(path.normalize(target));
    const root = path.dirname(real);
    if (info.size > maxFileSize) {
      return {
        root,
        files: [],
        skipped: [{ path: display, reason: sizeReason(info.size, maxFileSize) }],
        truncated: false,
      };
    }
    return {
      root,
      files: [{ path: display, absolutePath: real, kind }],
      skipped: [],
      truncated: false,
    };
  }
  if (!info.isDirectory()) {
    throw new InputError(`"${target}" is not a regular file or directory`);
  }

  const root = await realpath(absolute);
  const include = options.include?.length ? createMatcher(options.include) : undefined;
  const exclude = createMatcher(options.exclude ?? []);
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const files: DiscoveredFile[] = [];
  const skipped: SkippedFile[] = [];
  let visited = 0;
  let truncated = false;

  const walk = async (relDir: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth > MAX_DEPTH) {
      skipped.push({ path: relDir, reason: `directory nesting exceeds ${MAX_DEPTH} levels` });
      return;
    }
    let entries;
    try {
      entries = await readdir(path.join(root, relDir), { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: relDir || '.', reason: `directory unreadable (${errorCode(error)})` });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (++visited > maxEntries) {
        truncated = true;
        skipped.push({
          path: relDir || '.',
          reason: `stopped after visiting ${maxEntries} entries; narrow the scan path`,
        });
        return;
      }
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(root, rel);

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name) || exclude(rel)) continue;
        await walk(rel, depth + 1);
        continue;
      }

      const kind = classifyPath(rel);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = await realpath(abs);
        } catch {
          if (kind) skipped.push({ path: rel, reason: 'broken symlink' });
          continue;
        }
        const targetIsDir = await isDirectory(target);
        if (!isWithin(root, target)) {
          if (kind || targetIsDir) {
            skipped.push({
              path: rel,
              reason: 'symlink points outside the scan root (not followed)',
            });
          }
          continue;
        }
        if (targetIsDir) {
          if (!DEFAULT_IGNORED_DIRS.has(entry.name) && !exclude(rel)) {
            skipped.push({ path: rel, reason: 'symlinked directory not followed' });
          }
          continue;
        }
      } else if (!entry.isFile()) {
        continue;
      }

      if (!kind) continue;
      if (include && !include(rel)) continue;
      if (exclude(rel)) continue;

      let size: number;
      try {
        size = (await stat(abs)).size;
      } catch (error) {
        skipped.push({ path: rel, reason: `unreadable (${errorCode(error)})` });
        continue;
      }
      if (size > maxFileSize) {
        skipped.push({ path: rel, reason: sizeReason(size, maxFileSize) });
        continue;
      }
      files.push({ path: rel, absolutePath: abs, kind });
    }
  };

  await walk('', 0);
  files.sort(byPath);
  skipped.sort(byPath);
  return { root, files, skipped, truncated };
}

export type ReadResult = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Reads a discovered file, re-checking the symlink boundary and size at read
 * time to narrow the window for files that change during the scan.
 */
export async function readDiscoveredFile(
  root: string,
  file: DiscoveredFile,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
): Promise<ReadResult> {
  try {
    const link = await lstat(file.absolutePath);
    const real = await realpath(file.absolutePath);
    if (link.isSymbolicLink() && !isWithin(root, real)) {
      return { ok: false, reason: 'symlink points outside the scan root (not followed)' };
    }
    const buffer = await readFile(real);
    if (buffer.length > maxFileSize) {
      return { ok: false, reason: sizeReason(buffer.length, maxFileSize) };
    }
    if (buffer.includes(0)) {
      return { ok: false, reason: 'binary content (NUL bytes); not a text config' };
    }
    return { ok: true, text: buffer.toString('utf8') };
  } catch (error) {
    return { ok: false, reason: `unreadable (${errorCode(error)})` };
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function sizeReason(size: number, max: number): string {
  return `file is ${size} bytes, larger than the ${max}-byte limit (see --max-file-size)`;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}
