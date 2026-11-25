import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Hardened git: hooks scripts run outside the Bash sandbox, so don't let a
// checkout's config start programs (fsmonitor, hooks).
const HARDEN = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null'];

export function git(cwd, args, { allowFail = true } = {}) {
  try {
    return execFileSync('git', [...HARDEN, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

export function repoRoot(cwd) {
  const out = git(cwd, ['rev-parse', '--show-toplevel']);
  return out ? out.trim() : null;
}

export function headSha(cwd) {
  const out = git(cwd, ['rev-parse', '--short', 'HEAD']);
  return out ? out.trim() : null;
}

export function isCommit(cwd, sha) {
  return git(cwd, ['cat-file', '-e', `${sha}^{commit}`]) !== null;
}

export function showHead(cwd, relPath) {
  return git(cwd, ['show', `HEAD:${relPath}`]);
}

// Per-repo state that must not be committed: inside .git when there is one.
export function stateDir(root) {
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  const dir = gitDir ? join(gitDir.trim(), 'jig') : join(root, '.jig-state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
