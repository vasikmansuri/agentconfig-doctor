export type PathBreadth = 'root' | 'home' | 'sensitive' | 'system';

export interface BroadPath {
  breadth: PathBreadth;
  normalised: string;
  label: string;
}

/** Locations that commonly hold credentials, relative to a home directory. */
const SENSITIVE_HOME_PATHS = [
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
  '.config/gcloud',
  '.config/gh',
  '.npmrc',
  '.netrc',
  '.pypirc',
  '.git-credentials',
  '.claude',
  '.cursor',
  'Library/Keychains',
];

const SENSITIVE_ABSOLUTE = [
  '/etc/shadow',
  '/etc/sudoers',
  '/var/run/docker.sock',
  '/run/docker.sock',
];
const SYSTEM_DIRS = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/System',
  '/Library',
  '/private',
  '/c/Windows',
];

const HOME_VARIABLE =
  /^(?:\$\{HOME\}|\$HOME|\$\{userHome\}|\$\{env:HOME\}|\$\{env:USERPROFILE\}|%USERPROFILE%|\$env:USERPROFILE)(?=\/|$)/i;

/**
 * Normalises a filesystem path written in a config file: unifies separators,
 * maps home-directory spellings to `~`, and removes trailing glob suffixes.
 * Returns undefined for values that are not absolute or home-relative paths.
 */
export function normalisePath(raw: string): string | undefined {
  let p = raw
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/');
  p = p
    .replace(HOME_VARIABLE, '~')
    .replace(/^([A-Za-z]):(?=\/|$)/, (_m, d: string) => `/${d.toLowerCase()}`)
    .replace(/^\/(?:Users|home)\/[^/*]+(?=\/|$)/, '~')
    .replace(/^\/c\/Users\/[^/*]+(?=\/|$)/i, '~')
    .replace(/^\/root(?=\/|$)/, '~');
  if (!p.startsWith('/') && !p.startsWith('~')) return undefined;
  p = p.replace(/(?:\/\*\*?)+$/, '').replace(/\/+$/, '');
  if (p === '' || /^\/[a-z]$/.test(p)) return '/';
  return p;
}

export function classifyBroadPath(raw: string): BroadPath | undefined {
  const p = normalisePath(raw);
  if (p === undefined) return undefined;
  if (p === '/' || p.startsWith('/**')) {
    return { breadth: 'root', normalised: p, label: 'the entire filesystem' };
  }
  if (p === '~' || p === '/Users' || p === '/home' || p === '/c/Users') {
    return { breadth: 'home', normalised: p, label: 'a whole home directory' };
  }
  if (p.startsWith('~/')) {
    const rest = p.slice(2);
    const hit = SENSITIVE_HOME_PATHS.find((s) => rest === s || rest.startsWith(`${s}/`));
    if (hit) return { breadth: 'sensitive', normalised: p, label: `credential location ~/${hit}` };
    return undefined;
  }
  const abs = SENSITIVE_ABSOLUTE.find((s) => p === s || p.startsWith(`${s}/`));
  if (abs) return { breadth: 'sensitive', normalised: p, label: `sensitive location ${abs}` };
  const sys = SYSTEM_DIRS.find((s) => p.toLowerCase() === s.toLowerCase());
  if (sys) return { breadth: 'system', normalised: p, label: `system directory ${sys}` };
  return undefined;
}
