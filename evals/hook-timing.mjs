#!/usr/bin/env node
// Wall time of the work the Stop and SessionStart hooks add in a repo: a fresh
// node process that loads jig and computes the working-tree id, as a hook
// does. Exits 1 when the p50 reaches the 1000 ms budget (hooks time out at 10 s).
// Usage: node evals/hook-timing.mjs [repo] [--runs 7]
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const repo = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const runs = Number(args.includes('--runs') ? args[args.indexOf('--runs') + 1] : 7);
const verify = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'lib', 'verify.mjs')).href;
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
process.exit(p50 >= BUDGET ? 1 : 0);
