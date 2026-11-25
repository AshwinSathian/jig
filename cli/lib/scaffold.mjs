import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { headSha } from './git.mjs';
import { TIERS } from './plan.mjs';

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function planTemplate({ title, tier, baseline, date }) {
  const sliceBody = tier === 'program'
    ? 'Goal: <what this phase makes true>\nPlan: `docs/plans/<child>/PLAN.md`\n'
    : 'Goal: <what is true when this slice is done>\nTouch: `<path>`, `<new path> (new)`\nChecks: ' + (tier === 'brief' ? '`<command>`' : 'C1') + '\n- Risk: <what could go wrong>. Detect: <how you would notice>. Fallback: <what you do then>.\n';
  return `# ${title}

Status: draft · Tier: ${tier} · Baseline: ${baseline} · Updated: ${date}
Now: drafting.

## Outcome
<One to three sentences: what is true for the user when this is done.>
Done when:
- \`<command>\` <expected result>

## Decisions
- <Decision>. Reason: <why>.

## Out of scope
- <Only what a reader would otherwise assume is included.>

## Questions
- None.

## Assumptions
- <What you decided without asking.>

## Slices

### S1: <title> [todo]
${sliceBody}
## Log
- ${date}: Plan started at ${baseline}.
`;
}

export function checksTemplate() {
  return JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: '<command>', expect: { exit: 0 }, timeout_s: 60, fast: true, protects: [] }] }, null, 2) + '\n';
}

export function newPlan(root, slug, { tier = 'brief', title, dir = 'docs/plans' } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('slug must be lowercase kebab-case');
  if (!TIERS.includes(tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`);
  const planDir = join(root, dir, slug);
  const planPath = join(planDir, 'PLAN.md');
  if (existsSync(planPath)) throw new Error(`${join(dir, slug, 'PLAN.md')} already exists`);
  mkdirSync(planDir, { recursive: true });
  const baseline = headSha(root) ?? 'none';
  writeFileSync(planPath, planTemplate({ title: title ?? slug, tier, baseline, date: today() }));
  const written = [planPath];
  if (tier === 'full') {
    writeFileSync(join(planDir, 'checks.json'), checksTemplate());
    written.push(join(planDir, 'checks.json'));
  }
  return written;
}
