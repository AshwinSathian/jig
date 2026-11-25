import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
