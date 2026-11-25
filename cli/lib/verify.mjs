import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadChecks } from './checks.mjs';
import { parsePlan, section } from './plan.mjs';
import { stateDir } from './git.mjs';
import { today } from './scaffold.mjs';

function lastLine(s) {
  const lines = (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 200) : '';
}

export function runCheck(root, c) {
  const t0 = Date.now();
  const r = spawnSync(c.cmd, { cwd: root, shell: true, encoding: 'utf8', timeout: (c.timeout_s ?? 60) * 1000, maxBuffer: 32 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const want = c.expect?.exit ?? 0;
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  let pass = !r.error && r.status === want;
  let why = '';
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') { pass = false; why = `timed out after ${c.timeout_s}s`; }
  else if (r.error) { pass = false; why = r.error.message; }
  else if (r.status !== want) why = `exit ${r.status} (expected ${want}): ${lastLine(r.stderr) || lastLine(r.stdout)}`;
  if (pass && c.expect?.stdout && !new RegExp(c.expect.stdout, 'm').test(out)) { pass = false; why = `output did not match /${c.expect.stdout}/`; }
  return { id: c.id, slice: c.slice, cmd: c.cmd, pass, exit: r.status, ms, why, evidence: pass ? lastLine(r.stdout) : why };
}

export function selectChecks(checks, { slice = null, fast = false, ids = null } = {}) {
  return checks.filter((c) => (!slice || c.slice === slice) && (!fast || c.fast === true) && (!ids || ids.includes(c.id)));
}

export function verifyPlan(root, planPath, opts = {}) {
  const loaded = loadChecks(planPath);
  if (!loaded.exists) return { error: `no checks.json beside ${relative(root, planPath)}` };
  if (loaded.error) return { error: `checks.json: ${loaded.error}` };
  const chosen = selectChecks(loaded.data.checks ?? [], opts);
  const results = chosen.map((c) => runCheck(root, c));
  const record = { t: Date.now(), plan: relative(root, planPath), slice: opts.slice ?? null, fast: Boolean(opts.fast), results: results.map(({ id, pass, exit, ms }) => ({ id, pass, exit, ms })) };
  appendFileSync(join(stateDir(root), 'evidence.jsonl'), JSON.stringify(record) + '\n');
  if (opts.record && results.length) appendLog(planPath, logLine(results, opts.slice));
  return { results };
}

export function logLine(results, slice) {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const parts = results.map((r) => (r.pass ? `${r.id} pass` : `${r.id} FAIL (${r.why})`));
  return `- ${today()} ${hm}: jig verify${slice ? ` ${slice}` : ''}: ${parts.join('; ')}`;
}

// Append under ## Log (which is the last section by the format rules).
export function appendLog(planPath, line) {
  const text = readFileSync(planPath, 'utf8');
  const plan = parsePlan(text);
  const log = section(plan, 'Log');
  if (!log) { writeFileSync(planPath, text.replace(/\s*$/, '\n\n## Log\n' + line + '\n')); return; }
  const lines = plan.lines;
  let end = log.end;
  while (end > log.start + 1 && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, line);
  writeFileSync(planPath, lines.join('\n').replace(/\n*$/, '\n'));
}

export function lastEvidence(root) {
  const p = join(stateDir(root), 'evidence.jsonl');
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean);
  try { return lines.length ? JSON.parse(lines[lines.length - 1]) : null; } catch { return null; }
}
