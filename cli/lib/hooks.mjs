// Hook entry points. Each reads the hook JSON on stdin and prints a hook
// response (or nothing). Rules, with reasons in docs/research/m0-spikes.md:
// - never return permissionDecision "allow": that would skip the user's prompts
// - never run repo-defined commands: checks.json is untrusted input
// - append short context, and don't repeat it
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { repoRoot, stateDir } from './git.mjs';
import { activePlans, doingSlice, sliceTouch, statusSummary, plansDir } from './status.mjs';
import { loadChecks, validateChecks, snapshot, loosened, applyEdit } from './checks.mjs';
import { evidence, workTree } from './verify.mjs';
import { parsePlan } from './plan.mjs';

const off = (name) => {
  const v = (process.env.JIG_HOOKS_OFF ?? '').split(',').map((s) => s.trim());
  return v.includes('all') || v.includes(name);
};

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj));
const sid = (input) => String(input.session_id ?? 'nosession').replace(/[^\w.-]/g, '_');

function rootOf(input) {
  const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  return repoRoot(cwd) ?? cwd;
}

function sessionState(root, input) {
  const dir = join(stateDir(root), 'sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sid(input)}.json`);
  let data = { editedAt: 0, warned: [] };
  if (existsSync(file)) {
    try { data = { ...data, ...JSON.parse(readFileSync(file, 'utf8')) }; }
    catch { process.stderr.write(`jig: ignoring unreadable session state ${file}\n`); }
  }
  return { data, save: () => writeFileSync(file, JSON.stringify(data)) };
}

// `a/b/` covers everything below a/b; `*` and `**` are simple wildcards.
export function pathMatches(rel, pattern) {
  if (pattern.endsWith('/')) return rel.startsWith(pattern);
  if (!/[*?]/.test(pattern)) return rel === pattern;
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + '$');
  return re.test(rel);
}

// The tree before this session changed anything, kept once: SessionStart also
// fires on resume and compact, and overwriting it would forget earlier changes.
// The PreToolUse hooks call this too (before their tool runs), for a session
// that started before any plan was active.
function keepStartTree(root, st) {
  if (st.data.startTree) return;
  const tree = workTree(root);
  if (tree) { st.data.startTree = tree; st.save(); }
}

export const NUDGE = 'jig: for any request to change code in this repo, invoke the jig:plan skill first, before reading or editing files. For a one-line fix it is a four-line plan in chat and adds little; for anything ambiguous or risky it catches what a direct start misses. Skip it only for questions, explanations, reviews, and debugging an error whose cause is unknown.';

export function sessionStart(input) {
  const root = rootOf(input);
  if (activePlans(root).length) keepStartTree(root, sessionState(root, input));
  const parts = [];
  if (process.env.JIG_NUDGE !== 'off') parts.push(NUDGE);
  const status = statusSummary(root, { max: 2 });
  if (status.length) parts.push('Active jig plans (read the plan before continuing; use the jig:build skill to work the next slice):\n' + status.join('\n'));
  if (!parts.length) return null;
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') } };
}

// An ask, tagged with the gate that raised it (see observe mode in runHook).
const ask = (gate, reason) => ({ gate, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } });
const block = (gate, reason) => ({ gate, decision: 'block', reason });

// Why an edit to an active plan's checks.json needs a person, or null.
// Fails closed: a result that doesn't parse or validate asks.
function frozenChange(checks, input) {
  const after = applyEdit(readFileSync(checks.path, 'utf8'), input.tool_name, input.tool_input ?? {});
  if (after === null) return 'is an edit jig could not apply to the current file, so it cannot tell what changes';
  let data;
  try { data = JSON.parse(after); } catch (e) { return `would leave invalid JSON (${e.message})`; }
  const problems = validateChecks(data);
  if (problems.length) return `would leave an invalid checks.json (${problems[0]})`;
  const loose = loosened(snapshot(checks.data.checks), snapshot(data.checks));
  return loose.length ? `loosens ${loose.map((l) => `${l.id} (${l.why})`).join('; ')}` : null;
}

// The same file, even when the path is spelled in another case (macOS and
// Windows filesystems ignore case) or reached through a symlink.
function sameFile(a, b) {
  try {
    const x = statSync(a); const y = statSync(b);
    return x.ino === y.ino && x.dev === y.dev;
  } catch { return a === b; } // a file that doesn't exist yet: compare paths
}

// Rule files: what the agent and the reviewers are told. The Claude Code
// code-review post treats them, and CI workflows, as paths a person reads.
const RULE_FILES = ['REVIEW.md', 'CLAUDE.md', '.claude/', '.github/workflows/'];

export function preEdit(input) {
  const out = guardEdit(input);
  if (out?.gate) return out;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file) return out;
  const root = rootOf(input);
  const rel = relative(root, isAbsolute(file) ? file : join(root, file));
  if (!RULE_FILES.some((p) => pathMatches(rel, p))) return out;
  // Observe-only until the owner decides from the log, so log here and keep
  // any scope warning.
  observe(input, 'pre-edit', 'rules', ask('rules', `jig: ${rel} is a rule file (it tells agents or reviewers what to do). A person should read changes to it.`));
  return out;
}

function guardEdit(input) {
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file) return null;
  const root = rootOf(input);
  const abs = isAbsolute(file) ? file : join(root, file);
  const rel = relative(root, abs);
  if (rel.startsWith('..')) return null;
  const st = sessionState(root, input);
  st.data.editedAt = Date.now();
  st.save();

  const plans = activePlans(root);
  if (!plans.length) return null;
  for (const { path } of plans) {
    const checks = loadChecks(path);
    // Fail closed on the one guard that protects files: if checks.json can't
    // be read or validated, we can't tell whether this file is protected.
    const problems = checks.exists ? (checks.error ? [checks.error] : validateChecks(checks.data)) : [];
    if (problems.length) {
      return ask('protects', `jig: ${relative(root, checks.path)} is invalid (${problems[0]}), so jig can't tell whether ${rel} is a protected acceptance test. Fix checks.json with \`jig lint\`.`);
    }
    if (sameFile(abs, path)) {
      const after = applyEdit(readFileSync(path, 'utf8'), input.tool_name, input.tool_input ?? {});
      const to = after === null ? null : parsePlan(after).header?.status?.toLowerCase();
      if (after === null || !['approved', 'building'].includes(to)) {
        return ask('freeze', after === null
              ? `jig: this edit to ${rel} can't be applied to the current file, so jig can't tell whether it changes the plan's status. Re-read the file and retry, or approve if the edit is right.`
              : `jig: this edit sets ${rel} to Status: ${to ?? '(none)'}, which takes it out of the checks freeze and the slice hooks. Changing a plan's status is the owner's call.`);
      }
    }
    if (checks.exists && sameFile(abs, checks.path)) {
      const why = frozenChange(checks, input);
      if (why) {
        return ask('freeze', `jig: this edit to ${rel} ${why}. The plan is approved, so its checks are frozen: add checks or protected paths freely, but loosening one needs the owner's yes and a Log line.`);
      }
    }
    for (const c of checks.data?.checks ?? []) {
      if ((c.protects ?? []).some((p) => pathMatches(rel, p))) {
        return ask('protects', `jig: ${rel} is protected by check ${c.id} in ${relative(root, path)}. Acceptance tests come from the spec; edit one only when the spec changed, and log the decision in the plan.`);
      }
    }
  }
  // After the protection checks, so a problem here can't skip them.
  keepStartTree(root, st);
  if (rel.startsWith(`${plansDir(root)}/`) || rel.startsWith('docs/plans/')) return null;
  const doing = plans.map(({ path, plan }) => ({ path, slice: doingSlice(plan) })).find((x) => x.slice);
  if (!doing) return null;
  const touch = sliceTouch(doing.slice);
  if (!touch.length || touch.some((p) => pathMatches(rel, p))) return null;
  if (st.data.warned.includes(rel)) return null;
  st.data.warned.push(rel);
  st.save();
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `jig: ${rel} is outside ${doing.slice.id}'s Touch list (${touch.join(', ')}). If the slice needs it, add it to Touch with a Log line; otherwise leave it for its own slice.`,
    },
  };
}

const INSTALLERS = [
  { re: /\b(npm|pnpm|yarn|bun)\s+(?:i|install|add)\b(.*)/, eco: 'npm' },
  { re: /\b(?:pip3?|python3?\s+-m\s+pip|uv\s+pip)\s+install\b(.*)/, eco: 'pypi' },
  { re: /\b(?:uv|poetry)\s+add\b(.*)/, eco: 'pypi' },
  { re: /\bcargo\s+(?:add|install)\b(.*)/, eco: 'crates' },
  { re: /\bgo\s+(?:get|install)\b(.*)/, eco: 'go' },
  { re: /\bgem\s+install\b(.*)/, eco: 'rubygems' },
  { re: /\bcomposer\s+require\b(.*)/, eco: 'packagist' },
];

// Package names an install command would add. Lockfile installs (`npm ci`,
// bare `npm install`, `pip install -r req.txt`, `pip install -e .`) add none.
export function installedPackages(command) {
  const found = [];
  for (const seg of command.split(/&&|\|\||;|\|/)) {
    for (const { re, eco } of INSTALLERS) {
      const m = seg.match(re);
      if (!m) continue;
      const rest = m[m.length - 1] ?? '';
      const toks = rest.trim().split(/\s+/).filter(Boolean);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '--prefix', '--registry', '-i', '--index-url'].includes(t)) { i++; continue; }
        if (t.startsWith('-') || t === '.' || t.startsWith('./') || t.startsWith('/') || t.startsWith('$')) continue;
        found.push({ eco, name: t.replace(/^['"]|['"]$/g, '') });
      }
    }
  }
  return found;
}

export function preBash(input) {
  const cmd = input.tool_input?.command ?? '';
  const root = rootOf(input);
  if (activePlans(root).length) keepStartTree(root, sessionState(root, input));
  const pkgs = installedPackages(cmd);
  if (!pkgs.length) return null;
  const names = pkgs.map((p) => `${p.name} (${p.eco})`).join(', ');
  return ask('install', `jig: this adds ${names}. A new dependency is a one-way door: check that the name is the real package (hallucinated names get registered by attackers), its age and downloads, and record it in the plan's Decisions.`);
}

export function stop(input) {
  if (input.stop_hook_active) return null;
  if ((input.background_tasks ?? []).length) return null;
  const root = rootOf(input);
  const st = sessionState(root, input);
  const plans = activePlans(root).filter(({ plan }) => doingSlice(plan));
  if (!plans.length) return null;
  // Only when a checks.json exists; brief plans state checks as commands.
  const withChecks = plans.map(({ path, plan }) => ({ path, slice: doingSlice(plan), checks: loadChecks(path) })).filter((x) => x.checks.exists && Array.isArray(x.checks.data?.checks));
  if (!withChecks.length) return null;
  const sliceChecks = withChecks.flatMap((x) => x.checks.data.checks.filter((c) => c.slice === x.slice.id));
  const cmd = sliceChecks.some((c) => c.fast === true) ? 'jig verify --fast --record' : 'jig verify --record';
  // In git, compare working trees, which also sees changes made through Bash.
  // Outside git, or if git fails, fall back to the Edit hook's timestamp.
  const tree = workTree(root);
  // An Edit-hook call counts as a change too, as it did before tree ids.
  const changed = Boolean(st.data.editedAt) || Boolean(tree && st.data.startTree && tree !== st.data.startTree);
  if (!changed) return null;
  // This plan's records only: another plan's failures aren't this slice's rounds.
  const rels = new Set(withChecks.map((x) => relative(root, x.path)));
  // ponytail: parses all of evidence.jsonl (about 6 KB a record for a 36-check plan); trim old records or keep a running count if Stop gets slow.
  const mine = evidence(root).filter((r) => rels.has(r.plan));
  const ev = mine[mine.length - 1] ?? null;
  const run = `Run \`${cmd}\` for the slice in progress and report its result before finishing. If a check cannot run here, say which one and why.`;
  // Evidence that ran no checks proves nothing.
  if (!ev || !(ev.results ?? []).length) return block('tree', `jig: files changed and no \`jig verify\` has run a check. ${run}`);
  if (tree && !ev.tree) return block('tree', `jig: the last \`jig verify\` has no tree id (it was recorded before jig 2.1), so it can't show which files it checked. ${run}`);
  if (tree ? ev.tree !== tree : ev.t < st.data.editedAt) {
    return block('tree', `jig: files changed since the last \`jig verify\` that ran a check. ${run}`);
  }
  // Rounds per plan, from each plan's own last record when it covers this
  // tree. Each failing record blocks once; the next block needs a new verify.
  const blocked = new Set(st.data.blockedRecords ?? []);
  const reasons = [];
  for (const rel of rels) {
    const recs = mine.filter((r) => r.plan === rel);
    const last = recs[recs.length - 1];
    if (!last || blocked.has(last.t) || (tree ? last.tree !== tree : last.t < st.data.editedAt)) continue;
    const failing = (last.results ?? []).filter((r) => !r.pass);
    if (!failing.length) continue;
    blocked.add(last.t);
    reasons.push(roundsReason(rel, failing.map((f) => ({ id: f.id, why: f.why, n: failedRounds(recs, f.id) }))));
  }
  if (!reasons.length) return null;
  st.data.blockedRecords = [...blocked].slice(-50);
  st.save();
  return block('rounds', reasons.join(' '));
}

function roundsReason(plan, rounds) {
  const out = rounds.filter((r) => r.n >= ROUNDS);
  const still = rounds.filter((r) => r.n < ROUNDS);
  const list = still.map((r) => `${r.id} (round ${r.n} of ${ROUNDS})`).join(', ');
  if (out.length) {
    return `jig (${plan}): ${out.map((r) => `${r.id} has failed ${r.n} verify rounds in a row`).join('; ')}. Stop, and don't try again unless the owner has told you to continue. Report to the owner what you changed in each round and the current error (${out.map((r) => `${r.id}: ${r.why || 'see jig verify'}`).join('; ')}), and let them decide.${list ? ` Also failing: ${list}.` : ''}`;
  }
  return `jig (${plan}): the last \`jig verify\` had failing checks (${still.map((r) => r.id).join(', ')}). Rounds so far: ${list}. Fix the code, not the check, and verify again, or tell the user plainly they are failing; don't describe the slice as done.`;
}

// After three failed rounds on one check, a person decides (the Claude Code
// team's rule; /ship stops after three pushes per issue).
const ROUNDS = 3;

// Consecutive failing records for one check, counted back to its last pass.
export function failedRounds(records, id) {
  let n = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = (records[i].results ?? []).find((x) => x.id === id);
    if (!r) continue;
    if (r.pass) break;
    n++;
  }
  return n;
}

const HANDLERS = { 'session-start': sessionStart, 'pre-edit': preEdit, 'pre-bash': preBash, stop };

// JIG_GATES=observe logs every ask and block to .git/jig/observe.jsonl and
// prints nothing; observe:<gate>,<gate> does that for the named gates only.
// Use it to count false positives before a gate enforces. Gates: protects,
// freeze, install, tree, rounds, and rules (observe-only for now).
function observed(gate) {
  const v = (process.env.JIG_GATES ?? '').trim();
  if (v === 'observe') return true;
  const m = v.match(/^observe:(.*)$/);
  return Boolean(m && m[1].split(',').map((s) => s.trim()).includes(gate));
}

function observe(input, hook, gate, out) {
  const root = rootOf(input);
  const file = input.tool_input?.file_path;
  const entry = {
    t: Date.now(), hook, gate, session: sid(input),
    decision: out.decision ?? out.hookSpecificOutput?.permissionDecision,
    reason: out.reason ?? out.hookSpecificOutput?.permissionDecisionReason,
    ...(file ? { file: relative(root, isAbsolute(file) ? file : join(root, file)) } : {}),
    ...(input.tool_input?.command ? { command: String(input.tool_input.command).slice(0, 200) } : {}),
  };
  appendFileSync(join(stateDir(root), 'observe.jsonl'), JSON.stringify(entry) + '\n');
}

export function runHook(name) {
  const fn = HANDLERS[name];
  if (!fn) { console.error(`jig hook: unknown hook "${name}" (${Object.keys(HANDLERS).join(', ')})`); return 2; }
  if (off(name)) return 0;
  try {
    const input = readStdin();
    const out = fn(input);
    if (out) {
      const { gate, ...rest } = out;
      if (gate && observed(gate)) observe(input, name, gate, rest);
      else emit(rest);
    }
  } catch (e) {
    // Guardrails, not a security boundary (Bash can edit files without Edit):
    // an unexpected error must not block all work. The protected-file check
    // above fails closed on its own known failure mode (invalid checks.json).
    process.stderr.write(`jig hook ${name}: ${e.message}\n`);
  }
  return 0;
}
