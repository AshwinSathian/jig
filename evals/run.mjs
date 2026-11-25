#!/usr/bin/env node
// Task evals: run each fixture task in each arm, then grade with commands.
// Usage: node evals/run.mjs [--tasks a,b] [--arms none,jig,planmode,superpowers] [--runs 1] [--model m] [--budget 3] [-j 2]
// Every run spends real money on your account. Start small.
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks/tasks.mjs';
import { runClaude, arms, usageOf, pool } from './lib/claude.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JIG = join(HERE, '..');
const SUPERPOWERS = process.env.SUPERPOWERS_DIR ?? join(process.env.HOME, '.claude/plugins/cache/claude-plugins-official/superpowers/7.0.2');
const flag = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : process.argv[i + 1]; };
const taskIds = flag('tasks', TASKS.map((t) => t.id).join(',')).split(',');
const armNames = flag('arms', 'none,jig').split(',');
const runs = Number(flag('runs', '1'));
const model = flag('model', undefined);
const budget = Number(flag('budget', '3'));
const conc = Number(flag('j', '2'));
const ARMS = arms({ jigDir: JIG, superpowersDir: SUPERPOWERS });

// Tools the agent may use without prompting. Everything else is denied in -p
// mode, which is also how a jig `ask` decision lands headless.
const ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Skill', 'Agent', 'TodoWrite', 'Bash(node:*)', 'Bash(npm test:*)', 'Bash(npm run:*)', 'Bash(npm install:*)', 'Bash(npm view:*)', 'Bash(git:*)', 'Bash(jig:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(test:*)', 'Bash(mkdir:*)'];

function scaffold(task) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `jig-eval-${task.id}-`)));
  for (const [p, body] of Object.entries(task.files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  const g = (...a) => execFileSync('git', ['-c', 'user.email=eval@example.com', '-c', 'user.name=eval', ...a], { cwd: dir, stdio: 'ignore' });
  g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'fixture');
  return dir;
}

function grade(task, dir, out) {
  for (const [p, body] of Object.entries(task.hidden ?? {})) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  const final = out.result?.result ?? '';
  return task.graders.map((g) => {
    if (g.transcript) return { name: g.name, pass: g.transcript.test(final) };
    const r = spawnSync('sh', ['-c', g.cmd], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, JIG_CLI: join(JIG, 'cli/jig.mjs') } });
    return { name: g.name, pass: r.status === 0, detail: r.status === 0 ? '' : (r.stdout + r.stderr).trim().split('\n').slice(-2).join(' ').slice(0, 160) };
  });
}

const jobs = [];
for (const id of taskIds) for (const arm of armNames) for (let r = 0; r < runs; r++) jobs.push({ task: TASKS.find((t) => t.id === id), arm, r });
if (jobs.some((j) => !j.task)) { console.error('unknown task id'); process.exit(2); }
console.error(`${jobs.length} runs (${taskIds.length} tasks x ${armNames.length} arms x ${runs}), budget cap $${budget} each`);

const results = await pool(jobs, conc, async ({ task, arm, r }) => {
  const dir = scaffold(task);
  const out = await runClaude({ cwd: dir, prompt: task.prompt, armFlags: ARMS[arm], model, budgetUsd: budget, timeoutMs: 20 * 60_000, extra: [...(arm === 'planmode' ? [] : ['--permission-mode', 'acceptEdits']), '--allowedTools', ALLOWED.join(',')] });
  const grades = grade(task, dir, out);
  const usage = usageOf(out.result);
  const planFiles = existsSync(join(dir, 'docs/plans')) ? spawnSync('sh', ['-c', 'ls docs/plans'], { cwd: dir, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean) : [];
  const lint = planFiles.length ? spawnSync('node', [join(JIG, 'cli/jig.mjs'), 'lint', 'docs/plans'], { cwd: dir, encoding: 'utf8' }) : null;
  const row = { task: task.id, arm, run: r, pass: grades.every((g) => g.pass), grades, usage, skills: out.skills, planFiles, planLint: lint ? (lint.status === 0 ? 'ok' : lint.stdout.split('\n').filter((l) => / error /.test(l)).length + ' errors') : null, killed: out.killed, dir };
  console.error(`${row.pass ? 'PASS' : 'FAIL'} ${task.id} [${arm}] $${usage?.costUsd?.toFixed(2) ?? '?'} ${grades.map((g) => `${g.pass ? '+' : '-'}${g.name}`).join(' | ')}`);
  return row;
});

const outDir = join(HERE, 'results'); mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
writeFileSync(join(outDir, `tasks-${stamp}.json`), JSON.stringify(results, null, 2));
console.log(`\narm          pass   cost/run  turns  cacheRead  cacheWrite`);
for (const arm of armNames) {
  const rs = results.filter((x) => x.arm === arm);
  const avg = (f) => rs.reduce((s, x) => s + (f(x) ?? 0), 0) / rs.length;
  console.log(`${arm.padEnd(12)} ${String(rs.filter((x) => x.pass).length).padStart(2)}/${rs.length}  $${avg((x) => x.usage?.costUsd).toFixed(2).padStart(6)}  ${avg((x) => x.usage?.turns).toFixed(1).padStart(5)}  ${Math.round(avg((x) => x.usage?.cacheRead)).toString().padStart(9)}  ${Math.round(avg((x) => x.usage?.cacheWrite)).toString().padStart(10)}`);
}
console.log(`\nraw: evals/results/tasks-${stamp}.json`);
