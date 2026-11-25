import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { parsePlan, section, humanLayer, touchPaths, checkIds, logEntries, STATUSES, TIERS, SLICE_STATES, SECTIONS } from './plan.mjs';
import { loadChecks, validateChecks } from './checks.mjs';
import { repoRoot, showHead, isCommit } from './git.mjs';

const BUDGET = { brief: 40, full: 80, program: 80 };
const FILE_BUDGET = 400;

// Estimates, not durations in requirements ("keep logs 30 days" is fine).
const ESTIMATE_RES = [
  /\(\s*~\s*\d+(\.\d+)?\s*(h|d|w|hrs?|days?|weeks?)\s*\)/i,
  /\b(estimated effort|estimate[sd]?|eta|will take|takes about|should take)\b[^.\n]{0,40}?\b\d+(\.\d+)?\s*(-\s*\d+\s*)?(hours?|hrs?|days?|weeks?|sprints?|months?)\b/i,
  /\b\d+(\.\d+)?\s*(person|engineer|dev)[- ](hours?|days?|weeks?)\b/i,
];
const VAGUE = ['soon', 'eventually', 'as needed', 'tbd', 'etc.', 'and so on', 'if possible', 'robust', 'seamless', 'various'];
const RISK_MATRIX = /\b(likelihood|impact)\b.*\b(score|low|med|high)\b/i;
const DATE_ENTRY = /^-\s+\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?:\s+\S/;

export function lintFile(planPath, { cwd = process.cwd() } = {}) {
  const abs = isAbsolute(planPath) ? planPath : join(cwd, planPath);
  if (!existsSync(abs)) return { path: planPath, problems: [{ rule: 'J00', level: 'error', line: 0, msg: 'file not found' }] };
  const text = readFileSync(abs, 'utf8');
  const root = repoRoot(cwd) ?? cwd;
  const rel = relative(realpathSync(root), realpathSync(abs));
  return { path: planPath, problems: lintText(text, { root, rel, checks: loadChecks(abs) }) };
}

export function lintText(text, { root = null, rel = null, checks = null } = {}) {
  const plan = parsePlan(text);
  const P = [];
  const err = (rule, line, msg) => P.push({ rule, level: 'error', line: line + 1, msg });
  const warn = (rule, line, msg) => P.push({ rule, level: 'warning', line: line + 1, msg });

  // J01-J03 header
  if (!plan.title) err('J01', 0, 'missing "# <title>" on the first line');
  const h = plan.header;
  const tier = h?.tier?.toLowerCase();
  const status = h?.status?.toLowerCase();
  if (!h) err('J02', 0, 'missing "Status: <status> · Tier: <tier> · Baseline: <sha> · Updated: <date>" line under the title');
  else {
    if (!STATUSES.includes(status)) err('J02', plan.headerLine, `Status must be one of ${STATUSES.join(', ')}`);
    if (!TIERS.includes(tier)) err('J02', plan.headerLine, `Tier must be one of ${TIERS.join(', ')} (tier 0 plans stay in chat)`);
    if (!h.baseline) err('J02', plan.headerLine, 'Baseline commit is missing');
    else if (root && /^[0-9a-f]{7,40}$/.test(h.baseline) && !isCommit(root, h.baseline)) warn('J20', plan.headerLine, `Baseline ${h.baseline} is not a commit in this repo`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.updated ?? '')) err('J02', plan.headerLine, 'Updated must be a YYYY-MM-DD date');
  }
  if (plan.nowLine === -1) err('J03', 0, 'missing "Now:" line saying where the plan stands');

  // J04 sections in order
  const names = plan.sections.map((s) => s.name.toLowerCase());
  let last = -1;
  for (const want of SECTIONS) {
    const idx = names.indexOf(want.toLowerCase());
    if (idx === -1) err('J04', 0, `missing section "## ${want}"`);
    else if (idx < last) err('J04', plan.sections[idx].start, `section "## ${want}" is out of order (expected ${SECTIONS.join(', ')})`);
    else last = idx;
  }

  // J05 outcome done-when
  const outcome = section(plan, 'Outcome');
  if (outcome) {
    const dwIdx = outcome.body.findIndex((l) => /^done when:?/i.test(l.trim()));
    const items = dwIdx === -1 ? [] : outcome.body.slice(dwIdx + 1).filter((l) => /^\s*-\s/.test(l));
    if (dwIdx === -1) err('J05', outcome.start, 'Outcome needs a "Done when:" list');
    else if (!items.length) err('J05', outcome.start + dwIdx + 1, '"Done when:" has no items');
    else items.forEach((l) => {
      if (!/`[^`]+`/.test(l) && !/\b[A-Z][\w.-]*\d\b/.test(l)) {
        err('J05', plan.lines.indexOf(l), 'each "Done when" item names a command in backticks or a check ID');
      }
    });
  }

  // J06/J07 budgets
  const human = humanLayer(plan);
  const budget = BUDGET[tier];
  if (budget && human.length > budget) err('J06', 0, `human layer is ${human.length} lines; the ${tier} budget is ${budget}`);
  if (plan.lines.length > FILE_BUDGET) err('J07', 0, `plan is ${plan.lines.length} lines; the budget is ${FILE_BUDGET}. Collapse finished slices into the Log or split into child plans`);

  // J14 decisions
  const decisions = section(plan, 'Decisions');
  if (decisions) {
    decisions.body.forEach((l, k) => {
      if (!/^\s*-\s/.test(l) || /^\s*-\s*none\.?\s*$/i.test(l)) return;
      const ln = decisions.start + 1 + k;
      if (!/\bReason:/.test(l)) err('J14', ln, 'decision has no "Reason:"');
      if (/\[one-way\]/i.test(l) && status && status !== 'draft' && !/\bDecided:\s*\S+/.test(l)) {
        err('J14', ln, 'one-way decision has no "Decided: <who> <date>" but the plan is past draft');
      }
    });
  }

  // Slices: J08-J11, J15, J19
  let checksData = null;
  if (checks?.exists) {
    if (checks.error) err('J17', 0, `checks.json: ${checks.error}`);
    else {
      checksData = checks.data;
      for (const e of validateChecks(checks.data, plan.slices.map((s) => s.id).filter(Boolean))) err('J17', 0, `checks.json: ${e}`);
    }
  } else if (checks && (tier === 'full')) {
    err('J10', 0, 'full-tier plans need a checks.json beside PLAN.md');
  }
  const knownIds = new Set((checksData?.checks ?? []).map((c) => c.id));
  const slicesSec = section(plan, 'Slices');
  if (slicesSec && !plan.slices.length) err('J08', slicesSec.start, 'Slices section has no "### S<n>: <title> [state]" headings');
  const doing = [];
  for (const s of plan.slices) {
    if (!s.id) { err('J08', s.line, 'slice heading must look like "### S1: <title> [todo]"'); continue; }
    if (!SLICE_STATES.includes(s.state)) err('J08', s.line, `slice ${s.id} state must be one of ${SLICE_STATES.map((x) => `[${x}]`).join(' ')}`);
    if (s.state === 'doing') doing.push(s);
    const isProgramChild = tier === 'program' && s.fields.plan;
    if (isProgramChild) {
      const child = s.fields.plan.value.replace(/`/g, '').trim();
      if (root && !existsSync(join(root, child))) warn('J11', s.fields.plan.line, `child plan ${child} does not exist yet`);
    } else {
      if (!s.fields.touch) err('J09', s.line, `slice ${s.id} has no "Touch:" line`);
      if (!s.fields.checks) err('J09', s.line, `slice ${s.id} has no "Checks:" line`);
    }
    if (s.fields.touch && root) {
      for (const t of touchPaths(s.fields.touch.value)) {
        if (!t.isNew && !/[*?]/.test(t.path) && !existsSync(join(root, t.path))) {
          err('J11', s.fields.touch.line, `${t.path} does not exist; mark it "(new)" if the slice creates it`);
        }
      }
      if (!touchPaths(s.fields.touch.value).length) err('J09', s.fields.touch.line, `slice ${s.id} Touch: lists no paths in backticks`);
    }
    if (s.fields.checks) {
      const ids = checkIds(s.fields.checks.value);
      const hasCmd = /`[^`]+`/.test(s.fields.checks.value);
      if (!ids.length && !hasCmd) err('J09', s.fields.checks.line, `slice ${s.id} Checks: names no check IDs or commands`);
      if (checksData) {
        for (const id of ids) if (!knownIds.has(id)) err('J10', s.fields.checks.line, `check ${id} is not in checks.json`);
      } else if (ids.length && checks) {
        err('J10', s.fields.checks.line, `slice ${s.id} names check IDs but there is no checks.json (a brief plan may give commands in backticks instead)`);
      }
    }
    for (const r of s.risks) {
      if (!/\bDetect:/.test(r.text) || !/\bFallback:/.test(r.text)) err('J15', r.line, 'risk needs "Detect:" and "Fallback:"');
    }
  }
  if (doing.length > 1) err('J19', doing[1].line, `more than one slice is [doing]: ${doing.map((s) => s.id).join(', ')}`);

  // J18 Now references
  if (plan.now) {
    const ids = new Set(plan.slices.map((s) => s.id));
    for (const m of plan.now.matchAll(/\bS\d+\b/g)) if (!ids.has(m[0])) err('J18', plan.nowLine, `"Now:" names ${m[0]}, which is not a slice`);
  }

  // J12 estimates, J13 vague words, J15 matrix (whole file except Log)
  const logSec = section(plan, 'Log');
  const scanEnd = logSec ? logSec.start : plan.lines.length;
  let inFence = false;
  for (let i = 0; i < scanEnd; i++) {
    const l = plan.lines[i];
    if (/^```/.test(l.trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const prose = l.replace(/`[^`]*`/g, '');
    if (ESTIMATE_RES.some((re) => re.test(prose))) err('J12', i, 'time or effort estimate; report scope (slices, files, checks) instead');
    const low = ` ${prose.toLowerCase()} `;
    for (const w of VAGUE) {
      const re = new RegExp(`(^|[^a-z])${w.replace('.', '\\.')}([^a-z]|$)`);
      if (re.test(low)) warn('J13', i, `"${w}" defers a decision; state it or move it to Questions`);
    }
    if (RISK_MATRIX.test(prose)) warn('J15', i, 'risk scoring grid; give each risk Detect: and Fallback: instead');
  }

  // J16 log
  if (logSec) {
    logSec.body.forEach((l, k) => {
      if (/^\s*-\s/.test(l) && !DATE_ENTRY.test(l.trim())) err('J16', logSec.start + 1 + k, 'log entry must start "- YYYY-MM-DD: "');
    });
    if (root && rel) {
      const old = showHead(root, rel);
      if (old) {
        const before = logEntries(parsePlan(old));
        const now = logEntries(plan);
        const broken = before.findIndex((e, k) => now[k] !== e);
        if (broken !== -1) err('J16', logSec.start, `log is append-only: committed entry ${broken + 1} was changed or removed ("${before[broken].slice(0, 60)}")`);
      }
    }
  }

  return P.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}
