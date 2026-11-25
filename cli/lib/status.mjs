import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parsePlan, touchPaths } from './plan.mjs';

const ACTIVE = ['approved', 'building'];

// Find PLAN.md files under docs/plans/ (and docs/PLAN.md, the convention in
// older repos). Bounded: two levels, no node_modules.
export function findPlans(root) {
  const found = [];
  const base = join(root, 'docs', 'plans');
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      const p = join(base, d, 'PLAN.md');
      if (existsSync(p) && statSync(p).isFile()) found.push(p);
    }
  }
  const legacy = join(root, 'docs', 'PLAN.md');
  if (existsSync(legacy)) found.push(legacy);
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
