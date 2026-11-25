#!/usr/bin/env node
// Live hook smoke: one real Claude Code session, with this checkout loaded as
// a plugin, in observe mode, on a scratch fixture repo. It checks what the
// unit tests can't: that real Edit, Write and Bash payloads reach the hooks in
// the shape they parse. Spends API money (capped by --budget, default $1).
// Usage: node evals/hooks-live.mjs [--budget 1] [--keep]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude, usageOf } from './lib/claude.mjs';

const JIG = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const budget = Number(argv.includes('--budget') ? argv[argv.indexOf('--budget') + 1] : 1);

// The fixture lives outside this checkout: Claude Code protects the plugin dir.
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-live-')));
process.on('exit', () => { if (!argv.includes('--keep')) rmSync(dir, { recursive: true, force: true }); });
const PLAN = `# Demo

Status: building · Tier: full · Baseline: HEAD · Updated: 2026-11-25
Now: S1 in progress.

## Outcome
\`a\` is 2.
Done when:
- C1 passes under \`jig verify\`

## Decisions
- None.

## Out of scope
- Nothing else.

## Questions
- None.

## Assumptions
- None.

## Slices

### S1: Set a [doing]
Goal: a is 2.
Touch: \`src/a.js\`, \`test/\`, \`CLAUDE.md\`
Checks: C1

## Log
- 2026-11-25: Started.
`;
const CHECKS = { version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true, protects: ['test/a.accept.test.js'] }] };
const files = {
  'src/a.js': 'export const a = 1;\n',
  'test/a.accept.test.js': '// acceptance test for a\n',
  'CLAUDE.md': '# Notes\n\nBuild with node.\n',
  'docs/plans/demo/PLAN.md': PLAN,
  'docs/plans/demo/checks.json': JSON.stringify(CHECKS, null, 2) + '\n',
};
for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b); }
const git = (...a) => execFileSync('git', ['-c', 'user.email=e@e', '-c', 'user.name=e', ...a], { cwd: dir, encoding: 'utf8' });
git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');

const prompt = `This is a hook test in a scratch repo. Do these steps in order, each with exactly the tool named, and nothing else:
1. Use the Edit tool on docs/plans/demo/checks.json to add a second check: insert this object after C1's object, with a comma, inside the "checks" array: {"id": "C2", "slice": "S1", "kind": "regression", "cmd": "node -e \\"\\"", "timeout_s": 10, "fast": true}
2. Use the Edit tool on docs/plans/demo/checks.json to change C1's "cmd" value from node -e "" to true.
3. Use the Write tool to overwrite test/a.accept.test.js with the single line: // rewritten
4. Use the Edit tool on CLAUDE.md to replace "Build with node." with "Build with node 24."
5. Use the Bash tool to run exactly: node -e "require('fs').writeFileSync('src/a.js', 'export const a = 2;\\n')"
Then stop. Do not run jig verify or any tests.`;

const out = await runClaude({
  cwd: dir, prompt, budgetUsd: budget, timeoutMs: 10 * 60_000,
  armFlags: ['--plugin-dir', JIG, '--permission-mode', 'acceptEdits'],
  extra: ['--allowedTools', 'Read,Edit,Write,Bash(node:*)'],
  env: { ...process.env, JIG_GATES: 'observe', JIG_NUDGE: 'off', PATH: `${join(JIG, 'bin')}:${process.env.PATH}` },
});

const logPath = join(dir, '.git', 'jig', 'observe.jsonl');
const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const tools = out.tools.map((t) => t.name);
const count = (n) => tools.filter((t) => t === n).length;
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

// The run is only valid if the model used the tools the steps name.
const valid = count('Edit') >= 3 && count('Write') >= 1 && count('Bash') >= 1;
check('the session used Edit x3, Write x1 and Bash x1', valid, `tools: ${tools.join(', ')}`);
const freeze = log.filter((e) => e.gate === 'freeze');
check('one freeze entry, for loosening C1 (Edit old_string/new_string parsed)', freeze.length === 1 && /C1 \(cmd\)/.test(freeze[0]?.reason ?? '') && freeze[0]?.file === 'docs/plans/demo/checks.json', JSON.stringify(freeze.map((e) => e.reason)));
check('adding C2 raised no freeze entry', !freeze.some((e) => /C2/.test(e.reason)));
const prot = log.filter((e) => e.gate === 'protects');
check('a protects entry for the Write (Write file_path parsed)', prot.length >= 1 && prot.every((e) => e.file === 'test/a.accept.test.js'), JSON.stringify(prot.map((e) => e.file)));
check('a rules entry for CLAUDE.md', log.some((e) => e.gate === 'rules' && e.file === 'CLAUDE.md'));
check('a tree entry from Stop for the Bash-only change', log.some((e) => e.gate === 'tree' && e.hook === 'stop'));
check('every entry has a session id, and every pre-edit entry a file', log.length > 0 && log.every((e) => e.session && e.session !== 'nosession' && (e.hook !== 'pre-edit' || e.file)));
const after = readFileSync(join(dir, 'docs/plans/demo/checks.json'), 'utf8');
check('observe mode let the edits through (checks.json now has C2 and cmd true)', /"C2"/.test(after) && /"cmd": "true"/.test(after));

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : `\n     ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} · ${log.length} observe entries · $${(usageOf(out.result)?.costUsd ?? 0).toFixed(2)}${out.killed ? ` · killed: ${out.killed}` : ''}${valid ? '' : ' · INVALID run: the model did not use the named tools'}`);
if (argv.includes('--keep')) console.log(`fixture kept at ${dir}`);
process.exit(failed ? 1 : 0);
