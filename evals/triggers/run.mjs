#!/usr/bin/env node
// Which skill fires first for each prompt, per arm. Stops each run at its
// first Skill call, so a run costs one turn.
// Usage: node evals/triggers/run.mjs [--arms jig,jig+superpowers] [--runs 1] [--model opus]
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude, arms, pool } from '../lib/claude.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JIG = join(HERE, '..', '..');
const SUPERPOWERS = process.env.SUPERPOWERS_DIR ?? join(process.env.HOME, '.claude/plugins/cache/claude-plugins-official/superpowers/7.0.2');
const cases = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));

const flag = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : process.argv[i + 1]; };
const armNames = flag('arms', 'jig,jig+superpowers').split(',');
const runs = Number(flag('runs', '1'));
const model = flag('model', undefined);
const ARMS = arms({ jigDir: JIG, superpowersDir: SUPERPOWERS });

function scaffold() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-trig-')));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-api', type: 'module', scripts: { test: 'node --test' } }, null, 2));
  writeFileSync(join(dir, 'src/server.js'), "import http from 'node:http';\nexport const app = http.createServer((req, res) => { res.end('ok'); });\n");
  writeFileSync(join(dir, 'src/cli.js'), "#!/usr/bin/env node\nconsole.log('demo');\n");
  writeFileSync(join(dir, 'README.md'), '# demo-api\n\nA small reports API. Teh tests run with npm test.\n');
  for (const a of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'init']]) execFileSync('git', a, { cwd: dir });
  return dir;
}

const jobs = [];
for (const c of cases) for (const arm of armNames) for (let r = 0; r < runs; r++) jobs.push({ c, arm, r });

const results = await pool(jobs, 4, async ({ c, arm }) => {
  const out = await runClaude({ cwd: scaffold(), prompt: c.prompt, armFlags: ARMS[arm], model, budgetUsd: 1, timeoutMs: 180_000, stopOnSkill: true });
  const first = out.skills[0] ?? 'none';
  const firedJig = /(^|:)plan$/.test(first) && !first.startsWith('superpowers');
  const pass = c.expect === 'either' ? true : c.expect === 'jig' ? firedJig : !firedJig;
  process.stderr.write(`${pass ? 'ok  ' : 'MISS'} [${arm}] ${c.id}: first skill = ${first}\n`);
  return { id: c.id, arm, expect: c.expect, first, pass, killed: out.killed };
});

const byArm = {};
for (const r of results) { (byArm[r.arm] ??= []).push(r); }
for (const [arm, rs] of Object.entries(byArm)) console.log(`${arm}: ${rs.filter((r) => r.pass).length}/${rs.length} as expected`);
const outDir = join(HERE, '..', 'results'); mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `triggers-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`), JSON.stringify(results, null, 2));
