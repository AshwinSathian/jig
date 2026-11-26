#!/usr/bin/env node
// Wall time of the work the Stop and SessionStart hooks add in a repo: a fresh
// node process that loads jig and computes the working-tree id, as a hook
// does. Then the whole pre-bash hook on a `git commit`, which runs the commit
// gate (observed, so it only writes to the repo's .git/jig/observe.jsonl).
// Exits 1 when either p50 reaches the 1000 ms budget (hooks time out at 10 s).
// Usage: node evals/hook-timing.mjs [repo] [--runs 7]
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, statSync, truncateSync, rmSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const repo = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const runs = Number(args.includes('--runs') ? args[args.indexOf('--runs') + 1] : 7);
const verify = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'lib', 'verify.mjs')).href;
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'jig.mjs');
const BUDGET = 1000;

const ms = [];
let tree = null;
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  const r = spawnSync('node', ['--input-type=module', '-e', `import { workTree } from ${JSON.stringify(verify)}; process.stdout.write(String(workTree(process.argv[1])));`, repo], { encoding: 'utf8' });
  ms.push(performance.now() - t0);
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  tree = r.stdout;
}
ms.sort((a, b) => a - b);
const p50 = Math.round(ms[Math.floor(ms.length / 2)]);
console.log(`stop hook p50 ${p50} ms, max ${Math.round(ms[ms.length - 1])} ms, min ${Math.round(ms[0])} ms over ${runs} runs · tree ${tree.slice(0, 10)} · ${repo}`);
if (tree === 'null') { console.error('no tree id: not a git repo, or git failed'); process.exit(1); }

// A new session id per run: the gate lets go after two fires in one session,
// which would time the cheap path. The gate logs to the repo's real
// observe.jsonl, which the owner reads to decide whether it enforces, so
// that file and the session files are put back afterwards.
const state = join(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, encoding: 'utf8' }).trim(), 'jig');
const obs = join(state, 'observe.jsonl');
const obsSize = existsSync(obs) ? statSync(obs).size : null;
const tag = `timing-${process.pid}-`;
const cms = [];
for (let i = 0; i < runs; i++) {
  const input = JSON.stringify({ session_id: `${tag}${i}`, cwd: repo, tool_name: 'Bash', tool_input: { command: 'git commit -m timing' } });
  const t0 = performance.now();
  const r = spawnSync('node', [CLI, 'hook', 'pre-bash'], { input, encoding: 'utf8', env: { ...process.env, JIG_GATES: '', JIG_HOOKS_OFF: '' } });
  cms.push(performance.now() - t0);
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
}
if (obsSize === null) rmSync(obs, { force: true }); else truncateSync(obs, obsSize);
for (const f of existsSync(join(state, 'sessions')) ? readdirSync(join(state, 'sessions')) : []) if (f.startsWith(tag)) rmSync(join(state, 'sessions', f));
cms.sort((a, b) => a - b);
const c50 = Math.round(cms[Math.floor(cms.length / 2)]);
console.log(`pre-bash commit p50 ${c50} ms, max ${Math.round(cms[cms.length - 1])} ms over ${runs} runs`);
process.exit(p50 >= BUDGET || c50 >= BUDGET ? 1 : 0);
