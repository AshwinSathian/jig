import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export const KINDS = ['acceptance', 'regression', 'property', 'mutation', 'perf', 'security'];
const ID_RE = /^[A-Za-z][\w.-]*$/;

export function checksPathFor(planPath) {
  return join(dirname(planPath), 'checks.json');
}

export function loadChecks(planPath) {
  const p = checksPathFor(planPath);
  if (!existsSync(p)) return { path: p, exists: false, data: null, error: null };
  try {
    return { path: p, exists: true, data: JSON.parse(readFileSync(p, 'utf8')), error: null };
  } catch (e) {
    return { path: p, exists: true, data: null, error: `invalid JSON: ${e.message}` };
  }
}

// Returns a list of problem strings; empty when valid.
export function validateChecks(data, sliceIds = null) {
  const errs = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['top level must be an object'];
  if (data.version !== 1) errs.push('version must be 1');
  if (!Array.isArray(data.checks)) return [...errs, 'checks must be an array'];
  const seen = new Set();
  data.checks.forEach((c, i) => {
    const at = `checks[${i}]${c && c.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object') return errs.push(`${at}: must be an object`);
    if (typeof c.id !== 'string' || !ID_RE.test(c.id)) errs.push(`${at}: id must match ${ID_RE}`);
    else if (seen.has(c.id)) errs.push(`${at}: duplicate id`);
    else seen.add(c.id);
    if (typeof c.slice !== 'string') errs.push(`${at}: slice is required`);
    else if (sliceIds && !sliceIds.includes(c.slice)) errs.push(`${at}: slice ${c.slice} is not in the plan`);
    if (!KINDS.includes(c.kind)) errs.push(`${at}: kind must be one of ${KINDS.join(', ')}`);
    if (typeof c.cmd !== 'string' || !c.cmd.trim()) errs.push(`${at}: cmd must be a non-empty string`);
    if (c.expect !== undefined) {
      if (typeof c.expect !== 'object' || c.expect === null) errs.push(`${at}: expect must be an object`);
      else {
        if (c.expect.exit !== undefined && !Number.isInteger(c.expect.exit)) errs.push(`${at}: expect.exit must be an integer`);
        if (c.expect.stdout !== undefined) {
          try { new RegExp(c.expect.stdout); } catch { errs.push(`${at}: expect.stdout is not a valid regex`); }
        }
      }
    }
    const t = c.timeout_s;
    if (!Number.isInteger(t) || t < 1 || t > 600) errs.push(`${at}: timeout_s must be an integer from 1 to 600`);
    if (c.fast !== undefined && typeof c.fast !== 'boolean') errs.push(`${at}: fast must be true or false`);
    if (c.fast === true && Number.isInteger(t) && t > 120) errs.push(`${at}: a fast check needs timeout_s of 120 or less`);
    if (c.protects !== undefined && !(Array.isArray(c.protects) && c.protects.every((p) => typeof p === 'string'))) {
      errs.push(`${at}: protects must be a list of paths`);
    }
  });
  return errs;
}

// The freeze. Once a plan is approved, a check's frozen fields and its
// protects list may only grow: changing a field, dropping a check or dropping
// a protected path needs a person. A snapshot holds a short hash per frozen
// field, so evidence records can be compared without storing commands.
export const FROZEN = ['cmd', 'expect', 'kind', 'timeout_s', 'fast', 'slice'];

const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const short = (v) => createHash('sha256').update(JSON.stringify(canon(v) ?? null)).digest('hex').slice(0, 12);

export function snapshot(checks) {
  const out = {};
  for (const c of checks ?? []) {
    if (!c || typeof c.id !== 'string') continue;
    out[c.id] = { f: Object.fromEntries(FROZEN.map((k) => [k, short(c[k])])), protects: [...(c.protects ?? [])].sort() };
  }
  return out;
}

// What got looser from `before` to `after` (both snapshots): [{ id, why }].
export function loosened(before, after) {
  const out = [];
  for (const [id, b] of Object.entries(before ?? {})) {
    const a = after[id];
    if (!a) { out.push({ id, why: 'removed' }); continue; }
    const why = FROZEN.filter((k) => b.f?.[k] !== a.f?.[k]);
    for (const p of b.protects ?? []) if (!a.protects.includes(p)) why.push(`protects -${p}`);
    if (why.length) out.push({ id, why: why.join(', ') });
  }
  return out;
}

// The file text a Write, Edit or MultiEdit would leave. null when the edit
// can't apply (the tool then fails on its own).
export function applyEdit(text, toolName, input) {
  if (toolName === 'Write' || typeof input.content === 'string') return input.content ?? null;
  const edits = Array.isArray(input.edits) ? input.edits : [input];
  let t = text;
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string' || !t.includes(e.old_string)) return null;
    t = e.replace_all ? t.split(e.old_string).join(e.new_string) : t.replace(e.old_string, () => e.new_string);
  }
  return t;
}
