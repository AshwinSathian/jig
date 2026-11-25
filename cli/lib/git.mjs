import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, lstatSync, readlinkSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

export function headSha(cwd, { short = true } = {}) {
  const out = git(cwd, ['rev-parse', ...(short ? ['--short'] : []), 'HEAD']);
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

// A fingerprint of the working state: every tracked and untracked file
// (honouring .gitignore) that `keep` accepts, by path, type and raw bytes.
// Hashed here rather than with `git add`/`write-tree`, because those run the
// repo's clean filters, and a filter in .git/config is a command this hook
// would run outside the sandbox. ls-files runs none, writes no objects and
// takes no index lock. null when this isn't a repo or git fails.
export function treeId(root, keep = () => true) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (out === null) return null;
  const h = createHash('sha256');
  for (const rel of [...new Set(out.split('\0').filter(Boolean))].sort()) {
    if (!keep(rel)) continue;
    const abs = join(root, rel);
    let st;
    try { st = lstatSync(abs); } catch { continue; } // deleted: its absence changes the hash
    h.update(rel).update('\0');
    // Never let one file stop the hash: an unreadable file is hashed by its
    // size and mtime, and a FIFO, socket or device is never opened (reading
    // one can block the hook).
    try {
      if (st.isSymbolicLink()) h.update('l').update(readlinkSync(abs));
      else if (st.isDirectory()) h.update('d'); // a submodule
      else if (st.isFile()) h.update(st.mode & 0o111 ? 'x' : 'f').update(readFileSync(abs));
      else h.update('o');
    } catch (e) {
      h.update(`e:${e.code}:${st.size}:${st.mtimeMs}`);
    }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 40);
}
