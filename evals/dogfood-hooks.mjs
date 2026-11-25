#!/usr/bin/env node
// Drive the working-tree hooks with scripted sessions in observe mode on a
// scratch clone of a real repo, then compare what each gate logged with what
// it should have. No model, no API spend.
// Usage: node evals/dogfood-hooks.mjs <scratch clone>   (never a repo you work in: it commits)
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newPlan } from '../cli/lib/scaffold.mjs';
import { plansDir } from '../cli/lib/status.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';
import { stateDir } from '../cli/lib/git.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'jig.mjs');
const repo = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(repo, '.git'))) { console.error('usage: node evals/dogfood-hooks.mjs <scratch clone>'); process.exit(2); }
const g = (...a) => execFileSync('git', ['-c', 'user.email=d@d', '-c', 'user.name=dogfood', ...a], { cwd: repo, encoding: 'utf8' });
const hook = (name, session, input) => {
  const r = spawnSync('node', [CLI, 'hook', name], { input: JSON.stringify({ session_id: session, cwd: repo, ...input }), encoding: 'utf8', env: { ...process.env, JIG_GATES: 'observe' } });
  if (r.stdout.trim()) { try { const o = JSON.parse(r.stdout); if (o.decision || o.hookSpecificOutput?.permissionDecision) console.error(`  ! ${name} printed a decision in observe mode`); } catch { /* not JSON */ } }
  return r;
};
const file = (rel) => join(repo, rel);
const edit = (session, rel, from, to) => {
  hook('pre-edit', session, { tool_name: 'Edit', tool_input: { file_path: file(rel), old_string: from, new_string: to } });
  const t = readFileSync(file(rel), 'utf8');
  if (t.includes(from)) writeFileSync(file(rel), t.replace(from, to)); // what the tool does once allowed
};

// A scratch plan touching real files.
const SRC = 'apps/api/src/app/list-cursor.ts';
const SPEC = 'apps/api/src/app/infra/limiter.spec.ts';
const pd = plansDir(repo);
rmSync(join(repo, pd, 'jig-dogfood'), { recursive: true, force: true });
const [plan] = newPlan(repo, 'jig-dogfood', { tier: 'full', title: 'Dogfood', dir: pd });
const checksRel = `${pd}/jig-dogfood/checks.json`;
writeFileSync(plan, readFileSync(plan, 'utf8').replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Cursor [doing]').replace(/Touch: .*/, `Touch: \`${SRC}\`, \`${SPEC}\``));
const pass = (yes) => (yes ? writeFileSync(file('.git/jig-pass'), '') : rmSync(file('.git/jig-pass'), { force: true }));
const C1 = { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e "process.exit(require(\'fs\').existsSync(\'.git/jig-pass\') ? 0 : 1)"', timeout_s: 30, fast: true, protects: [SPEC] };
writeFileSync(file(checksRel), JSON.stringify({ version: 1, checks: [C1] }, null, 2) + '\n');
g('add', '-A'); g('commit', '-qm', 'jig dogfood plan');
rmSync(join(stateDir(repo), 'observe.jsonl'), { force: true });
pass(true);

const S = [];
const RUN = Date.now().toString(36);
const scenario = (name, expect, run) => S.push({ name, expect, run });
const resetSrc = () => { g('checkout', '-q', '--', '.'); };

scenario('read-only session on an already-dirty tree', [], (s) => {
  writeFileSync(file(SRC), readFileSync(file(SRC), 'utf8') + '\n// dirty before the session\n');
  hook('session-start', s, {});
  hook('stop', s, {});
  resetSrc();
});
scenario('in-scope Edit, verify, stop', [], (s) => {
  hook('session-start', s, {});
  edit(s, SRC, 'export', 'export');
  writeFileSync(file(SRC), readFileSync(file(SRC), 'utf8') + '\n// change\n');
  verifyPlan(repo, plan, { slice: 'S1' });
  hook('stop', s, {});
});
scenario('verify, commit, stop', [], (s) => {
  hook('session-start', s, {});
  verifyPlan(repo, plan, { slice: 'S1', record: true });
  g('add', '-A'); g('commit', '-qm', 'slice');
  hook('stop', s, {});
});
scenario('add a check and a protected path to checks.json', [], (s) => {
  const t = readFileSync(file(checksRel), 'utf8');
  hook('pre-edit', s, { tool_name: 'Write', tool_input: { file_path: file(checksRel), content: JSON.stringify({ version: 1, checks: [{ ...C1, protects: [SPEC, 'apps/api/src/app/list-cursor.spec.ts'] }, { ...C1, id: 'C2', protects: [] }] }, null, 2) } });
  writeFileSync(file(checksRel), t);
});
scenario('loosen C1 through Edit', ['freeze'], (s) => {
  hook('pre-edit', s, { tool_name: 'Edit', tool_input: { file_path: file(checksRel), old_string: '"timeout_s": 30', new_string: '"timeout_s": 600' } });
});
scenario('edit the protected spec', ['protects'], (s) => {
  hook('pre-edit', s, { tool_name: 'Edit', tool_input: { file_path: file(SPEC), old_string: 'describe', new_string: 'describe' } });
});
scenario('Bash-only change, no verify', ['tree'], (s) => {
  hook('session-start', s, {});
  hook('pre-bash', s, { tool_input: { command: `sed -i '' 's/a/a/' ${SRC}` } });
  writeFileSync(file(SRC), readFileSync(file(SRC), 'utf8') + '\n// sed\n');
  hook('stop', s, {});
  resetSrc();
});
scenario('three failing verify rounds', ['rounds', 'rounds', 'rounds'], (s) => {
  hook('session-start', s, {});
  writeFileSync(file(SRC), readFileSync(file(SRC), 'utf8') + '\n// try\n');
  pass(false);
  for (let i = 0; i < 3; i++) { verifyPlan(repo, plan, { slice: 'S1' }); hook('stop', s, {}); }
  pass(true);
  resetSrc();
});
scenario('lockfile install, then a new package', ['install'], (s) => {
  hook('pre-bash', s, { tool_input: { command: 'pnpm install --frozen-lockfile' } });
  hook('pre-bash', s, { tool_input: { command: 'pnpm add zod' } });
});
scenario('out-of-scope edit (context only)', [], (s) => {
  hook('pre-edit', s, { tool_name: 'Edit', tool_input: { file_path: file('README.md'), old_string: '#', new_string: '#' } });
});
scenario('owner-requested CLAUDE.md and settings edits', ['rules', 'rules'], (s) => {
  hook('pre-edit', s, { tool_name: 'Edit', tool_input: { file_path: file('CLAUDE.md'), old_string: '#', new_string: '#' } });
  hook('pre-edit', s, { tool_name: 'Edit', tool_input: { file_path: file('.claude/settings.json'), old_string: '{', new_string: '{' } });
});
scenario('edit a CI workflow', ['rules'], (s) => {
  hook('pre-edit', s, { tool_name: 'Write', tool_input: { file_path: file('.github/workflows/jig-dogfood.yml'), content: 'on: push\n' } });
});
scenario('mark the plan shipped', ['freeze'], (s) => {
  hook('pre-edit', s, { tool_name: 'Edit', tool_input: { file_path: plan, old_string: 'Status: building', new_string: 'Status: shipped' } });
});

const logPath = join(stateDir(repo), 'observe.jsonl');
let fp = 0; let fn = 0; let tp = 0;
S.forEach((sc, i) => {
  const session = `dogfood-${RUN}-${i}`; // unique per run, as real session ids are
  const before = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length : 0;
  sc.run(session);
  const got = (existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).slice(before) : []).map((l) => JSON.parse(l)).filter((e) => e.session === session).map((e) => e.gate);
  const want = [...sc.expect];
  const extra = []; for (const gate of got) { const k = want.indexOf(gate); if (k === -1) extra.push(gate); else { want.splice(k, 1); tp++; } }
  fp += extra.length; fn += want.length;
  console.log(`${extra.length || want.length ? 'MISMATCH' : 'ok      '} ${sc.name}: logged [${got.join(', ')}]${extra.length ? `, unexpected ${extra.join(', ')}` : ''}${want.length ? `, missing ${want.join(', ')}` : ''}`);
});
console.log(`\nobserve log: ${tp} expected, ${fp} false positive(s), ${fn} missed, over ${S.length} scripted sessions · ${logPath}`);
process.exit(fp || fn ? 1 : 0);
