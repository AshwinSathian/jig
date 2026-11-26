// What jig adds to every session's skill listing. Claude Code cuts each
// description at 1,536 characters and gives the listing about 1% of the
// context window, dropping the least-used skills' descriptions first
// (skills docs). jig's share is capped at 2,600 characters in the plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const front = (p) => {
  const m = readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, `${p} has no frontmatter`);
  return Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]));
};
const skills = readdirSync(join(ROOT, 'skills')).filter((d) => existsSync(join(ROOT, 'skills', d, 'SKILL.md'))).map((d) => ({ path: `skills/${d}/SKILL.md`, ...front(join(ROOT, 'skills', d, 'SKILL.md')) }));
const agents = readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => ({ path: `agents/${f}`, ...front(join(ROOT, 'agents', f)) }));
const all = [...skills, ...agents];

test('every description fits the 1,536-character cut', () => {
  for (const e of all) assert.ok(e.description && e.description.length <= 1536, `${e.path}: ${e.description?.length}`);
});

test("jig's skill and agent descriptions total at most 2,600 characters", () => {
  const total = all.reduce((n, e) => n + e.description.length, 0);
  assert.ok(total <= 2600, `total ${total}: ${all.map((e) => `${e.path} ${e.description.length}`).join(', ')}`);
});

test('no skill sets model or effort (they invalidate the prompt cache)', () => {
  for (const s of skills) for (const k of ['model', 'effort']) assert.ok(!(k in s), `${s.path} sets ${k}`);
});

test('the review skill names jig and plans or slices, so it does not compete for generic review prompts', () => {
  const r = skills.find((s) => s.name === 'review');
  assert.ok(r, 'skills/review/SKILL.md with name: review');
  assert.match(r.description, /\bjig\b/);
  assert.match(r.description, /\b(plan|slice)s?\b/);
  assert.match(r.description, /after (building|a slice|jig:build)/i);
  assert.match(r.description, /not for/i, 'says which review requests it leaves to other tools');
});
