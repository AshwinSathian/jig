#!/usr/bin/env node
// Reviewer eval: does a fresh-context jig-reviewer find seeded plan defects
// that a same-session self-review or a plain review misses, without flagging
// clean plans? Cases live in ./cases: `tuning` cases may be used to tune
// prompts and graders, `test` cases never are, and `control` cases are clean.
// Grading is in ./grade.mjs (unit-tested, no API spend).
//
// Usage:
//   node evals/reviewer/run.mjs --check              prove the diff cases (./diff.mjs) and list the six arms; spends nothing
//   node evals/reviewer/run.mjs --diff [--dry]       the diff review eval over the six arms (spends money; --dry first)
//   node evals/reviewer/run.mjs --dry                one fresh review of one test case; prints its cost and an estimate for the full run
//   node evals/reviewer/run.mjs [--runs 3] [--set test|tuning|control|all] [--arm plain,fresh,self]
// This spends API money on your account. Run --dry first.
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runClaude, arms, usageOf, pool } from '../lib/claude.mjs';
import { grade, verdict, summarize } from './grade.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const JIG = join(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const dry = argv.includes('--dry');
const runs = Number(opt('runs', 3));
const set = opt('set', 'all');
const armNames = opt('arm', 'plain,fresh,self').split(',');
const MAX_ROUNDS = 3;

// Throwaway fixture repos are removed on exit; pass --keep to inspect them.
const MADE = [];
process.on('exit', () => { if (!argv.includes('--keep')) for (const d of MADE) rmSync(d, { recursive: true, force: true }); });

// --check: prove every diff case and name the arms. No API calls.
if (argv.includes('--check')) {
  const { DIFF_ARMS, diffCases, proveCase } = await import('./diff.mjs');
  const dcs = await diffCases();
  let bad = 0;
  for (const c of dcs) {
    const r = proveCase(c);
    if (!r.ok) bad++;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${c.id} (${c.set}; ${c.kinds.join(', ')})${r.ok ? (r.head ? `: head fails with "${r.head}"` : ': clean on head') : `: ${r.why}`}`);
  }
  console.log(`${DIFF_ARMS.length} arms (${DIFF_ARMS.join(', ')}), ${dcs.length} diff cases, ${bad} unproven. no API calls.`);
  process.exit(bad ? 1 : 0);
}

// --diff [--dry] [--runs 3] [--arm a,b] [--budget 10]: the diff review eval
// (six arms, ./diff.mjs). Spends API money; --dry runs one review of one
// case and prints the cost and the full-run estimate.
if (argv.includes('--diff')) {
  const { DIFF_ARMS, diffCases, scaffoldDiff, armPrompt } = await import('./diff.mjs');
  const { gradeDiff, summarizeDiff } = await import('./grade.mjs');
  const A = arms({ jigDir: JIG, superpowersDir: '' });
  const dcs = await diffCases();
  const chosenArms = opt('arm', DIFF_ARMS.join(',')).split(',');
  const budget = Number(opt('budget', 10));
  const tools = (arm) => ['--allowedTools', ['Read', 'Glob', 'Grep', 'Bash(jig:*)', 'Bash(git:*)', 'Bash(node:*)', ...(arm === 'self' ? ['Write', 'Edit'] : []), ...(['blind', 'two-phase', 'full'].includes(arm) ? ['Agent', 'Skill', 'SendMessage'] : []), ...(arm === 'builtin' ? ['Skill'] : [])].join(',')];
  const env = { ...process.env, PATH: `${join(JIG, 'bin')}:${process.env.PATH}` };
  let total = 0;
  const one = async ({ arm, c }) => {
    if (total > budget) return { arm, id: c.id, set: c.set, grade: { valid: false }, skipped: true, costUsd: 0 };
    // The self arm starts from base and writes the change itself.
    const dir = scaffoldDiff(arm === 'self' ? { ...c, head: c.base } : c);
    MADE.push(dir);
    const out = await runClaude({ cwd: dir, prompt: armPrompt(arm, c), armFlags: ['plain', 'self', 'builtin'].includes(arm) ? A.none : A.jig, budgetUsd: 2, timeoutMs: 20 * 60_000, extra: tools(arm), env });
    const cost = usageOf(out.result)?.costUsd ?? 0;
    total += cost;
    const text = out.result?.result ?? '';
    const g = gradeDiff(text, c);
    if (out.killed || out.result?.is_error) g.valid = false;
    // A layer counts only if it ran: the agent for blind and two-phase, the skill for full and builtin.
    const called = (names) => out.tools.some((t) => names.includes(t.name));
    if (['blind', 'two-phase'].includes(arm) && !called(['Agent', 'Task'])) g.valid = false;
    if (arm === 'full' && !out.skills.some((x) => /(^|:)review$/.test(x) && x.startsWith('jig'))) g.valid = false;
    if (arm === 'builtin' && !out.skills.some((x) => /code-review/.test(x))) g.valid = false;
    console.error(`${arm} ${c.id}: recall ${g.recall ?? '-'}, fp ${g.falsePositives}, unknown ${g.unknown}, verdict ${g.verdict}${g.pass ? ' PASS' : ''}  $${cost.toFixed(2)} (total $${total.toFixed(2)})`);
    return { arm, id: c.id, set: c.set, grade: g, costUsd: cost, text };
  };
  const jobs = dry ? [{ arm: 'full', c: dcs.find((c) => c.id === 'injection-sql') }] : chosenArms.flatMap((arm) => dcs.flatMap((c) => Array.from({ length: runs }, () => ({ arm, c }))));
  const res = await pool(jobs, 4, one);
  if (dry) console.log(`dry run: one full-arm review cost $${res[0].costUsd.toFixed(2)}; a full run (${DIFF_ARMS.length} arms x ${dcs.length} cases x 3 runs = ${DIFF_ARMS.length * dcs.length * 3} reviews) is about $${(res[0].costUsd * DIFF_ARMS.length * dcs.length * 3).toFixed(0)}, capped by --budget ${budget}.`);
  else {
    const outDir = join(HERE, '..', 'results');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `review-diff-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`), JSON.stringify(res, null, 2));
    console.log(JSON.stringify(summarizeDiff(res), null, 2));
  }
  process.exit(0);
}

const cases = await Promise.all(readdirSync(join(HERE, 'cases')).filter((f) => f.endsWith('.mjs')).sort()
  .map(async (f) => (await import(pathToFileURL(join(HERE, 'cases', f)).href)).default));

const git = (dir, ...a) => execFileSync('git', ['-c', 'user.email=e@e', '-c', 'user.name=e', ...a], { cwd: dir, encoding: 'utf8' }).trim();
function scaffold(files) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'jig-rev-')));
  MADE.push(dir);
  for (const [p, b] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), b); }
  git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fixture');
  return dir;
}

const A = arms({ jigDir: JIG, superpowersDir: '' });
// Only the fresh arm may start a subagent. Plain and self get the same read
// tools (self also needs Write for the plan), so the arms differ in context
// and rubric, not in reach.
const tools = (extra) => ['--allowedTools', ['Read', 'Glob', 'Grep', 'Bash(jig:*)', 'Bash(git:*)', 'Bash(node:*)', ...extra].join(',')];
// `jig` inside every arm is this checkout, not an older installed copy
// (2.0.1 rejects the `e2e` check kind and would fault the clean control).
const ENV = { ...process.env, PATH: `${join(JIG, 'bin')}:${process.env.PATH}` };
const FORMAT = 'Report "Verdict: ready | fix first | rethink", then "Findings:" as a numbered list, each tagged [Important], [Nit] or [Pre-existing], with evidence. "Findings: none" is a valid answer if the plan is sound.';
// A ceiling on the whole run, not just per call (33 calls times a per-call
// cap would allow far more than the estimate). --budget <usd>, default 10.
const BUDGET = Number(opt('budget', 10));
let spent = 0;
const ARMS = {
  // No jig: a fresh session asked to review.
  plain: { flags: A.none, tools: tools([]), setup: (c) => c.files, prompt: (c) => `Review the plan at ${c.plan} against this repository. It was written for this request: "${c.request}". ${FORMAT} Do not edit files.` },
  // jig's fresh-context reviewer, in a subagent that never saw the plan written.
  fresh: { flags: A.jig, tools: tools(['Agent']), setup: (c) => c.files, prompt: (c, prev) => (prev
    ? `Run the jig-reviewer agent in plan mode on ${c.plan}, round ${prev.round}. Original request: "${c.request}". Its earlier findings:\n${prev.text}\nLast reviewed commit: ${prev.commit}. Report its output verbatim. Do not edit files.`
    : `Run the jig-reviewer agent in plan mode on ${c.plan} (original request: "${c.request}"). Report its output verbatim. Do not edit files.`) },
  // The author reviews its own plan in the same session. An approximation:
  // the session writes a plan it was handed rather than one it composed.
  self: { flags: A.jig, tools: tools(['Write']), setup: (c) => Object.fromEntries(Object.entries(c.files).filter(([p]) => p !== c.plan)), prompt: (c) => `You are drafting a plan for this request: "${c.request}". Write the following plan to ${c.plan} exactly as given; it is your draft.\n\n${c.files[c.plan]}\n\nThen, before handing it to the owner, check your own plan yourself, without subagents or skills: review it against this repository. ${FORMAT} Edit no other files.` },
};

async function review(arm, c) {
  if (spent > BUDGET) {
    console.error(`skipped ${arm} ${c.id}: spent $${spent.toFixed(2)} of the $${BUDGET} ceiling`);
    return { arm, id: c.id, set: c.set, grade: { valid: false, found: [] }, skipped: true, costUsd: 0 };
  }
  const a = ARMS[arm];
  const dir = scaffold(a.setup(c));
  const ask = (prev) => runClaude({ cwd: dir, prompt: a.prompt(c, prev), armFlags: a.flags, budgetUsd: 1.5, timeoutMs: 15 * 60_000, extra: a.tools, env: ENV });
  // What each round did, so a run can be audited: did fresh really start the
  // reviewer subagent, did self stay inside its own context?
  const log = [];
  let cost = 0;
  const record = (out) => {
    log.push({ tools: out.tools.map((t) => t.name), skills: out.skills, killed: out.killed, error: out.result?.is_error ?? !out.result, stderr: out.stderr.slice(-500) });
    const c = usageOf(out.result)?.costUsd ?? 0;
    cost += c;
    spent += c;
    return out.result?.result ?? '';
  };
  let out = await ask(null);
  let text = record(out);
  const texts = [text];
  const g = grade(text, c);
  // Also invalid when the run errored, or the fresh arm never started the subagent.
  if (log[0].error || log[0].killed || (arm === 'fresh' && !log[0].tools.some((t) => t === 'Agent' || t === 'Task'))) g.valid = false;
  // Rounds-to-pass: the fresh reviewer re-reviews after the builder's fix.
  let rounds = null;
  if (arm === 'fresh' && c.fixed) {
    rounds = [verdict(text)];
    while (rounds[rounds.length - 1] !== 'ready' && rounds.length < MAX_ROUNDS) {
      const commit = git(dir, 'rev-parse', '--short', 'HEAD');
      for (const [p, b] of Object.entries(c.fixed)) writeFileSync(join(dir, p), b);
      git(dir, 'add', '-A'); // new test files in the fix, not only edits
      git(dir, 'commit', '-q', '--allow-empty', '-m', `fix round ${rounds.length}`); // round 3 may re-review an unchanged fix
      if (spent > BUDGET) break;
      out = await ask({ round: rounds.length + 1, text, commit });
      text = record(out);
      texts.push(text);
      rounds.push(verdict(text));
    }
  }
  const used = [...new Set(log.flatMap((l) => l.tools))].join('/') || 'none';
  console.error(`${arm} ${c.id} (${c.set})${g.valid ? '' : ' INVALID'}: recall ${g.recall ?? '-'}, false positives ${g.falsePositives ?? '-'}, verdict ${g.verdict}${rounds ? `, rounds ${rounds.join(' > ')}` : ''}, tools ${used}  $${cost.toFixed(2)} (run total $${spent.toFixed(2)})`);
  return { arm, id: c.id, set: c.set, grade: g, rounds, costUsd: cost, texts, log };
}

// --regrade a.json,b.json: score saved review texts with the current grader
// and print the summary. Spends nothing.
if (opt('regrade')) {
  const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
  const saved = opt('regrade').split(',').flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
  const regraded = saved.map((r) => ({ ...r, grade: { ...grade(r.texts?.[0] ?? '', byId[r.id]), valid: r.grade?.valid !== false && Boolean(r.texts?.[0]) }, rounds: r.rounds }));
  console.log(JSON.stringify(summarize(regraded), null, 2));
  process.exit(0);
}

const chosen = cases.filter((c) => set === 'all' || c.set === set);
const jobs = dry
  ? [{ arm: 'fresh', c: cases.find((c) => c.fixed) }]
  : armNames.flatMap((arm) => chosen.flatMap((c) => Array.from({ length: runs }, () => ({ arm, c }))));
const results = await pool(jobs, 4, ({ arm, c }) => review(arm, c));

if (dry) {
  const one = results[0];
  const reviews = (one.rounds?.length ?? 1);
  const perReview = one.costUsd / reviews;
  const full = ['plain', 'fresh', 'self'].length * cases.length * 3;
  const saved = join(tmpdir(), `jig-reviewer-dry-${process.pid}.json`);
  writeFileSync(saved, JSON.stringify(results, null, 2));
  console.log(`review texts: ${saved}`);
  console.log(`dry run: ${reviews} review(s) of ${one.id} cost $${one.costUsd.toFixed(2)} ($${perReview.toFixed(2)} each).`);
  console.log(`full run estimate (3 arms x ${cases.length} cases x 3 runs = ${full} reviews, plus up to ${2 * 3} extra fresh rounds): about $${(perReview * (full + 6)).toFixed(0)}.`);
} else {
  const outDir = join(HERE, '..', 'results'); mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `reviewer-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(summarize(results), null, 2));
}
