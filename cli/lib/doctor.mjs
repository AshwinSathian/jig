// jig doctor: report harness gaps in a repo. Reads only; never changes files.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { git } from './git.mjs';
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

// Hash of every repo file that can run code or redirect traffic for an agent:
// everything under .claude/ (no depth limit), .mcp.json, and any repo file the
// settings or MCP config name in a command (plus package.json or Makefile when
// a command runs npm-style scripts or make). Full content, no size shortcut.
export function configDigest(root) {
  const files = new Set(['.mcp.json'].filter((f) => existsSync(join(root, f))));
  const all = (rel) => {
    let names = [];
    try { names = readdirSync(join(root, rel)); } catch { return; }
    for (const n of names) {
      const r = `${rel}/${n}`;
      let st; try { st = statSync(join(root, r)); } catch { continue; }
      if (st.isDirectory()) all(r); else files.add(r);
    }
  };
  if (existsSync(join(root, '.claude'))) all('.claude');
  const text = ['.claude/settings.json', '.claude/settings.local.json', '.mcp.json'].map((f) => read(join(root, f)) ?? '').join('\n');
  const absRoot = resolve(root);
  // Any path-like token in a command may name a script, whatever its extension.
  for (const tok of text.match(/[\w@.\/${}-]*\/[\w@.\/${}-]+|[\w@.-]+\.[\w]+/g) ?? []) {
    const p = resolve(root, tok.replace(/^\$\{?CLAUDE_PROJECT_DIR\}?\//, '').replace(/^\.\//, ''));
    if (p.startsWith(absRoot + sep) && existsSync(p) && statSync(p).isFile()) files.add(p.slice(absRoot.length + 1));
  }
  // Commands that run package scripts or make targets run code those files define.
  if (/\b(npm|pnpm|yarn|bun|npx)\b/.test(text) && existsSync(join(root, 'package.json'))) files.add('package.json');
  if (/\bmake\b/.test(text) && existsSync(join(root, 'Makefile'))) files.add('Makefile');
  const h = createHash('sha256');
  for (const f of [...files].sort()) h.update(`${f}\0`).update(readFileSync(join(root, f))).update('\0');
  return h.digest('hex');
}

// Acks live in the user's home, never in the repo: a repo could ship a
// pre-written ack to silence D4.
function ackPath(root, { create = false } = {}) {
  const dir = join(process.env.JIG_HOME ?? join(homedir(), '.config', 'jig'), 'acks');
  if (create) mkdirSync(dir, { recursive: true });
  return join(dir, createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 32) + '.json');
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
  const acked = json(ackPath(root))?.digest === configDigest(root);
  if (risky.length && acked) add('D4', 'ok', 'repo-level agent config (everything under .claude/, .mcp.json, files their commands name, and package.json or Makefile when commands run them) is unchanged since you ran jig doctor --ack. Code a hook reaches indirectly (imports, PATH lookups) is not tracked');
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
  // D7: a way to run the change, not only test it. Conservative: a gap only
  // for a clear app (a UI or server framework in runtime dependencies of a
  // package with no `bin`) with no sign of e2e; everything else is a note.
  const projectFile = pkg || isPy || has('go.mod') || has('Cargo.toml');
  const skillsDir = join(root, '.claude', 'skills');
  let skill = null;
  try { skill = readdirSync(skillsDir).find((n) => /^verify/.test(n) && existsSync(join(skillsDir, n, 'SKILL.md'))); } catch { /* no .claude/skills */ }
  const SKIP = /(^|\/)(examples?|fixtures?|test|tests|__tests__|docs)\//;
  const pkgs = walk(root, 4, (n, r) => n === 'package.json' && !SKIP.test(r)).map((r) => json(join(root, r))).filter(Boolean);
  if (projectFile || skill || pkgs.length) {
    const allDeps = new Set(pkgs.flatMap((p) => Object.keys({ ...(p.dependencies ?? {}), ...(p.devDependencies ?? {}) })));
    const RUNNERS = ['@playwright/test', 'cypress', 'detox', 'webdriverio', '@wdio/cli', 'supertest', 'pactum'];
    const runner = RUNNERS.find((r) => allDeps.has(r));
    const script = pkgs.flatMap((p) => Object.entries(p.scripts ?? {})).find(([k, v]) => /(^|:)(e2e|integration)\b/.test(k) || /\b(playwright test|cypress run|detox test|maestro test)\b/.test(v));
    const config = walk(root, 4, (n, r) => !SKIP.test(r) && /^(playwright|cypress)\.config\.[cm]?[jt]s$|^\.detoxrc|^detox\.config\.|^wdio\.conf\./.test(n))[0] ?? (has('.maestro') ? '.maestro/' : null);
    const py = isPy ? (read(join(root, 'pyproject.toml')) ?? '') + (read(join(root, 'requirements.txt')) ?? '') : '';
    const APPS = /^(react|react-dom|next|vue|nuxt|svelte|@sveltejs\/kit|@angular\/core|solid-js|astro|electron|react-native|expo|express|fastify|koa|hono|@nestjs\/core|@remix-run\/node)$/;
    const isApp = pkgs.some((p) => !p.bin && Object.keys(p.dependencies ?? {}).some((d) => APPS.test(d))) || /\b(django|fastapi|flask)\b/i.test(py);
    const found = [skill && `.claude/skills/${skill}`, runner && `${runner} installed`, script && `script "${script[0]}"`, config].filter(Boolean);
    if (found.length) add('D7', 'ok', `a way to run the change end to end: ${found.join(', ')}`);
    else if (isApp) add('D7', 'gap', 'no way to run the app end to end: no .claude/skills/verify*/SKILL.md, no e2e or HTTP test runner, no e2e script or runner config', 'Add a verify skill that starts the app and drives the changed flow, or an e2e runner. Tests alone miss what running the change shows.');
    else add('D7', 'info', 'no e2e runner or verify skill; fine for a CLI or library if a check runs the real command', 'Give user-visible slices one check that runs the built CLI or public API, not only unit tests.');
  }
  return F;
}

const ICON = { ok: 'ok    ', gap: 'GAP   ', review: 'REVIEW', info: 'note  ' };

export function doctor(root, { json: asJson = false, ack = false } = {}) {
  if (ack) {
    const d = configDigest(root);
    writeFileSync(ackPath(root, { create: true }), JSON.stringify({ root: realpathSync(root), digest: d, at: new Date().toISOString() }));
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
