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

// Each step names its tool and file, so every payload field the hooks read
// decides an outcome: Edit old_string/new_string (steps 1-2), Write content
// (step 3), Write file_path (step 4), Edit on a rule file (step 5), and the
// Bash command (step 6, shaped like an install the shell never reaches).
const LOOSE = '{"version": 1, "checks": [{"id": "C1", "slice": "S1", "kind": "acceptance", "cmd": "true", "timeout_s": 10, "fast": true, "protects": ["test/a.accept.test.js"]}, {"id": "C2", "slice": "S1", "kind": "regression", "cmd": "node -e \\"\\"", "timeout_s": 100, "fast": true}]}';
const prompt = `This is a hook test in a scratch repo. Do these steps in order, each with exactly the tool named, and nothing else:
1. Use the Edit tool on docs/plans/demo/checks.json to add a second check: insert this object after C1's object, with a comma, inside the "checks" array: {"id": "C2", "slice": "S1", "kind": "regression", "cmd": "node -e \\"\\"", "timeout_s": 10, "fast": true}
2. Use the Edit tool on docs/plans/demo/checks.json to change C2's "timeout_s" from 10 to 100.
3. Use the Write tool to overwrite docs/plans/demo/checks.json with exactly: ${LOOSE}
4. Use the Write tool to overwrite test/a.accept.test.js with the single line: // rewritten
5. Use the Edit tool on CLAUDE.md to replace "Build with node." with "Build with node 24."
6. Use the Bash tool to run exactly: echo skip || npm i left-padd
7. Use the Bash tool to run exactly: node -e "require('fs').writeFileSync('src/a.js', 'export const a = 2;\\n')"
Then stop. Do not run jig verify or any tests.`;

const out = await runClaude({
  cwd: dir, prompt, budgetUsd: budget, timeoutMs: 10 * 60_000,
  armFlags: ['--plugin-dir', JIG, '--permission-mode', 'acceptEdits'],
  extra: ['--allowedTools', 'Read,Edit,Write,Bash(node:*),Bash(echo:*)'],
  env: { ...process.env, JIG_GATES: 'observe', JIG_NUDGE: 'off', PATH: `${join(JIG, 'bin')}:${process.env.PATH}` },
});

const logPath = join(dir, '.git', 'jig', 'observe.jsonl');
const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

// The run is only valid if each step used the tool it names on the file it names.
const calls = out.tools.map((x) => ({ name: x.name, file: (x.input?.file_path ?? '').replace(`${dir}/`, '').replace(/^.*\/(?=docs\/|test\/|src\/|CLAUDE\.md)/, ''), command: x.input?.command ?? '' }));
const did = (name, file) => calls.filter((c) => c.name === name && c.file === file).length;
const valid = did('Edit', 'docs/plans/demo/checks.json') >= 2 && did('Write', 'docs/plans/demo/checks.json') >= 1 && did('Write', 'test/a.accept.test.js') >= 1 && did('Edit', 'CLAUDE.md') >= 1 && calls.some((c) => c.name === 'Bash' && /left-padd/.test(c.command)) && calls.some((c) => c.name === 'Bash' && /src\/a\.js/.test(c.command));
check('each step used the named tool on the named file', valid, `calls: ${calls.map((c) => `${c.name}:${c.file || c.command.slice(0, 30)}`).join(', ')}`);
const freeze = log.filter((e) => e.gate === 'freeze');
check('Edit loosening C2 timeout_s gives a freeze entry (old_string/new_string parsed)', freeze.some((e) => /C2 \(timeout_s\)/.test(e.reason)), JSON.stringify(freeze.map((e) => e.reason)));
check('Write loosening C1 cmd gives a freeze entry (Write content parsed)', freeze.some((e) => /C1 \(cmd\)/.test(e.reason)));
check('adding C2 raised no freeze entry about C2 being added', !freeze.some((e) => /C2 \(removed\)/.test(e.reason)) && freeze.length === 2, `${freeze.length} freeze entries`);
check('every freeze entry names checks.json', freeze.every((e) => e.file === 'docs/plans/demo/checks.json'));
const prot = log.filter((e) => e.gate === 'protects');
check('a protects entry for the Write to the test (Write file_path parsed)', prot.length >= 1 && prot.every((e) => e.file === 'test/a.accept.test.js'), JSON.stringify(prot.map((e) => e.file)));
check('a rules entry for CLAUDE.md', log.some((e) => e.gate === 'rules' && e.file === 'CLAUDE.md'));
const inst = log.filter((e) => e.gate === 'install');
check('an install entry for left-padd (Bash command parsed)', inst.length === 1 && /left-padd/.test(inst[0].reason) && /left-padd/.test(inst[0].command ?? ''), JSON.stringify(inst));
check('the Bash change landed (src/a.js now sets a = 2)', /a = 2/.test(readFileSync(join(dir, 'src/a.js'), 'utf8')));
check('a tree entry from Stop', log.some((e) => e.gate === 'tree' && e.hook === 'stop'));
check('every entry has a session id, and every pre-edit entry a file', log.length > 0 && log.every((e) => e.session && e.session !== 'nosession' && (e.hook !== 'pre-edit' || e.file)));

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok || !r.detail ? '' : `\n     ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} · ${log.length} observe entries · $${(usageOf(out.result)?.costUsd ?? 0).toFixed(2)}${out.killed ? ` · killed: ${out.killed}` : ''}${valid ? '' : ' · INVALID run: the model did not use the named tools'}`);
if (argv.includes('--keep')) console.log(`fixture kept at ${dir}`);
process.exit(failed ? 1 : 0);
