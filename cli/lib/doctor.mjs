// jig doctor: report harness gaps in a repo. Reads only; never changes files.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { git, stateDir } from './git.mjs';
import { pathMatches } from './hooks.mjs';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function walk(root, depth, pred, out = [], rel = '') {
  if (depth < 0) return out;
  let names = [];
  try { names = readdirSync(join(root, rel)); } catch { return out; }
  for (const n of names) {
    if (['node_modules', '.git', 'dist', 'build', '.venv', 'venv', 'target', 'vendor', '.next'].includes(n)) continue;
    const r = rel ? `${rel}/${n}` : n;
    let st; try { st = statSync(join(root, r)); } catch { continue; }
    if (st.isDirectory()) walk(root, depth - 1, pred, out, r);
    else if (pred(n, r)) out.push(r);
  }
  return out;
}

// Hash of every repo file that can run code or redirect traffic for an agent.
export function configDigest(root) {
  const files = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json', ...walk(root, 3, (n, r) => r.startsWith('.claude/hooks/'))]
    .filter((f) => existsSync(join(root, f)));
  return createHash('sha256').update(files.map((f) => `${f}\0${read(join(root, f))}`).join('\0')).digest('hex');
}

export function diagnose(root) {
  const F = [];
  const add = (id, level, msg, fix = null) => F.push({ id, level, msg, fix });
  const pkg = json(join(root, 'package.json'));
  const has = (p) => existsSync(join(root, p));
  const isJs = Boolean(pkg);
  const isPy = has('pyproject.toml') || has('setup.py') || has('requirements.txt');

  // D1: one-command verify, named with the repo's own package manager
  const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
  const run = (script) => (pm === 'npm' && script !== 'test' ? `npm run ${script}` : `${pm} ${script}`);
  const verify = [];
  for (const sc of ['verify', 'check']) if (pkg?.scripts?.[sc]) verify.push(run(sc));
  if (pkg?.scripts?.test && !/no test specified/.test(pkg.scripts.test)) verify.push(run('test'));
  if (/^test:/m.test(read(join(root, 'Makefile')) ?? '')) verify.push('make test');
  if (has('Cargo.toml')) verify.push('cargo test');
  if (has('go.mod')) verify.push('go test ./...');
  if (isPy && /pytest/.test((read(join(root, 'pyproject.toml')) ?? '') + (read(join(root, 'requirements-dev.txt')) ?? '') + (read(join(root, 'requirements.txt')) ?? ''))) verify.push('pytest');
  if (verify.length) add('D1', 'ok', `verify command found: ${verify.join(', ')}`);
  else add('D1', 'gap', 'no one-command verify (test script, make test, cargo test, go test, pytest)', 'Add one before agent work. Every slice\'s checks build on it, and agents do measurably better with fast feedback.');
  if (pkg && !pkg.scripts?.typecheck && !pkg.scripts?.lint && has('tsconfig.json')) add('D1', 'info', 'TypeScript repo with no typecheck or lint script', 'Add "typecheck": "tsc --noEmit" so a check can run it.');

  // D2: empty-catch lint (heuristic)
  if (isJs) {
    const cfgs = walk(root, 1, (n) => /^(\.eslintrc(\..+)?|eslint\.config\.(js|mjs|cjs|ts)|biome\.jsonc?)$/.test(n));
    const text = cfgs.map((c) => read(join(root, c)) ?? '').join('\n') + JSON.stringify(pkg.eslintConfig ?? '');
    if (!cfgs.length && !pkg.eslintConfig) add('D2', 'gap', 'no ESLint or Biome config, so nothing flags empty catch blocks', 'Enable ESLint\'s no-empty (in "recommended") or Biome\'s recommended rules.');
    else if (/no-empty|recommended/.test(text)) add('D2', 'ok', `lint config present (${cfgs.join(', ') || 'package.json'}) with no-empty or a recommended preset`);
    else if (/from ['"](@nx\/eslint-plugin|typescript-eslint|@typescript-eslint|@eslint\/js|eslint-config-[\w-]+|@[\w-]+\/eslint-config[\w-]*)['"]|require\(['"](eslint-config-|@[\w-]+\/eslint-config)/.test(text)) {
      add('D2', 'info', `lint config (${cfgs.join(', ')}) imports presets whose rules doctor can't see (it never runs repo code)`, 'Check: npx eslint --print-config <a source file> | grep no-empty');
    }
    else add('D2', 'info', `lint config present (${cfgs.join(', ')}) but no-empty not found`, 'Turn on no-empty; error-masking constructs rose 47% in AI-era code (GitClear 2026).');
  }
  if (isPy) {
    const t = (read(join(root, 'pyproject.toml')) ?? '') + (read(join(root, 'ruff.toml')) ?? '') + (read(join(root, '.flake8')) ?? '');
    if (/BLE|E722|S110|flake8-blind-except/.test(t)) add('D2', 'ok', 'Python lint flags bare or blind except');
    else add('D2', 'gap', 'no lint rule against bare or blind except (ruff E722, BLE001, S110)', 'Add them to ruff\'s select list.');
  }

  // D3: secrets readable without a deny rule
  const secrets = walk(root, 4, (n) => (/^\.env(\..+)?$/.test(n) && !/example|sample|template/.test(n)) || /\.env$/.test(n) && n !== '.env' && !/example/.test(n) || /\.(pem|key|p12)$/.test(n) || /^id_(rsa|ed25519)$/.test(n) || n === 'credentials.json');
  const settings = [json(join(root, '.claude/settings.json')), json(join(root, '.claude/settings.local.json'))].filter(Boolean);
  const deny = settings.flatMap((s) => s.permissions?.deny ?? []).map((d) => d.match(/^Read\((.*)\)$/)?.[1]).filter(Boolean).map((p) => p.replace(/^\.\//, ''));
  const covered = (f) => deny.some((p) => pathMatches(f, p) || (p.startsWith('**/') && (pathMatches(f, p.slice(3)) || pathMatches(f.split('/').pop(), p.slice(3)))));
  const unguarded = secrets.filter((f) => !covered(f));
  if (unguarded.length) add('D3', 'gap', `secret-looking files the agent can read: ${unguarded.slice(0, 6).join(', ')}${unguarded.length > 6 ? ' ...' : ''}`, 'Suggested deny rules for .claude/settings.json (review before adding): {"permissions":{"deny":["Read(./.env)","Read(./.env.*)","Read(./**/*.pem)","Read(~/.ssh/**)","Read(~/.aws/**)"]}}');
  else if (secrets.length) add('D3', 'ok', 'secret-looking files are covered by Read deny rules');

  // D4: repo agent config is an execution vector
  const risky = [];
  for (const [name, s] of [['.claude/settings.json', settings[0]], ['.claude/settings.local.json', settings[1]]]) {
    if (!s) continue;
    if (s.hooks) risky.push(`${name} defines hooks (${Object.keys(s.hooks).join(', ')}), which run commands`);
    if (s.env?.ANTHROPIC_BASE_URL) risky.push(`${name} sets ANTHROPIC_BASE_URL=${s.env.ANTHROPIC_BASE_URL} (API traffic redirection; see CVE-2026-21852)`);
    if (s.permissions?.defaultMode === 'bypassPermissions') risky.push(`${name} sets permissions.defaultMode to bypassPermissions (see CVE-2026-33068)`);
    if (s.enableAllProjectMcpServers) risky.push(`${name} auto-enables every project MCP server (see CVE-2025-59536)`);
    if (s.apiKeyHelper) risky.push(`${name} sets apiKeyHelper, which runs a command`);
  }
  const mcp = json(join(root, '.mcp.json'));
  if (mcp?.mcpServers) risky.push(`.mcp.json declares MCP servers: ${Object.keys(mcp.mcpServers).join(', ')}`);
  if (has('.claude/hooks')) risky.push('.claude/hooks/ contains hook scripts');
  const acked = json(join(stateDir(root), 'doctor-ack.json'))?.digest === configDigest(root);
  if (risky.length && acked) add('D4', 'ok', 'repo-level agent config is unchanged since you marked it reviewed (jig doctor --ack)');
  else if (risky.length) add('D4', 'review', 'repo-level agent config that can run code or redirect traffic:\n    - ' + risky.join('\n    - '), 'Read these before trusting the repo, and keep Claude Code updated. jig never edits them. Once read, `jig doctor --ack` stops this note until they change.');
  else add('D4', 'ok', 'no repo-level hooks, MCP servers or risky settings');

  // D5: CI, secret scanning, SAST
  const wf = walk(root, 2, (n, r) => r.startsWith('.github/workflows/') && /\.ya?ml$/.test(n));
  const ci = wf.map((w) => read(join(root, w)) ?? '').join('\n') + (read(join(root, '.gitlab-ci.yml')) ?? '');
  const hookFiles = [...walk(root, 1, (n, r) => r.startsWith('.githooks/')), ...walk(root, 1, (n, r) => r.startsWith('.husky/')), ...['lefthook.yml', '.pre-commit-config.yaml'].filter(has)];
  const local = hookFiles.map((f) => read(join(root, f)) ?? '').join('\n');
  if (has('.githooks') && !(git(root, ['config', '--local', '--get', 'core.hooksPath']) ?? '').trim()) add('D5', 'gap', '.githooks/ exists but core.hooksPath is not set here, so those hooks never run on this machine', 'git config core.hooksPath .githooks');
  if (!ci.trim() && !local.trim()) add('D5', 'gap', 'no CI configuration or git hooks found', 'Run the verify command in CI so a green result doesn\'t depend on the agent saying so.');
  else {
    const where = ci.trim() ? 'CI config' : 'git hooks';
    if (/gitleaks|trufflehog|detect-secrets|ggshield/.test(ci + local)) add('D5', 'ok', `a secret scanner is configured (${where}); doctor can't tell whether CI actually runs`);
    else add('D5', 'gap', `no secret scanner in the CI config or git hooks (doctor reads the config; it can't tell whether CI runs)`, 'Add gitleaks or trufflehog to CI and to the pre-push hook.');
    if (/codeql|semgrep|snyk|bandit|gosec/.test(ci + local)) add('D5', 'ok', 'static security analysis is configured');
    else add('D5', 'info', 'no SAST configured', 'Consider CodeQL or Semgrep; security prompting reduces issues but doesn\'t remove them.');
  }

  // D6: lockfile drift
  if (pkg) {
    const locks = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'].filter(has);
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
    if (!locks.length && deps.length) add('D6', 'gap', 'package.json has dependencies but no lockfile', 'Commit a lockfile and install with npm ci in CI.');
    else if (locks.includes('package-lock.json')) {
      const lock = json(join(root, 'package-lock.json'));
      const locked = lock?.packages?.['']?.dependencies || lock?.packages?.[''] ? { ...(lock.packages[''].dependencies ?? {}), ...(lock.packages[''].devDependencies ?? {}) } : null;
      const missing = locked ? deps.filter((d) => !(d in locked)) : [];
      if (missing.length) add('D6', 'gap', `package-lock.json is missing: ${missing.join(', ')}`, 'Run npm install and review the lockfile diff.');
      else add('D6', 'ok', 'lockfile matches package.json');
    } else if (locks.length) add('D6', 'ok', `lockfile present (${locks.join(', ')})`);
  }
  return F;
}

const ICON = { ok: 'ok    ', gap: 'GAP   ', review: 'REVIEW', info: 'note  ' };

export function doctor(root, { json: asJson = false, ack = false } = {}) {
  if (ack) {
    const d = configDigest(root);
    writeFileSync(join(stateDir(root), 'doctor-ack.json'), JSON.stringify({ digest: d, at: new Date().toISOString() }));
    console.log('Marked the repo-level agent config as reviewed. jig doctor will flag it again if any of those files change.');
  }
  const F = diagnose(root);
  if (asJson) console.log(JSON.stringify(F, null, 2));
  else {
    for (const f of F) {
      console.log(`${ICON[f.level]} ${f.id} ${f.msg}`);
      if (f.fix && f.level !== 'ok') console.log(`       ${f.fix}`);
    }
    const gaps = F.filter((f) => f.level === 'gap' || f.level === 'review').length;
    console.log(gaps ? `\n${gaps} item(s) to look at. jig doctor changed nothing.` : '\nNo gaps found. jig doctor changed nothing.');
  }
  return 0;
}
