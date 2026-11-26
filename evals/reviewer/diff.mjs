// Review eval for diffs (2.5.0): which layer of jig:review earns its place?
// Cases live in ./cases/diff. Each seeds defects into a change from `base`
// to `head`, with a proof test the reviewer never sees: it fails on head and
// passes on base, so a seeded defect is real before any model looks at it. A
// clean control's proof passes on head, so a finding there is a false
// positive. `run.mjs --check` proves every case and spends nothing.
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// From no jig to the whole review, one layer at a time:
// - plain: a fresh session asked to review the change
// - builtin: Claude Code's /code-review on the change
// - self: the session writes the change itself, then reviews it
// - blind: jig-reviewer Phase 1 only (intent and diff, no claims)
// - two-phase: Phase 1, then the PR's claims in Phase 2
// - full: the jig:review skill (gate, both phases, validator, red team, tamper)
export const DIFF_ARMS = ['plain', 'builtin', 'self', 'blind', 'two-phase', 'full'];

export async function diffCases() {
  const dir = join(HERE, 'cases', 'diff');
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  return Promise.all(files.map(async (f) => (await import(pathToFileURL(join(dir, f)).href)).default));
}

const git = (dir, ...a) => execFileSync('git', ['-c', 'user.email=e@e', '-c', 'user.name=e', ...a], { cwd: dir, encoding: 'utf8' }).trim();
const write = (dir, files) => { for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b); } };

// A repo with `base` committed and `head` as a second commit, so a review
// compares HEAD~1..HEAD. The proof files are never in it.
export function scaffoldDiff(c) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-diff-')));
  write(dir, c.base);
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  for (const p of Object.keys(c.base)) if (!(p in c.head)) rmSync(join(dir, p));
  write(dir, c.head);
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '--allow-empty', '-m', c.pr.title); // empty for the self arm, which writes the change itself
  return dir;
}

function runProof(c, files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-proof-')));
  try {
    write(dir, { ...files, ...c.proof.files });
    const [cmd, ...args] = c.proof.cmd.split(' ');
    const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 30_000 });
    return { pass: r.status === 0, out: `${r.stdout}${r.stderr}`.trim().split('\n').pop() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A seeded case fails its proof on head and passes on base; a control passes on head.
export function proveCase(c) {
  const head = runProof(c, c.head);
  if (c.set === 'control') return head.pass ? { ok: true } : { ok: false, why: `control fails its proof on head: ${head.out}` };
  if (head.pass) return { ok: false, why: 'the seeded defect does not fail its proof on head' };
  const base = runProof(c, c.base);
  return base.pass ? { ok: true, head: head.out } : { ok: false, why: `the proof fails on base too: ${base.out}` };
}

const FORMAT = 'Report "Verdict: ready | fix first | rethink", then "Findings:" as a numbered list, each tagged [Important], [Nit] or [Pre-existing], with file:line evidence. "Findings: none" is valid. Say "Unknown" for anything you cannot judge without running it.';

// The prompt each arm gets. The reviewer arms never see the proof.
export function armPrompt(arm, c) {
  const claims = `PR "${c.pr.title}": ${c.pr.body}`;
  switch (arm) {
    case 'plain': return `Review the change in the last commit (git diff HEAD~1) of this repository. It was made for this request: "${c.request}". ${claims} ${FORMAT} Do not edit files.`;
    case 'builtin': return `Run /code-review on the last commit (base HEAD~1). Request: "${c.request}". Report its findings with ${FORMAT}`;
    case 'self': return `Make this change yourself: "${c.request}". Write these files exactly, as your own work:\n${Object.entries(c.head).filter(([p, b]) => c.base[p] !== b).map(([p, b]) => `--- ${p}\n${b}`).join('\n')}\nThen review your own change before handing it over, without subagents or skills. ${FORMAT}`;
    case 'blind': return `Run the jig-reviewer agent in diff mode, Phase 1 only, plan-free: base HEAD~1, head HEAD, spec: "${c.request}". Give it the output of \`jig review --json --blind --base HEAD~1\`. Report its output verbatim. Do not edit files.`;
    case 'two-phase': return `Run the jig-reviewer agent in diff mode, plan-free: base HEAD~1, head HEAD, spec: "${c.request}". Phase 1 with \`jig review --json --blind --base HEAD~1\`, then send the same agent these claims for Phase 2: ${claims} Report its final output verbatim. Do not edit files.`;
    case 'full': return `Use the jig:review skill on this change with --base HEAD~1. The owner's request: "${c.request}". ${claims} Report the skill's final report verbatim. Do not edit source files.`;
    default: throw new Error(`unknown arm ${arm}`);
  }
}
