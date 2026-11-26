#!/usr/bin/env node
// Writes the README's "A real run" section from the current CLI and hooks.
//   node scripts/readme-run.mjs            rewrite the section in README.md
//   node scripts/readme-run.mjs --check    exit 1 if README.md differs
//   --readme <path>                        use another README (tests)
// It drives cli/jig.mjs in a throwaway repo with a fixed author and date, so
// hashes repeat across machines. Durations and the temp path are normalised.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'jig.mjs');
const args = process.argv.slice(2);
const readme = args.includes('--readme') ? args[args.indexOf('--readme') + 1] : join(ROOT, 'README.md');
const START = '<!-- run:start -->';
const END = '<!-- run:end -->';

// The hooks take their root from CLAUDE_PROJECT_DIR when cwd is missing, and
// the gate variables would silence them. NODE_TEST_CONTEXT, set when this runs
// under node --test, would turn the fixture's own test run into a subtest.
const env = { ...process.env, GIT_AUTHOR_NAME: 'jig', GIT_AUTHOR_EMAIL: 'jig@example.invalid', GIT_COMMITTER_NAME: 'jig', GIT_COMMITTER_EMAIL: 'jig@example.invalid', GIT_AUTHOR_DATE: '2026-11-26T10:00:00Z', GIT_COMMITTER_DATE: '2026-11-26T10:00:00Z', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
for (const k of ['CLAUDE_PROJECT_DIR', 'JIG_GATES', 'JIG_HOOKS_OFF', 'JIG_NUDGE', 'NODE_TEST_CONTEXT']) delete env[k];

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-run-')));
const clean = (s) => s.split(dir).join('~/demo').replace(/\((\d+(\.\d+)?)m?s\)/g, '(…s)').trimEnd();
const sh = (cmd, a, input) => {
  const r = spawnSync(cmd, a, { cwd: dir, env, encoding: 'utf8', input });
  if (r.error) throw r.error;
  return r;
};
const git = (...a) => { const r = sh('git', a); if (r.status) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout; };
const jig = (...a) => sh('node', [CLI, ...a]);
const hook = (name, payload) => {
  const r = sh('node', [CLI, 'hook', name], JSON.stringify({ session_id: 'demo', cwd: dir, ...payload }));
  if (r.status) throw new Error(`hook ${name}: ${r.stderr}`);
  if (!r.stdout.trim()) return '(nothing: the hook lets it through)';
  const o = JSON.parse(r.stdout);
  const h = o.hookSpecificOutput ?? {};
  if (h.permissionDecision) return `${h.permissionDecision}: ${h.permissionDecisionReason}`;
  if (o.decision) return `${o.decision}: ${o.reason}`;
  if (h.additionalContext) return `note: ${h.additionalContext}`;
  return r.stdout.trim();
};

const out = [];
const show = (prompt, text) => out.push(`${prompt}\n${clean(text)}`);
const expect = (text, re, step) => { if (!re.test(text)) throw new Error(`readme-run: step "${step}" printed:\n${text}\nexpected ${re}`); return text; };

try {
  git('init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'test'));
  writeFileSync(join(dir, 'package.json'), '{ "name": "demo", "type": "module", "scripts": { "test": "node --test" } }\n');
  writeFileSync(join(dir, 'src/total.js'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  writeFileSync(join(dir, 'test/total.accept.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/total.js';\ntest('totals an order', () => assert.equal(total([1, 2, 3]), 6));\n");
  expect(jig('new', 'totals', '--tier', 'full', '--title', 'Order totals').stdout, /wrote/, 'jig new');
  const planPath = join(dir, 'docs/plans/totals/PLAN.md');
  // jig new writes today's date, which would change the tree hash daily.
  writeFileSync(planPath, readFileSync(planPath, 'utf8').replace(/\d{4}-\d{2}-\d{2}/g, '2026-11-26').replace('Status: draft', 'Status: building').replace('### S1: <title> [todo]', '### S1: Totals [doing]').replace(/Touch: .*/, 'Touch: `src/total.js`, `test/`').replace(/^Now: .*/m, 'Now: S1, totals.'));
  writeFileSync(join(dir, 'docs/plans/totals/checks.json'), JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node --test test/total.accept.test.js', timeout_s: 30, fast: true, protects: ['test/total.accept.test.js'] }] }, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'plan: order totals');
  hook('session-start', { source: 'startup' });

  show('$ jig status', expect(jig('status').stdout, /Order totals/, 'status'));
  show('# The agent goes to edit the acceptance test. Before an edit:', expect(hook('pre-edit', { tool_name: 'Edit', tool_input: { file_path: join(dir, 'test/total.accept.test.js'), old_string: '6', new_string: '5' } }), /is protected by check C1/, 'protected edit'));
  show('# It reaches for a package. Before a Bash call:', expect(hook('pre-bash', { tool_name: 'Bash', tool_input: { command: 'npm i left-pad' } }), /one-way door/, 'install'));
  show('# It edits a file the slice doesn\'t list:', expect(hook('pre-edit', { tool_name: 'Write', tool_input: { file_path: join(dir, 'src/format.js'), content: '' } }), /outside S1's Touch list/, 'outside Touch'));

  writeFileSync(join(dir, 'src/total.js'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 1);\n');
  const fail = jig('verify');
  show('# It changes src/total.js with a bug and runs the checks:\n$ jig verify', expect(fail.stdout + fail.stderr, /FAIL C1/, 'failing verify'));
  show('# It says "done". The Stop hook:', expect(hook('stop', { stop_hook_active: false }), /^block: /, 'stop block'));

  writeFileSync(join(dir, 'src/total.js'), 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n');
  const pass = jig('verify', '--record');
  show('# It fixes the bug:\n$ jig verify --record', expect(pass.stdout, /Verified: S1 C1 pass \(tree [0-9a-f]{7}\)/, 'passing verify'));
  show('# It stops again:', expect(hook('stop', { stop_hook_active: false }), /^\(nothing/, 'stop allowed'));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const section = `${START}\n\`\`\`console\n${out.join('\n\n')}\n\`\`\`\n${END}`;
const text = readFileSync(readme, 'utf8');
const a = text.indexOf(START); const b = text.indexOf(END);
if (a === -1 || b === -1) { console.error(`readme-run: ${readme} has no ${START} … ${END} markers`); process.exit(2); }
const next = text.slice(0, a) + section + text.slice(b + END.length);
if (args.includes('--check')) {
  if (next !== text) {
    const was = text.slice(a, b).split('\n'); const now = section.split('\n');
    const diff = now.flatMap((l, i) => (l === was[i] ? [] : [`- ${was[i] ?? ''}`, `+ ${l}`])).slice(0, 12).join('\n');
    console.error(`readme-run: the README run section is out of date. Run \`node scripts/readme-run.mjs\`.\n${diff}`);
    process.exit(1);
  }
} else if (next !== text) writeFileSync(readme, next);
