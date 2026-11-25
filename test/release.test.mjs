import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('versions agree across package.json, plugin.json, marketplace.json and the CLI', () => {
  const v = json('package.json').version;
  assert.equal(json('.claude-plugin/plugin.json').version, v);
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, v);
  assert.match(readFileSync(join(ROOT, 'cli/jig.mjs'), 'utf8'), new RegExp(`const VERSION = '${v.replace(/\./g, '\\.')}'`));
});

test('the CLI has no runtime dependencies', () => {
  const pkg = json('package.json');
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});

test('bin/jig is executable', () => {
  assert.ok(statSync(join(ROOT, 'bin/jig')).mode & 0o111);
});

test('skills stay short and carry valid frontmatter', () => {
  for (const s of ['plan', 'build', 'guard']) {
    const t = readFileSync(join(ROOT, 'skills', s, 'SKILL.md'), 'utf8');
    const fm = t.match(/^---\n([\s\S]*?)\n---/)[1];
    assert.match(fm, new RegExp(`^name: ${s}$`, 'm'));
    const desc = fm.match(/^description: (.*)$/m)[1];
    assert.ok(desc.length <= 1024, `${s} description is ${desc.length} chars`);
    assert.doesNotMatch(fm, /^(effort|model):/m, 'effort/model in frontmatter would invalidate the prompt cache mid-session');
    assert.ok(t.split('\n').length <= 200, `${s} SKILL.md is ${t.split('\n').length} lines`);
  }
});

test('every reference file is used by a skill or agent, and no stray root SKILL.md ships', async () => {
  const { readdirSync, existsSync } = await import('node:fs');
  const users = ['skills/plan/SKILL.md', 'skills/build/SKILL.md', 'skills/guard/SKILL.md', 'agents/jig-reviewer.md', 'references/plan-format.md', 'references/fundamentals.md']
    .map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n');
  for (const f of readdirSync(join(ROOT, 'references'))) {
    assert.ok(users.includes(f), `references/${f} is not referenced by any skill or agent; delete it or link it`);
  }
  assert.ok(!existsSync(join(ROOT, 'SKILL.md')), 'a root SKILL.md would ship alongside skills/');
});
