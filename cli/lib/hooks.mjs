// Hook entry points. Each reads the hook JSON on stdin and prints a hook
// response (or nothing). Rules, with reasons in docs/research/m0-spikes.md:
// - never return permissionDecision "allow": that would skip the user's prompts
// - never run repo-defined commands: checks.json is untrusted input
// - append short context, and don't repeat it
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, lstatSync, readlinkSync, appendFileSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, dirname, basename } from 'node:path';
import { repoRoot, stateDir } from './git.mjs';
import { activePlans, doingSlice, sliceTouch, statusSummary, plansDir } from './status.mjs';
import { loadChecks, validateChecks, snapshot, loosened, applyEdit } from './checks.mjs';
import { evidence, workTree, readJsonl } from './verify.mjs';
import { parsePlan, logEntries } from './plan.mjs';

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
  // The transcript path, kept so a review can read the builder's tool calls
  // locally (docs/evidence-schema.md). Only the path is stored, never content.
  if (typeof input.transcript_path === 'string' && repoRoot(root)) {
    const st = sessionState(root, input);
    if (st.data.transcript !== input.transcript_path) { st.data.transcript = input.transcript_path; st.save(); }
  }
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
// Claude Code also reads CLAUDE.md and .claude/ below the root. Compared in
// lower case: on macOS and Windows `.CLAUDE/` is the same directory.
const pathParts = (rel) => rel.toLowerCase().split(/[\\/]/);
const isWorkflow = (rel) => pathParts(rel).slice(0, 2).join('/') === '.github/workflows';
const isRuleFile = (rel) => {
  const parts = pathParts(rel);
  return ['claude.md', 'review.md'].includes(parts[parts.length - 1]) || parts.slice(0, -1).includes('.claude') || isWorkflow(rel);
};
// Any case (Windows env names ignore it), or JIG followed by an escape.
const SWITCHES = /\bjig_(gates|hooks_off)\b|\bjig\\[xuU_]/i;

// The first switch in a file's text, decoding JSON so an escape can't hide one.
function switchesIn(text) {
  let s = text;
  try { s = JSON.stringify(JSON.parse(text)); } catch { /* not JSON: match the raw text */ }
  return s.match(SWITCHES)?.[0] ?? null;
}

// The path as git sees it. The directory part is resolved (nearest existing
// ancestor), so a file reached through a symlink of the repo (macOS /tmp and
// /private/tmp) maps to the same repo-relative path. The file name is kept as
// the edit spelled it: a symlink named CLAUDE.md is still a rule file.
function underRealDir(abs) {
  let dir = dirname(abs); const rest = [basename(abs)];
  while (!existsSync(dir) && dirname(dir) !== dir) { rest.unshift(basename(dir)); dir = dirname(dir); }
  try { return join(realpathSync(dir), ...rest); } catch { return abs; }
}

// A symlinked file is judged twice, by its own name and by its target, and
// the first ask wins: an edit through it changes the target.
export function preEdit(input) {
  const key = input.tool_input?.file_path !== undefined ? 'file_path' : 'notebook_path';
  const raw = input.tool_input?.[key];
  if (!raw) return guardPath(input);
  const root = rootOf(input);
  const given = isAbsolute(raw) ? raw : join(root, raw);
  const named = underRealDir(given);
  const hops = linkTargets(named);
  if (hops === null) return ask(undefined, `jig: ${relative(root, named)} is a symlink jig can't resolve (a loop or an unreadable link), so it can't tell what this edit would change.`);
  // Spellings to judge: resolved directories with the edit's file name, the
  // path exactly as given (keeps an in-repo directory link's name, such as a
  // linked .github/), and every hop of a symlink chain, including a target
  // that doesn't exist yet (a Write through a dangling link creates it).
  const paths = [...new Set([named, given, ...hops])];
  const at = (p) => ({ ...input, tool_input: { ...input.tool_input, [key]: p } });
  const asks = (o) => Boolean(o?.decision || o?.hookSpecificOutput?.permissionDecision);
  const outs = paths.map((p) => guardPath(at(p)));
  // An ask observe mode can't silence beats an enforced one, which beats an
  // observed one: whichever is returned is what runHook acts on.
  return outs.find((o) => asks(o) && !o.gate) ?? outs.find((o) => asks(o) && !observed(o.gate)) ?? outs.find(asks) ?? outs[0];
}

// The paths a symlink chain passes through, each under a real directory.
// [] when the path isn't a link; null when the chain can't be followed.
function linkTargets(p) {
  const out = [];
  let cur = p;
  for (let i = 0; i < 40; i++) {
    let st;
    try { st = lstatSync(cur); } catch { return out; } // missing: the chain ends here
    if (!st.isSymbolicLink()) return out;
    let to;
    try { to = readlinkSync(cur); } catch { return null; }
    cur = underRealDir(isAbsolute(to) ? to : join(dirname(cur), to));
    out.push(cur);
  }
  return null;
}

function guardPath(input) {
  const key = input.tool_input?.file_path !== undefined ? 'file_path' : 'notebook_path';
  const raw = input.tool_input?.[key];
  const root = rootOf(input);
  const abs = raw ? (isAbsolute(raw) ? raw : join(root, raw)) : null;
  const rel = abs ? relative(root, abs) : null;
  // Turning jig's gates off from a rule file always asks, and has no gate
  // name, so observe mode can't silence it. Judged on the whole file after
  // the edit: any change to a rule file that mentions a switch asks, so a
  // switch can't be assembled from existing text or have its value changed.
  if (rel && isRuleFile(rel)) {
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    const after = applyEdit(before, input.tool_name, input.tool_input ?? {});
    const added = after === null || after === before ? null : switchesIn(after);
    if (after === null || added) {
      return ask(undefined, after === null
        ? `jig: this edit to ${rel} can't be applied to the current file, so jig can't tell whether it turns jig's gates off. Re-read the file and retry, or approve if the edit is right.`
        : `jig: this edit to ${rel} mentions ${added}, which switches jig's gates off or into observe mode. That's the owner's call.`);
    }
  }
  const out = guardEdit(input);
  // A workflow edit keeps its own ask even when another gate on the same edit
  // (protects, freeze) is only being observed: log that one, ask for rules.
  if (rel && isWorkflow(rel) && out?.gate && observed(out.gate)) {
    observe(input, 'pre-edit', out.gate, out);
  } else if (out?.gate || !rel || !isRuleFile(rel)) return out;
  // CI workflows run with the repo's secrets and are rarely part of normal
  // work, so an edit asks (JIG_GATES=observe:rules turns it into a log entry).
  // CLAUDE.md, REVIEW.md and .claude/ are only logged: CLAUDE.md edits are
  // usually legitimate, and Claude Code already prompts for .claude/ writes.
  if (isWorkflow(rel)) {
    const a = ask('rules', `jig: ${rel} is a CI workflow. It runs in CI with the repo's secrets, so a person should read this change.`);
    const ctx = out?.gate ? null : out?.hookSpecificOutput?.additionalContext;
    if (ctx) a.hookSpecificOutput.additionalContext = ctx;
    return a;
  }
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
    // A schema problem elsewhere (a bad `kind`) leaves `protects` readable, so
    // the checks below still run and only a protected file asks. Unreadable
    // `protects` still fails closed.
    const list = checks.data?.checks;
    const readable = !checks.error && Array.isArray(list) && list.every((c) => c && typeof c === 'object' && (c.protects === undefined || (Array.isArray(c.protects) && c.protects.every((x) => typeof x === 'string'))));
    // Editing checks.json while it's invalid has no trustworthy baseline to
    // compare against, so that edit asks whatever `protects` says.
    if (problems.length && (!readable || (checks.exists && sameFile(abs, checks.path)))) {
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
// Segments are split quote-aware, continuation lines are joined, and a
// heredoc body is left out. Redirections (`2>&1`, `> out.log`) are skipped,
// and so is the value of a flag the matched tool really takes (npm `-w`,
// pnpm `--filter`): anything else is reported, so an unknown flag can't hide
// a package. Quoted text is still read, so `bash -c "npm i x"` asks.
const TAKES_VALUE = {
  npm: ['-w', '--workspace', '--prefix', '--registry'],
  pnpm: ['-F', '--filter', '-C', '--dir', '--registry'],
  yarn: ['--cwd', '--registry'],
  bun: ['--cwd', '--registry'],
  pypi: ['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '--prefix', '-i', '--index-url'],
};
export function installedPackages(command) {
  const found = [];
  for (const seg of shellSegments(command)) {
    const line = seg.replace(/\\\n/g, ' ').split('\n')[0];
    for (const { re, eco } of INSTALLERS) {
      const m = line.match(re);
      if (!m) continue;
      const rest = m[m.length - 1] ?? '';
      const takes = TAKES_VALUE[eco === 'npm' ? m[1] : eco] ?? [];
      const toks = rest.trim().split(/\s+/).filter(Boolean);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (takes.includes(t)) { i++; continue; }
        if (/^\d*[<>]/.test(t)) { if (/^\d*[<>]{1,2}&?$/.test(t)) i++; continue; }
        if (t.startsWith('-') || t === '.' || t.startsWith('./') || t.startsWith('/') || t.startsWith('$')) continue;
        found.push({ eco, name: t.replace(/^['"]|['"]$/g, '') });
      }
    }
  }
  return found;
}

// A command split at unquoted ;, &&, ||, | and newlines. A heredoc body
// stays with the segment that opened it, so its lines aren't commands.
export function shellSegments(cmd) {
  const out = [];
  let cur = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === '\\' && q === '"' && i + 1 < cmd.length) cur += cmd[++i]; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
    const two = cmd.slice(i, i + 2);
    if (c === '\n') {
      const h = cur.match(/<<-?\s*(['"]?)([\w.-]+)\1/);
      if (h) {
        const rest = cmd.slice(i + 1);
        const end = rest.search(new RegExp(`^\\s*${h[2].replace(/[.-]/g, '\\$&')}\\s*$`, 'm'));
        const body = end === -1 ? rest : rest.slice(0, end);
        cur += `\n${body}`;
        i += body.length + (end === -1 ? 0 : (rest.slice(end).match(/^.*$/m)?.[0].length ?? 0));
      }
      out.push(cur); cur = ''; continue;
    }
    if (c === ';' || two === '&&' || two === '||' || c === '|') { if (two === '&&' || two === '||') i++; out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// A real `git commit` segment: allowing a subshell, sudo/env/command/time/
// nice/exec, env assignments, a path to git, and git's own options before the
// subcommand; `sh -c "..."` is looked into. A dry run isn't a commit.
// Misses: aliases, functions, scripts and `eval`.
const PREFIX = String.raw`(?:[({]\s*)*(?:(?:sudo|env|command|time|nice|exec)\s+(?:-\S+\s+)*|\w+=\S*\s+)*`;
const GITOPT = String.raw`(?:-[cC]\s+(?:"[^"]*"|'[^']*'|\S+)|--(?:git-dir|work-tree|namespace)(?:=\S+|\s+\S+)|--[\w-]+(?:=\S+)?)`;
const COMMIT = new RegExp(String.raw`^${PREFIX}(?:\S*/)?\\?git(?:\s+${GITOPT})*\s+commit(?=\s|$|[)}])`);
export function commitSegment(cmd) {
  for (const seg of shellSegments(cmd)) {
    const inner = seg.match(/^(?:\S*\/)?(?:ba|z|da)?sh\s+-c\s+(['"])([\s\S]*)\1\s*$/);
    if (inner) { const s = commitSegment(inner[2]); if (s) return s; continue; }
    if (COMMIT.test(seg) && !/\s--dry-run\b/.test(seg)) return seg;
  }
  return null;
}
export const isGitCommit = (cmd) => commitSegment(cmd) !== null;
const VERIFIED_NONE = /Verified: none \([^)\s][^)]*\)/;

// What the commit's own message says, read from its segment (-m, a heredoc)
// or a -F file. null when there's no message flag (an editor will open, or
// --no-edit reuses a message jig can't see).
function commitMessage(seg, cwd) {
  if (VERIFIED_NONE.test(seg)) return { none: true };
  const f = seg.match(/(?:^|\s)(?:-[a-zA-Z]*F\s*|--file(?:=|\s+))(?:"([^"]+)"|'([^']+)'|([^\s'"]+))/);
  const file = f ? (f[1] ?? f[2] ?? f[3]) : null;
  if (file && file !== '-') {
    const p = isAbsolute(file) ? file : join(cwd, file);
    try {
      const st = lstatSync(p);
      if (st.isFile() && st.size <= 65536) return { none: VERIFIED_NONE.test(readFileSync(p, 'utf8')) };
    } catch { /* unreadable: judged as a message without the line */ }
    return { none: false };
  }
  if (file || /(?:^|\s)(?:-[a-zA-Z]*m|--message)(?=[\s=]|$|["'])/.test(seg)) return { none: false };
  return null;
}

// The commit gate, observed by default (JIG_GATES=enforce:commit to ask).
// It only looks at repos where jig is in use: an active plan with
// checks.json, or a review record. It compares the working-tree fingerprint,
// not the index, so a commit that leaves verified changes unstaged can pass.
function commitGate(input, root, seg) {
  const plans = activePlans(root);
  const reviewRecs = readJsonl(root, 'reviews.jsonl');
  const used = plans.some(({ path }) => loadChecks(path).exists) || reviewRecs.length > 0;
  // A Blocked slice may commit its work in progress, but only when every
  // plan being built is blocked: one blocked plan doesn't excuse another.
  const building = plans.filter(({ path, plan }) => doingSlice(plan) && loadChecks(path).exists);
  if (!used || (building.length && building.every(({ plan }) => blockedReason(plan)))) return null;
  const msg = commitMessage(seg, input.cwd ?? root);
  if (msg?.none) return null;
  const tree = workTree(root);
  if (!tree) return null;
  const passed = (r) => (r.results ?? []).length > 0 && r.results.every((x) => x.pass);
  // Only a passing record is cover: a fix-first review at this tree is not.
  if (evidence(root).some((r) => r.tree === tree && passed(r)) || reviewRecs.some((r) => !r.kind && r.tree === tree && r.verdict === 'ready')) return null;
  const why = `jig: this commit's tree (${tree.slice(0, 7)}) has no current passing evidence or review record`;
  const fix = 'Run `jig verify --record` or jig:review first, or say in the message why nothing was verified.';
  // No message flag: the message can't be read, so this is only logged.
  if (!msg) { observe(input, 'pre-bash', 'commit', ask('commit', `${why}, and it has no message flag (message unknown: an editor will open or a message is reused). Logged only.`)); return null; }
  // A gate that keeps firing gets switched off: when it enforces, two per
  // session, then it lets go. Observed, every fire is logged, so the count
  // the owner decides from is complete.
  if (!observed('commit')) {
    const st = sessionState(root, input);
    const fired = st.data.commitFired ?? 0;
    if (fired >= 2) return null;
    st.data.commitFired = fired + 1;
    st.save();
  }
  return ask('commit', `${why}, and its message has no "Verified: none (<reason>)" line. ${fix}`);
}

export function preBash(input) {
  const cmd = input.tool_input?.command ?? '';
  const root = rootOf(input);
  if (activePlans(root).length) keepStartTree(root, sessionState(root, input));
  const pkgs = installedPackages(cmd);
  if (!pkgs.length) {
    const seg = commitSegment(cmd);
    return seg ? commitGate(input, root, seg) : null;
  }
  const names = pkgs.map((p) => `${p.name} (${p.eco})`).join(', ');
  return ask('install', `jig: this adds ${names}. A new dependency is a one-way door: check that the name is the real package (hallucinated names get registered by attackers), its age and downloads, and record it in the plan's Decisions.`);
}

// The reason when a plan's last Log entry is `Blocked: <reason>`: the
// builder stopped on purpose (a spec conflict, a check that can't pass here,
// a missing service) and the owner decides. A later verify line, or any other
// entry after it, ends the block.
export function blockedReason(plan) {
  const last = logEntries(plan).pop() ?? '';
  return last.match(/^-\s*\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?:\s*Blocked:\s*(\S.*)$/)?.[1] ?? null;
}

export function stop(input) {
  if (input.stop_hook_active) return null;
  if ((input.background_tasks ?? []).length) return null;
  const root = rootOf(input);
  const st = sessionState(root, input);
  const doing = activePlans(root).filter(({ plan }) => doingSlice(plan));
  // Blocked plans are an accepted end state: no tree or rounds checks. The
  // owner hears about each once per session.
  const blocked = doing.map(({ path, plan }) => ({ rel: relative(root, path), why: blockedReason(plan) })).filter((b) => b.why);
  const told = new Set(st.data.blockedTold ?? []);
  const news = blocked.filter((b) => !told.has(`${b.rel}\0${b.why}`));
  const out = stopChecks(root, st, doing.filter(({ path }) => !blocked.some((b) => b.rel === relative(root, path))));
  if (!news.length) return out;
  st.data.blockedTold = [...told, ...news.map((b) => `${b.rel}\0${b.why}`)].slice(-20);
  st.save();
  const systemMessage = news.map((b) => `jig: ${b.rel} is blocked: ${b.why}. The agent stopped on purpose; this needs your decision.`).join(' ');
  return out ? { ...out, systemMessage } : { systemMessage };
}

function stopChecks(root, st, plans) {
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
// freeze, install, tree, rounds, rules (asks for CI workflows, logs the
// other rule files), and commit (observed unless JIG_GATES=enforce:commit).
// Gates that ship observed until the owner decides from observe.jsonl.
// JIG_GATES=enforce:<gate>,... makes one ask.
const OBSERVED_BY_DEFAULT = ['commit'];
function observed(gate) {
  const v = (process.env.JIG_GATES ?? '').trim();
  if (v === 'observe') return true;
  const m = v.match(/^(observe|enforce):(.*)$/);
  const named = m ? m[2].split(',').map((s) => s.trim()).includes(gate) : false;
  if (m?.[1] === 'observe' && named) return true;
  return OBSERVED_BY_DEFAULT.includes(gate) && !(m?.[1] === 'enforce' && named);
}

function observe(input, hook, gate, out) {
  const root = rootOf(input);
  const file = input.tool_input?.file_path;
  const entry = {
    v: 1, t: Date.now(), hook, gate, session: sid(input),
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
      if (gate && observed(gate)) {
        observe(input, name, gate, rest);
        // A message for the owner is never observed away with the gate.
        if (rest.systemMessage) emit({ systemMessage: rest.systemMessage });
      } else emit(rest);
    }
  } catch (e) {
    // Guardrails, not a security boundary (Bash can edit files without Edit):
    // an unexpected error must not block all work. The protected-file check
    // above fails closed on its own known failure mode (invalid checks.json).
    process.stderr.write(`jig hook ${name}: ${e.message}\n`);
  }
  return 0;
}
