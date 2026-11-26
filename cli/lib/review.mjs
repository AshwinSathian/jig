// jig review: the brief a reviewer starts from. Deterministic, and it runs
// only git (hardened, through git.mjs) and, for --pr, gh. It never runs a
// repo's own commands: the gate is the review skill's job.
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { git, isCommit, stateDir } from './git.mjs';
import { activePlans, doingSlice, plansDir } from './status.mjs';
import { lastEvidence, workTree, readJsonl } from './verify.mjs';
import { loadChecks } from './checks.mjs';
import { section } from './plan.mjs';
import { diagnose } from './doctor.mjs';

const lines = (s) => (s ?? '').split('\n').filter(Boolean);
const full = (root, ref) => git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim() || null;

// ---------- base ----------

function defaultBranch(root) {
  const remote = git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])?.trim();
  if (remote) return remote;
  // A CI checkout has neither origin/HEAD nor a local main.
  for (const b of ['refs/heads/main', 'refs/heads/master', 'refs/remotes/origin/main', 'refs/remotes/origin/master']) if (full(root, b)) return b.replace(/^refs\/(heads|remotes)\//, '');
  return null;
}

// The newest commit since Baseline whose Verified: trailer names another
// slice; else Baseline. Build step 5 writes that trailer on every slice commit.
export function sliceStart(root, baseline, sliceId) {
  const start = full(root, baseline);
  if (!start) return null;
  const log = git(root, ['log', '--format=%H%x00%B%x1e', `${start}..HEAD`]) ?? '';
  for (const rec of log.split('\x1e')) {
    const [sha, body = ''] = rec.trim().split('\0');
    if (!sha) continue;
    const named = [...body.matchAll(/^Verified:\s+(S\d+)\b/gm)].map((m) => m[1]);
    if (named.some((s) => s !== sliceId)) return sha;
  }
  return start;
}

function fromPr(root, pr) {
  if (!/^\d+$/.test(String(pr))) return { error: `--pr needs a PR number, got "${pr}"` };
  let j;
  try {
    j = JSON.parse(execFileSync('gh', ['pr', 'view', String(pr), '--json', 'baseRefOid,baseRefName,headRefOid,author,number'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }));
  } catch (e) {
    return { error: `gh pr view ${pr} failed (${e.code === 'ENOENT' ? 'gh is not installed' : String(e.stderr || e.message).trim().split('\n')[0]})` };
  }
  if (typeof j?.headRefOid !== 'string' || typeof j?.baseRefOid !== 'string') return { error: `gh pr view ${pr} gave no base or head commit` };
  if (!isCommit(root, j.headRefOid)) return { error: `PR ${pr}'s head ${j.headRefOid.slice(0, 7)} isn't in this clone; run \`gh pr checkout ${pr}\` first` };
  if (!isCommit(root, j.baseRefOid)) return { error: `PR ${pr}'s base ${j.baseRefOid.slice(0, 7)} isn't in this clone; run \`git fetch origin ${j.baseRefName ?? '<base branch>'}\` first` };
  const base = git(root, ['merge-base', j.baseRefOid, j.headRefOid])?.trim();
  if (!base) return { error: `no merge-base between PR ${pr}'s base and head (a shallow clone? run \`git fetch --unshallow\`)` };
  return { base, head: j.headRefOid, how: 'pr', pr: { number: j.number, author: j.author?.login ?? null } };
}

export function resolveBase(root, { base = null, pr = null } = {}) {
  if (pr) return fromPr(root, pr);
  if (base) {
    const b = full(root, base);
    return b ? { base: b, how: 'flag' } : { error: `--base ${base} is not a commit here` };
  }
  // Each step that was tried and skipped is named, so a brief that ends at
  // HEAD says why rather than quietly showing a small diff.
  const fallback = [];
  for (const { path, plan } of activePlans(root)) {
    const slice = doingSlice(plan);
    const baseline = plan.header?.baseline;
    if (!slice || !baseline) continue;
    const b = sliceStart(root, baseline, slice.id);
    if (b) return { base: b, how: 'slice', plan: relative(root, path), slice: slice.id };
    fallback.push(`${relative(root, path)} Baseline ${baseline} is not a commit here`);
  }
  const head = full(root, 'HEAD');
  if (!head) return { error: 'no commits yet' };
  const def = defaultBranch(root);
  if (!def) fallback.push('no default branch (origin/HEAD, main or master)');
  const mb = def ? git(root, ['merge-base', 'HEAD', def])?.trim() : null;
  if (def && !mb) fallback.push(`no merge-base with ${def}`);
  if (mb && mb !== head) return { base: mb, how: 'merge-base', branch: def, fallback };
  if (git(root, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true') fallback.push('shallow clone');
  return { base: head, how: 'head', fallback };
}

// ---------- diff ----------

// Files changed from base to head (a commit), or to the working tree when
// head is null, with added and removed lines. Untracked files count as added.
// Throws when git fails, so a bad range is never an empty diff.
// Not for hooks: a working-tree diff runs any clean filter .git/config
// defines (as a plain `git diff` would), and hooks run outside the sandbox.
// textconv and external diff drivers are off.
const MAX_UNTRACKED = 2 * 1024 * 1024;
export function diffFiles(root, base, head = null) {
  const range = head ? [base, head] : [base];
  const q = ['-c', 'core.quotePath=false'];
  const stat = git(root, [...q, 'diff', '--no-renames', '--no-textconv', '--no-ext-diff', '--numstat', '-z', ...range, '--']);
  const patch = git(root, [...q, 'diff', '--no-renames', '--no-textconv', '--no-ext-diff', '-U0', '--no-color', ...range, '--']);
  if (stat === null || patch === null) throw new Error(`git diff ${range.join(' ')} failed`);
  const files = new Map();
  for (const rec of stat.split('\0').filter(Boolean)) {
    const [a, d, ...p] = rec.split('\t');
    files.set(p.join('\t'), { path: p.join('\t'), adds: a === '-' ? 0 : Number(a), dels: d === '-' ? 0 : Number(d), binary: a === '-', added: [], removed: [] });
  }
  // Headers name the file on each side; /dev/null on one side is an add or a
  // delete. Content lines are read only inside hunks.
  let cur = null; let from = null; let inHunk = false;
  for (const l of patch.split('\n')) {
    if (l.startsWith('diff --git ')) { cur = null; from = null; inHunk = false; continue; }
    if (!inHunk && l.startsWith('--- ')) { from = l === '--- /dev/null' ? null : l.replace(/^--- a\//, ''); continue; }
    if (!inHunk && l.startsWith('+++ ')) { cur = files.get(l === '+++ /dev/null' ? from : l.replace(/^\+\+\+ b\//, '')) ?? null; continue; }
    if (l.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk || !cur) continue;
    if (l.startsWith('+')) cur.added.push(l.slice(1));
    else if (l.startsWith('-')) cur.removed.push(l.slice(1));
  }
  if (!head) {
    for (const p of lines(git(root, [...q, 'ls-files', '--others', '--exclude-standard']))) {
      // Regular files only, and not huge ones: a symlink, FIFO or device is
      // never opened, the same rule treeId follows.
      let text = '';
      try {
        const st = lstatSync(join(root, p));
        if (st.isFile() && st.size <= MAX_UNTRACKED) text = readFileSync(join(root, p), 'utf8');
      } catch { /* unreadable: list it with no lines */ }
      const added = text.split('\n'); if (added[added.length - 1] === '') added.pop();
      files.set(p, { path: p, adds: added.length, dels: 0, binary: false, added, removed: [], untracked: true });
    }
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// ---------- triggers ----------

const lc = (p) => p.toLowerCase();
const ext = (p) => (p.match(/\.([^./]+)$/)?.[1] ?? '').toLowerCase();
// No .txt: requirements.txt and CMakeLists.txt are code, not prose.
const DOC_EXT = new Set(['md', 'mdx', 'rst', 'adoc']);
const isDoc = (p) => DOC_EXT.has(ext(p));
const isTest = (p) => /(^|\/)(test|tests|__tests__|spec|e2e)\//i.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(p) || /_test\.(go|py|rb)$/.test(p) || /(^|\/)test_[^/]*\.py$/.test(p);
// Line-content rules read source code only: a test's fixture strings would
// trigger them for every test that mentions what it tests.
const code = (f) => !isDoc(f.path) && !f.binary && !isTest(f.path);
const PEOPLE = /^(readme|changelog|contributing|security|code_of_conduct)(\.[a-z]+)?$/i;

// One table: id, the partner skill that reviews those files (or null), and
// the rule. Rules read paths, plus added or removed lines of code files.
export const TRIGGERS = [
  { id: 'ui', partner: 'loupe', match: (f) => !isTest(f.path) && (['tsx', 'jsx', 'vue', 'svelte', 'astro', 'css', 'scss', 'sass', 'less', 'html'].includes(ext(f.path)) || /\.swift$/.test(f.path) && /(view|screen)/i.test(f.path)) },
  { id: 'prose', partner: 'humanizing-writing', match: (f, o) => isDoc(f.path) && !isTest(f.path) && !f.path.startsWith(`${o.plansDir}/`) && !f.path.startsWith('docs/plans/') },
  {
    id: 'security', partner: 'owasp-security',
    // `token` under a lexer or parser is a lexical token, not a credential.
    match: (f) => !isDoc(f.path) && (
      !(/(^|\/)(lexer|lexers|parser|parsers|tokeniz\w*)\//i.test(f.path) && /(^|\/)tokens?\.\w+$/i.test(f.path)) && /(^|[/_.-])(auth|authn|authz|authenticat\w*|authoriz\w*|login|logout|session|sessions|token|tokens|oauth|jwt|password|passwd|secret|secrets|crypto|permission|permissions|acl|rbac|payment|payments|billing|invoice|invoices|money|wallet|checkout)([/_.-]|$)/i.test(f.path)
      || code(f) && f.added.some((l) => SECURITY_LINE.test(l))),
  },
  {
    id: 'invariants', partner: null,
    match: (f) => code(f) && (/(^|\/)(parser|parsers|parse|serializ\w*|codec|reducer|reducers|state-machine|fsm|queue|queues|cache|caches|lock|locks|scheduler)([/._-]|$)/i.test(f.path)
      || f.added.some((l) => /\b(transaction|mutex|semaphore|atomic|compareAndSwap|Promise\.all|Promise\.race|idempoten\w*|invalidate|BEGIN TRANSACTION|SELECT .* FOR UPDATE|setInterval)\b|\bnew Worker\(/i.test(l))),
  },
  {
    id: 'tests-or-checks', partner: null,
    match: (f, o) => isTest(f.path) || /^\.github\/workflows\//.test(f.path) || /(^|\/)(\.gitlab-ci\.yml|\.circleci\/|Jenkinsfile|azure-pipelines\.yml)/.test(f.path)
      || (f.path.startsWith(`${o.plansDir}/`) || f.path.startsWith('docs/plans/')) && f.path.endsWith('/checks.json')
      || /(^|\/)(jest|vitest|playwright|cypress|karma|mocha|ava|tap)\.config\.[cm]?[jt]s$|(^|\/)(\.mocharc[^/]*|pytest\.ini|tox\.ini|conftest\.py|\.nycrc[^/]*|codecov\.yml)$/.test(f.path)
      || /(^|\/)package\.json$/.test(f.path) && [...f.added, ...f.removed].some((l) => /^\s*"(test|tests|lint|typecheck|verify|check|e2e|ci)(:[\w:-]+)?"\s*:/.test(l)),
  },
  {
    id: 'migration', partner: null,
    match: (f) => !isDoc(f.path) && (/(^|\/)(migrations?|migrate|alembic|flyway|liquibase)\//i.test(f.path) || /(^|\/)db\/migrate\//.test(f.path) || /\.prisma$/.test(f.path) || /\.sql$/.test(f.path) && /(schema|migrat|V\d+__)/i.test(f.path)
      || code(f) && f.added.some((l) => /\b(ALTER TABLE|DROP TABLE|CREATE TABLE|DROP COLUMN|ADD COLUMN|RENAME COLUMN|addColumn|dropColumn|renameColumn|createTable|dropTable)\b/i.test(l))),
  },
];

// Shell, query building, deserialisation, user-controlled paths, weak crypto.
const SECURITY_LINE = new RegExp([
  // Not after a dot: RegExp.prototype.exec and obj.system( are everywhere.
  String.raw`(?<![.\w])(exec|execSync|execFile|execFileSync|spawn|spawnSync|popen|system)\s*\(|\b(cp|child_process|os|subprocess)\.(exec|execSync|spawn|spawnSync|system|popen|run|call|check_output)\w*\s*\(`,
  String.raw`child_process|subprocess\.|os\.system|shell\s*=\s*True`,
  String.raw`\b(eval|new Function)\s*\(`,
  String.raw`\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b.*(\$\{|\{\w+\}|["'\x60]\s*\+|%s|\.format\()`,
  String.raw`pickle\.loads?|yaml\.load\(|unserialize\(|Marshal\.load|ObjectInputStream|deserializ`,
  String.raw`\b(path\.(join|resolve)|os\.path\.join|open)\(.*\b(req|request|params|query|body|input|argv|args)\b`,
  String.raw`createHash\(\s*['"](md5|sha1)['"]|createCipher\(|Math\.random\(\).*\b(token|secret|id|nonce|salt)\b|crypto\.subtle|jwt\.(sign|verify|decode)`,
  String.raw`dangerouslySetInnerHTML|innerHTML\s*=`,
].join('|'), 'i');

// Small, docs-only, and nothing else matched.
const TRIVIAL_LINES = 20;
const TRIVIAL_FILES = 3;

export function triggersFor(files, { plansDir: pd = 'docs/plans' } = {}) {
  const o = { plansDir: pd };
  const out = [];
  for (const t of TRIGGERS) {
    const hit = files.filter((f) => t.match(f, o)).map((f) => f.path);
    if (!hit.length) continue;
    const row = { id: t.id, partner: t.partner, files: hit };
    // People-facing docs get the owner's voice; skills, agents and references don't.
    if (t.id === 'prose') row.voice = hit.filter((p) => PEOPLE.test(p.split('/').pop()) || /^docs\//.test(p));
    out.push(row);
  }
  const lines = files.reduce((n, f) => n + f.adds + f.dels, 0);
  const docsOnly = files.length && files.every((f) => isDoc(f.path));
  if (docsOnly && lines <= TRIVIAL_LINES && files.length <= TRIVIAL_FILES && out.every((t) => t.id === 'prose')) out.push({ id: 'trivial', partner: null, files: files.map((f) => f.path) });
  return out;
}

// ---------- REVIEW.md from the base ----------

// Entries look like "- When: <trigger> · Check: <what> · Source: <where>".
// An entry matches when a path or code token in its When (backticks, or a
// word with a slash or a dot) appears in a changed path or an added line.
// Entries with no such token go to `judge`: the reviewer decides them.
export function reviewMdEntries(text, files) {
  const matched = []; const judge = [];
  for (const l of (text ?? '').split('\n')) {
    const m = l.match(/^\s*-\s*When:\s*(.+?)\s*·\s*Check:\s*(.+?)\s*·\s*Source:\s*(.+?)\s*$/);
    if (!m) continue;
    const e = { when: m[1], check: m[2], source: m[3] };
    const toks = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    if (!toks.length) toks.push(...(m[1].match(/[\w.-]*\/[\w./*-]*|\b[\w-]+\.[a-z]{1,5}\b/g) ?? []));
    if (!toks.length) { judge.push(e); continue; }
    const hit = files.filter((f) => toks.some((t) => f.path.includes(t.replace(/\*+/g, '')) || f.added.some((a) => a.includes(t))));
    if (hit.length) matched.push({ ...e, files: hit.map((f) => f.path) });
  }
  return { matched, judge };
}

// ---------- records ----------

export const reviews = (root) => readJsonl(root, 'reviews.jsonl');

// A review the skill hands over as JSON. Validated before anything is
// written; the record is tied to the working tree it reviewed, like evidence.
export const VERDICTS = ['ready', 'fix first', 'rethink'];
export const SEVERITIES = ['Important', 'Nit', 'Pre-existing'];
export const CONFIDENCES = ['Confirmed', 'Likely', 'Needs verification'];
export const OUTCOMES = ['fixed', 'wrong', 'intentional', 'didnt-matter'];
const hash8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

// Stable across reviews: class, file and title (lower case, spaces collapsed),
// never the line, which moves as the file changes.
export function findingId(f) {
  return hash8([f.class, f.file, String(f.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim()].join('\0'));
}

function invalid(input) {
  if (!input || typeof input !== 'object') return 'input is not a JSON object';
  if (!VERDICTS.includes(input.verdict)) return `verdict must be one of ${VERDICTS.join(', ')}`;
  if (!Array.isArray(input.findings)) return 'findings must be a list (empty for "Findings: none")';
  for (const [i, f] of input.findings.entries()) {
    const at = `findings[${i}]`;
    if (!SEVERITIES.includes(f.severity)) return `${at}: severity must be one of ${SEVERITIES.join(', ')}`;
    if (f.confidence !== undefined && !CONFIDENCES.includes(f.confidence)) return `${at}: confidence must be one of ${CONFIDENCES.join(', ')}`;
    if (f.severity === 'Important' && f.confidence === undefined) return `${at}: an Important finding needs a confidence`;
    if (typeof f.file !== 'string' || !f.file) return `${at}: file is required`;
    if (f.line !== undefined && f.line !== null && !Number.isInteger(f.line)) return `${at}: line must be an integer`;
    if (typeof f.class !== 'string' || !f.class) return `${at}: class is required (e.g. swallowed-error)`;
    if (typeof f.title !== 'string' || !f.title) return `${at}: title is required`;
  }
  return null;
}

// The input names the base, head and tree from the brief the review started
// from, so a record can't certify a tree nobody reviewed: if the working
// tree moved since the brief, the record is refused. A null tree is a PR
// head that wasn't checked out.
export function recordReview(root, input) {
  const why = invalid(input);
  if (why) return { error: why };
  for (const k of ['base', 'head', 'tree']) if (!(k in input)) return { error: `${k} is required: copy base, head and tree from \`jig review --json\`` };
  const base = full(root, input.base);
  const head = full(root, input.head);
  if (!base) return { error: `base ${input.base} is not a commit here` };
  if (!head) return { error: `head ${input.head} is not a commit here` };
  let tree = null;
  if (input.tree !== null) {
    tree = workTree(root);
    if (tree !== input.tree || head !== full(root, 'HEAD')) return { error: `the tree reviewed (${String(input.tree).slice(0, 7)}) changed since the brief (now ${String(tree).slice(0, 7)}${head !== full(root, 'HEAD') ? ', and HEAD moved' : ''}); review the new tree` };
  }
  const t = Date.now();
  const findings = input.findings.map((f) => ({ id: findingId(f), severity: f.severity, ...(f.confidence ? { confidence: f.confidence } : {}), file: f.file, line: f.line ?? null, class: f.class, title: f.title }));
  const dup = findings.find((f, i) => findings.findIndex((g) => g.id === f.id) !== i);
  if (dup) return { error: `two findings have the same id ${dup.id} (${dup.class} in ${dup.file}): give them titles that say how they differ, or report them as one finding with both lines` };
  const rec = { v: 1, t, id: hash8(`${t}\0${tree}\0${head}`), head, base, tree, verdict: input.verdict, findings, ...(Number.isInteger(input.dropped) ? { dropped: input.dropped } : {}) };
  appendFileSync(join(stateDir(root), 'reviews.jsonl'), JSON.stringify(rec) + '\n');
  return { record: rec, trailer: `Reviewed: ${rec.verdict}, ${findings.length} findings (tree ${tree ? tree.slice(0, 7) : 'none'})` };
}

export function recordOutcome(root, id, outcome) {
  if (!OUTCOMES.includes(outcome)) return { error: `outcome must be one of ${OUTCOMES.join(', ')}` };
  if (!reviews(root).some((r) => (r.findings ?? []).some((f) => f.id === id))) return { error: `no finding ${id} in reviews.jsonl` };
  const rec = { v: 1, t: Date.now(), kind: 'outcome', finding: id, outcome };
  appendFileSync(join(stateDir(root), 'reviews.jsonl'), JSON.stringify(rec) + '\n');
  return { record: rec };
}

// The owner-approved intent for a blind first pass: Outcome (with Done
// when), Decisions the owner decided, Out of scope, and the slice's Goal,
// Touch and Checks. Never the Log or the Now line, which are the builder's
// account of the work.
export function planIntent(plan, sliceId) {
  const body = (name) => (section(plan, name)?.body ?? []).map((l) => l.trimEnd()).filter((l) => l.trim());
  const s = plan.slices.find((x) => x.id === sliceId) ?? null;
  return {
    outcome: body('Outcome'),
    decisions: body('Decisions').filter((l) => /Decided:\s*owner\b/i.test(l)),
    outOfScope: body('Out of scope'),
    slice: s ? { id: s.id, title: s.title, goal: s.fields.goal?.value ?? null, touch: s.fields.touch?.value ?? null, checks: s.fields.checks?.value ?? null } : null,
  };
}

// ---------- the brief ----------

export function reviewBrief(root, opts = {}) {
  const b = resolveBase(root, opts);
  if (b.error) return b;
  const head = b.head ?? full(root, 'HEAD');
  let files;
  try { files = diffFiles(root, b.base, b.head ?? null); } catch (e) { return { error: e.message }; }
  if (!files.length && b.how === 'head') return { error: `nothing to review: no changes against HEAD${b.fallback.length ? ` (${b.fallback.join('; ')})` : ''}. Pass --base <ref>.` };
  const pd = plansDir(root);
  // The fingerprint is of the working tree, so it is the PR's only when the
  // PR head is what's checked out.
  const tree = b.head && b.head !== full(root, 'HEAD') ? null : workTree(root);
  const ev = lastEvidence(root);
  const all = reviews(root).filter((r) => !r.kind && r.findings);
  const rv = all[all.length - 1] ?? null;
  // Rounds of review on this base: a later round reviews only the diff since
  // the last reviewed head, with the earlier findings.
  const round = all.filter((r) => r.base === b.base).length + 1;
  const active = activePlans(root);
  const mine = b.plan ? active.find(({ path }) => relative(root, path) === b.plan) : null;
  const checks = active.some(({ path }) => loadChecks(path).exists);
  const reviewText = git(root, ['show', `${b.base}:REVIEW.md`]);
  // What the review skill's gate runs when there is no checks.json (doctor D1, D7).
  const diag = diagnose(root);
  const pick = (d) => (d ? { level: d.level, msg: d.msg, ...(d.id === 'D1' && d.level === 'ok' ? { commands: d.msg.replace(/^verify command found:\s*/, '').split(', ') } : {}) } : null);
  const gate = { D1: pick(diag.find((d) => d.id === 'D1' && d.level !== 'info')), D7: pick(diag.find((d) => d.id === 'D7')) };
  const brief = {
    v: 1,
    base: b.base, head, how: b.how,
    ...(b.plan ? { plan: b.plan, slice: b.slice } : {}),
    intent: mine ? planIntent(mine.plan, b.slice) : null,
    ...(b.branch ? { branch: b.branch } : {}),
    ...(b.pr ? { pr: b.pr } : {}),
    ...(b.fallback?.length ? { fallback: b.fallback } : {}),
    uncommitted: !b.head && Boolean(git(root, ['status', '--porcelain'])?.trim()),
    tree,
    stats: { files: files.length, adds: files.reduce((n, f) => n + f.adds, 0), dels: files.reduce((n, f) => n + f.dels, 0) },
    files: files.map(({ path, adds, dels, binary, untracked }) => ({ path, adds, dels, ...(binary ? { binary } : {}), ...(untracked ? { untracked } : {}) })),
    triggers: triggersFor(files, { plansDir: pd }),
    reviewMd: reviewText === null ? null : reviewMdEntries(reviewText, files),
    checks,
    gate,
    round,
    evidence: ev ? { t: ev.t, plan: ev.plan, slice: ev.slice, tree: ev.tree, pass: (ev.results ?? []).length > 0 && ev.results.every((r) => r.pass), current: Boolean(tree && ev.tree === tree) } : null,
    review: rv ? { t: rv.t, id: rv.id, verdict: rv.verdict, base: rv.base, head: rv.head, tree: rv.tree, current: Boolean(tree && rv.tree === tree), findings: rv.findings } : null,
  };
  // --blind: what a first, blind pass may see. The earlier verdict and the
  // evidence record are opinions and claims, so they wait for Phase 2.
  if (opts.blind) { delete brief.review; delete brief.evidence; }
  return brief;
}

const short = (s) => (s ? s.slice(0, 7) : '-');

// The text brief: base and tree first, then what to look at.
export function formatBrief(b) {
  const out = [];
  out.push(`Base ${short(b.base)} (${b.how}${b.plan ? `: ${b.plan} ${b.slice}` : ''}${b.branch ? `: ${b.branch}` : ''}${b.pr ? `: PR #${b.pr.number} by ${b.pr.author}` : ''}) · head ${short(b.head)}${b.uncommitted ? ' + uncommitted' : ''} · tree ${short(b.tree)}`);
  if (b.fallback?.length) out.push(`Fell back: ${b.fallback.join('; ')}`);
  if (b.tree === null) out.push('Tree: none (the PR head is not checked out, so evidence and review records cannot match it)');
  out.push(`Diff: ${b.stats.files} files, +${b.stats.adds} -${b.stats.dels}`);
  if (b.triggers.length) for (const t of b.triggers) out.push(`Trigger ${t.id}${t.partner ? ` (${t.partner})` : ''}: ${t.files.slice(0, 5).join(', ')}${t.files.length > 5 ? ` and ${t.files.length - 5} more` : ''}`);
  else out.push('Triggers: none');
  if (b.reviewMd) {
    for (const e of b.reviewMd.matched) out.push(`REVIEW.md: ${e.check} (Source: ${e.source}) on ${e.files.join(', ')}`);
    if (b.reviewMd.judge.length) out.push(`REVIEW.md: ${b.reviewMd.judge.length} entr${b.reviewMd.judge.length === 1 ? 'y' : 'ies'} with no path trigger, for the reviewer to judge`);
  }
  out.push(`Gate: ${b.checks ? 'jig verify (checks.json)' : b.gate.D1?.level === 'ok' ? b.gate.D1.msg : 'no checks.json and no one-command verify'}${b.gate.D7?.level === 'ok' ? `; ${b.gate.D7.msg}` : ''}`);
  out.push(`Evidence: ${b.evidence ? `${b.evidence.pass ? 'pass' : 'FAIL'} at tree ${short(b.evidence.tree)} (${b.evidence.current ? 'current' : 'stale'})` : 'none'}`);
  out.push(`Review: ${b.review ? `${b.review.verdict} at tree ${short(b.review.tree)} (${b.review.current ? 'current' : 'stale'})` : 'none'}`);
  return out.join('\n');
}
