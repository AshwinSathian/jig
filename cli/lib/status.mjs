import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, normalize, isAbsolute } from 'node:path';
import { parsePlan, touchPaths } from './plan.mjs';

const ACTIVE = ['approved', 'building'];

// Where this repo keeps plans. `.jig.json` {"plansDir": "..."} wins; else an
// existing docs/plans/ or docs/plan/ (the repo's convention); else docs/plans/.
export function plansDir(root) {
  try {
    const cfg = JSON.parse(readFileSync(join(root, '.jig.json'), 'utf8'));
    if (typeof cfg.plansDir === 'string' && cfg.plansDir.trim()) {
      // .jig.json comes from the repo, so it may not point outside it or at a
      // source tree: the edit hook exempts this directory from scope checks.
      const d = normalize(cfg.plansDir.trim()).replace(/\/+$/, '');
      if (!isAbsolute(d) && !d.split('/').includes('..') && d !== '.' && /plan/i.test(d.split('/').pop())) return d;
      process.stderr.write(`jig: ignoring .jig.json plansDir "${cfg.plansDir}" (must be a relative folder inside the repo whose name contains "plan")\n`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') process.stderr.write(`jig: ignoring unreadable .jig.json (${e.message})\n`);
  }
  for (const d of ['docs/plans', 'docs/plan']) if (existsSync(join(root, d)) && statSync(join(root, d)).isDirectory()) return d;
  return 'docs/plans';
}

// PLAN.md files one level under the plans directory, plus docs/PLAN.md (the
// convention in older repos). Bounded: no recursive walk.
export function findPlans(root) {
  const found = [];
  const seen = new Set();
  const add = (p) => { if (!seen.has(p) && existsSync(p) && statSync(p).isFile()) { seen.add(p); found.push(p); } };
  for (const d of new Set([plansDir(root), 'docs/plans', 'docs/plan'])) {
    const base = join(root, d);
    if (!existsSync(base) || !statSync(base).isDirectory()) continue;
    for (const n of readdirSync(base)) add(join(base, n, 'PLAN.md'));
  }
  add(join(root, 'docs', 'PLAN.md'));
  return found;
}

export function readPlan(path) {
  return parsePlan(readFileSync(path, 'utf8'));
}

export function activePlans(root) {
  return findPlans(root)
    .map((path) => ({ path, plan: readPlan(path) }))
    .filter(({ plan }) => ACTIVE.includes(plan.header?.status?.toLowerCase()));
}

export function doingSlice(plan) {
  return plan.slices.find((s) => s.state === 'doing') ?? null;
}

export function sliceTouch(slice) {
  return slice?.fields.touch ? touchPaths(slice.fields.touch.value).map((t) => t.path) : [];
}

// A few lines per active plan; used by `jig status` and the SessionStart hook.
export function statusSummary(root, { max = 3 } = {}) {
  const plans = activePlans(root).slice(0, max);
  return plans.map(({ path, plan }) => {
    const rel = relative(root, path);
    const counts = { todo: 0, doing: 0, done: 0, dropped: 0 };
    for (const s of plan.slices) if (s.state in counts) counts[s.state]++;
    const cur = doingSlice(plan);
    const next = plan.slices.find((s) => s.state === 'todo');
    const lines = [
      `${plan.title ?? rel} (${rel}) · ${plan.header.status} · ${counts.done}/${plan.slices.length - counts.dropped} slices done`,
      `  Now: ${plan.now ?? '(no Now line)'}`,
    ];
    if (cur) lines.push(`  Doing: ${cur.id} ${cur.title}${sliceTouch(cur).length ? ` · touch: ${sliceTouch(cur).join(', ')}` : ''}`);
    else if (next) lines.push(`  Next: ${next.id} ${next.title}`);
    return lines.join('\n');
  });
}
