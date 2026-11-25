// Hook test helpers shared by the hook test files. tempRepo stays in verify.test.mjs.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo } from './verify.test.mjs';
import { newPlan } from '../cli/lib/scaffold.mjs';

export const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'jig.mjs');

export function hook(name, input, env = {}) {
  const r = spawnSync('node', [CLI, 'hook', name], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, JIG_NUDGE: 'on', JIG_HOOKS_OFF: '', JIG_GATES: '', ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
}

// A repo with an approved full plan: S1 doing, touching src/a.js, C1 protecting test/a.accept.test.js.
export function planRepo() {
  const { dir, g } = tempRepo();
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'test/a.accept.test.js'), '// spec\n');
  const [planPath] = newPlan(dir, 'demo', { tier: 'full', title: 'Demo' });
  let t = readFileSync(planPath, 'utf8');
  t = t.replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Add a [doing]').replace(/Touch: .*/, 'Touch: `src/a.js`, `test/`');
  writeFileSync(planPath, t);
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [
    { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true, protects: ['test/a.accept.test.js'] },
  ] }));
  g('add', '-A'); g('commit', '-qm', 'plan');
  return { dir, g, planPath };
}

export const base = (dir, extra = {}) => ({ session_id: 's1', cwd: dir, ...extra });
