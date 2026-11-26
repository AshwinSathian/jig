// S9: tamper signals. The router finds them from the diff and evidence.jsonl,
// with file:line, so the review never relies on a model to notice them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, appendFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { planRepo } from './helpers.mjs';
import { reviewBrief } from '../cli/lib/review.mjs';

const sha = (dir, ref = 'HEAD') => execFileSync('git', ['rev-parse', ref], { cwd: dir, encoding: 'utf8' }).trim();
const kinds = (b) => b.tamper.map((t) => `${t.signal} ${t.file}:${t.line}`);

function repo() {
  const r = planRepo();
  writeFileSync(join(r.dir, 'test/b.test.js'), [
    "import assert from 'node:assert';",
    "test('adds', () => {",
    '  assert.equal(add(1, 2), 3);',
    '  assert.equal(add(-1, 1), 0);',
    '});',
    '',
  ].join('\n'));
  // test/new.test.js is protected before it exists, as a slice's checks.json does.
  writeFileSync(join(r.dir, 'docs/plans/demo/checks.json'), JSON.stringify({ version: 1, checks: [
    { id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'node -e ""', timeout_s: 10, fast: true, protects: ['test/a.accept.test.js', 'test/new.test.js'] },
  ] }));
  r.g('add', '-A'); r.g('commit', '-qm', 'tests');
  return { ...r, start: sha(r.dir) };
}

test('a removed assertion, an added skip or only, and exit(0) in a test are signals with file:line', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'test/b.test.js'), [
    "import assert from 'node:assert';",
    "test.only('adds', () => {",
    '  assert.equal(add(1, 2), 3);',
    '});',
    "it.skip('later', () => {});",
    'process.exit(0);',
    '',
  ].join('\n'));
  const b = reviewBrief(dir, { base: start });
  assert.deepEqual(kinds(b).sort(), [
    'assertion-removed test/b.test.js:4',
    'exit-zero test/b.test.js:6',
    'only test/b.test.js:2',
    'skip test/b.test.js:5',
  ]);
  assert.match(b.tamper.find((t) => t.signal === 'assertion-removed').text, /add\(-1, 1\)/);
});

test('editing checks.json or a protected path from the base is a signal', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'test/a.accept.test.js'), '// spec, weakened\n');
  writeFileSync(join(dir, 'test/new.test.js'), '// new\n');
  const checks = join(dir, 'docs/plans/demo/checks.json');
  writeFileSync(checks, JSON.stringify({ version: 1, checks: [{ id: 'C1', slice: 'S1', kind: 'acceptance', cmd: 'true', timeout_s: 10, fast: true }] }));
  const b = reviewBrief(dir, { base: start });
  assert.ok(kinds(b).includes('protected test/a.accept.test.js:1'), kinds(b).join(', '));
  assert.ok(!kinds(b).some((k) => k.startsWith('protected test/new')), 'a protected file the change creates');
  assert.ok(kinds(b).some((k) => k.startsWith('checks-edited docs/plans/demo/checks.json:')), kinds(b).join(', '));
});

test('the same check failing twice on one tree is a signal', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  mkdirSync(join(dir, '.git/jig'), { recursive: true });
  const ev = (pass, tree) => appendFileSync(join(dir, '.git/jig/evidence.jsonl'), `${JSON.stringify({ v: 1, t: Date.now(), plan: 'docs/plans/demo/PLAN.md', slice: 'S1', tree, results: [{ id: 'C1', pass }] })}\n`);
  appendFileSync(join(dir, '.git/jig/evidence.jsonl'), `${JSON.stringify({ v: 1, t: 1000, plan: 'docs/plans/demo/PLAN.md', tree: 'cccc', results: [{ id: 'C1', pass: false }] })}\n`.repeat(2));
  ev(false, 'aaaa'); ev(false, 'bbbb'); ev(false, 'bbbb'); ev(true, 'bbbb');
  const b = reviewBrief(dir, { base: start });
  const r = b.tamper.filter((t) => t.signal === 'repeat-fail');
  assert.equal(r.length, 1);
  assert.equal(r[0].check, 'C1');
  assert.equal(r[0].tree, 'bbbb');
});

test('clean changes have no signals, and adding assertions or tests is not one', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\nexport function skip() { process.exit(0); }\n');
  appendFileSync(join(dir, 'test/b.test.js'), "test('more', () => { assert.ok(true); });\n");
  const b = reviewBrief(dir, { base: start });
  assert.deepEqual(b.tamper, []);
});

test('the transcript is reported readable only when it exists and parses', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  const sessions = join(dir, '.git/jig/sessions');
  mkdirSync(sessions, { recursive: true });
  const t = join(realpathSync(mkdtempSync(join(tmpdir(), 'jig-tr-'))), 't.jsonl');
  writeFileSync(join(sessions, 's1.json'), JSON.stringify({ transcript: t, startHead: start, editedAt: 1 }));
  assert.deepEqual(reviewBrief(dir, { base: start }).transcript, { path: t, readable: false }, 'missing');
  writeFileSync(t, '{"type":"user"}\nnot json\n');
  assert.equal(reviewBrief(dir, { base: start }).transcript.readable, false, 'does not parse');
  writeFileSync(t, '{"type":"user"}\n{"type":"assistant"}\n');
  assert.equal(reviewBrief(dir, { base: start }).transcript.readable, true);
  assert.equal(reviewBrief(dir, { base: start, blind: true }).transcript, undefined, 'the blind brief leaves it out: it is the builder\'s account');
  writeFileSync(join(sessions, 's1.json'), JSON.stringify({ transcript: t, startHead: sha(dir, 'HEAD~1'), editedAt: 1 }));
  assert.equal(reviewBrief(dir, { base: start }).transcript, null, 'a session that started before the base');
  writeFileSync(join(sessions, 's1.json'), JSON.stringify({ transcript: t, startHead: start, editedAt: 0 }));
  assert.equal(reviewBrief(dir, { base: start }).transcript, null, 'a session that edited nothing, such as a fresh review session');
});

test('moved, re-indented or trivial assertions do not hide a removed one', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'test/b.test.js'), [
    "import assert from 'node:assert';",
    "describe('add', () => {",
    "  test('adds', () => {",
    '    assert.equal(add(1, 2), 3);',
    '    assert.ok(true);',
    '  });',
    '});',
    '',
  ].join('\n'));
  const b = reviewBrief(dir, { base: start });
  assert.deepEqual(kinds(b), ['assertion-removed test/b.test.js:4']);
  assert.equal(b.tamper[0].side, 'base', 'a removed line is numbered on the base side');
});

test('a new test file does not offset assertions deleted elsewhere, and a swapped assertion is a signal', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'test/b.test.js'), "import assert from 'node:assert';\ntest('adds', () => {\n  assert.equal(add(1, 2), 3);\n  assert.equal(add(2, 2), 4);\n});\n");
  writeFileSync(join(dir, 'test/n.test.js'), "test('n', () => {\n  assert.equal(n(1), 1);\n  assert.equal(n(2), 2);\n  assert.equal(n(3), 3);\n});\n");
  writeFileSync(join(dir, 'test/q.test.js'), "test('q', () => { assert.deepEqual(parse(['--skip']), { skip: true }); });\n");
  assert.deepEqual(kinds(reviewBrief(dir, { base: start })), ['assertion-removed test/b.test.js:4']);
});

test('an assertion moved to another test file is not a removal', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'test/b.test.js'), "import assert from 'node:assert';\ntest('adds', () => {\n  assert.equal(add(1, 2), 3);\n});\n");
  writeFileSync(join(dir, 'test/c.test.js'), "import assert from 'node:assert';\ntest('negative', () => {\n  assert.equal(add(-1, 1), 0);\n});\n");
  assert.deepEqual(reviewBrief(dir, { base: start }).tamper, []);
});

test('more skip forms, Go assertions, and || true or continue-on-error in CI are signals; fixture strings are not', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'test/d.test.js'), ["xtest('a', () => {});", "test.skipIf(ci)('b', () => {});", "test('c', { skip: 'flaky' }, () => {});", "test('d', { todo: true }, () => {});", "const cases = [['J1', 'npm test; exit 0']];", ''].join('\n'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/ci.yml'), 'jobs:\n  t:\n    continue-on-error: true\n    steps:\n      - run: npm test || true\n');
  const r = repo();
  writeFileSync(join(r.dir, 'y_test.go'), 'package y\nfunc TestY(t *testing.T) {\n\tt.Errorf("bad")\n}\n');
  r.g('add', '-A'); r.g('commit', '-qm', 'go');
  const goStart = sha(r.dir);
  writeFileSync(join(r.dir, 'y_test.go'), 'package y\nfunc TestY(t *testing.T) {\n}\n');
  const k = kinds(reviewBrief(dir, { base: start }));
  for (const want of ['skip test/d.test.js:1', 'skip test/d.test.js:2', 'skip test/d.test.js:3', 'skip test/d.test.js:4', 'swallowed-failure .github/workflows/ci.yml:3', 'swallowed-failure .github/workflows/ci.yml:5']) assert.ok(k.includes(want), `${want} in ${k.join(', ')}`);
  assert.ok(!k.some((x) => x.startsWith('exit-zero')), 'a fixture string in a test');
  assert.deepEqual(kinds(reviewBrief(r.dir, { base: goStart })), ['assertion-removed y_test.go:3']);
});

test('an unreadable checks.json at the base is a signal, not silence', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), '{ not json');
  g('add', '-A'); g('commit', '-qm', 'broken');
  const start = sha(dir);
  writeFileSync(join(dir, 'src/a.js'), 'export const a = 2;\n');
  assert.ok(kinds(reviewBrief(dir, { base: start })).includes('checks-unreadable docs/plans/demo/checks.json:1'));
});

test('a plansDir changed in the working tree does not hide the base checks.json', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, '.jig.json'), JSON.stringify({ plansDir: 'other/plans' }));
  mkdirSync(join(dir, 'other/plans'), { recursive: true });
  writeFileSync(join(dir, 'test/a.accept.test.js'), '// spec, weakened\n');
  writeFileSync(join(dir, 'docs/plans/demo/checks.json'), '{}');
  const k = kinds(reviewBrief(dir, { base: start }));
  for (const want of ['config-edited .jig.json:1', 'protected test/a.accept.test.js:1', 'checks-edited docs/plans/demo/checks.json:1']) assert.ok(k.includes(want), `${want} in ${k.join(', ')}`);
});

test('an added line that opens a comment, triple quote or template is a signal; an edited line is a removal; a binary test is a signal', () => {
  const { dir, start } = repo();
  const body = (lines) => writeFileSync(join(dir, 'test/b.test.js'), ["import assert from 'node:assert';", "test('adds', () => {", '  assert.equal(add(1, 2), 3);', ...lines, '});', ''].join('\n'));
  for (const [opener, why] of [['  /*', 'block comment'], ['  const x = this.#a; /*', 'mid-line block comment'], ['  const f = `', 'template literal'], ["  '''", 'triple quote']]) {
    body([opener, '  assert.equal(add(-1, 1), 0);', '  */']);
    const k = kinds(reviewBrief(dir, { base: start }));
    assert.ok(k.includes('comment-opened test/b.test.js:4') && !k.some((x) => x.startsWith('assertion-removed')), `${why}: ${k.join(', ')}`);
  }
  body(["  const glob = '**/*.js';", '  assert.equal(add(-1, 1), 0);']);
  assert.ok(!kinds(reviewBrief(dir, { base: start })).some((k) => k.startsWith('assertion-removed')), 'a glob string hides nothing');
  const r = repo();
  writeFileSync(join(r.dir, 'test/u.test.js'), "test('u', () => {\n  assert.equal(url(), 'http: //a');\n});\n");
  r.g('add', '-A'); r.g('commit', '-qm', 'u');
  const uStart = sha(r.dir);
  writeFileSync(join(r.dir, 'test/u.test.js'), "test('u', () => {\n  assert.equal(url(), 'http: //b');\n});\n");
  assert.deepEqual(kinds(reviewBrief(r.dir, { base: uStart })), ['assertion-removed test/u.test.js:2'], 'an edited assertion');
  writeFileSync(join(dir, 'test/b.test.js'), Buffer.from([0, 1, 2, 0, 255]));
  assert.ok(kinds(reviewBrief(dir, { base: start })).some((k) => k.startsWith('test-binary test/b.test.js')));
});

test('a removed closer, an escaped backtick and Ruby or heredoc openers are signals too', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'test/b.test.js'), "test('adds', () => {\n  /* old note\n  */\n  assert.equal(add(1, 2), 3);\n});\n");
  g('add', '-A'); g('commit', '-qm', 'note');
  const start = sha(dir);
  writeFileSync(join(dir, 'test/b.test.js'), "test('adds', () => {\n  /* old note\n  assert.equal(add(1, 2), 3);\n});\n");
  assert.ok(kinds(reviewBrief(dir, { base: start })).includes('comment-opened test/b.test.js:3'), 'a removed */');
  const r = repo();
  writeFileSync(join(r.dir, 'test/r_test.rb'), '=begin\nassert_equal 1, 1\n');
  writeFileSync(join(r.dir, 'test/h_test.rb'), 'x = <<~EOS\nassert_equal 1, 1\n');
  writeFileSync(join(r.dir, 'test/e.test.js'), 'const s = `a \\` b`; const t = `\n');
  const k = kinds(reviewBrief(r.dir, { base: r.start }));
  for (const want of ['comment-opened test/r_test.rb:1', 'comment-opened test/h_test.rb:1', 'comment-opened test/e.test.js:1']) assert.ok(k.includes(want), `${want} in ${k.join(', ')}`);
});

test('a removed heredoc tag, a backslash-backtick and multi-line quote openers are signals', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'test/h_test.rb'), "x = <<~EOS\nnote\nEOS\nassert_equal 1, 1\n");
  g('add', '-A'); g('commit', '-qm', 'rb');
  const start = sha(dir);
  writeFileSync(join(dir, 'test/h_test.rb'), "x = <<~EOS\nnote\nassert_equal 1, 1\n");
  writeFileSync(join(dir, 'test/s.test.sh'), "echo 'open\n");
  writeFileSync(join(dir, 'test/p_test.rb'), 'x = %q(\n');
  writeFileSync(join(dir, 'test/r_test.rs'), 'let s = r#"\n');
  writeFileSync(join(dir, 'test/m_test.go'), 'x := `\\`\n');
  const k = kinds(reviewBrief(dir, { base: start }));
  for (const want of ['comment-opened test/h_test.rb:3', 'comment-opened test/s.test.sh:1', 'comment-opened test/p_test.rb:1', 'comment-opened test/r_test.rs:1', 'comment-opened test/m_test.go:1']) assert.ok(k.includes(want), `${want} in ${k.join(', ')}`);
});

test('quote and closer checks fail closed outside languages with one-line strings', () => {
  const { dir, g } = repo();
  writeFileSync(join(dir, 'test/l_test.lua'), 'x = [==[\nnote\n]==]\nassert(1 == 1)\n');
  writeFileSync(join(dir, 'test/q_test.rb'), 'x = %q(\nnote\n)\nassert_equal 1, 1\n');
  g('add', '-A'); g('commit', '-qm', 'more');
  const start = sha(dir);
  writeFileSync(join(dir, 'test/l_test.lua'), 'x = [==[\nnote\nassert(1 == 1)\n');
  writeFileSync(join(dir, 'test/q_test.rb'), 'x = %q(\nnote\nassert_equal 1, 1\n');
  writeFileSync(join(dir, 'test/f.test.fish'), "echo 'open\n");
  writeFileSync(join(dir, 'test/a.test.js'), "test('x', () => {});\n");
  const k = kinds(reviewBrief(dir, { base: start }));
  for (const want of ['comment-opened test/l_test.lua:3', 'comment-opened test/q_test.rb:3', 'comment-opened test/f.test.fish:1']) assert.ok(k.includes(want), `${want} in ${k.join(', ')}`);
  assert.ok(!k.some((x) => x.startsWith('comment-opened test/a.test.js')), 'a JS line with paired quotes');
});

test('C and C# raw strings, and a line ending in a backslash, are signals', () => {
  const { dir, start } = repo();
  writeFileSync(join(dir, 'test/a_test.cpp'), 'auto s = R"x(\n');
  writeFileSync(join(dir, 'test/b_test.cs'), 'var s = @"\n');
  writeFileSync(join(dir, 'test/c.test.js'), "const s = 'a \\\\\n");
  const k = kinds(reviewBrief(dir, { base: start }));
  for (const want of ['comment-opened test/a_test.cpp:1', 'comment-opened test/b_test.cs:1', 'comment-opened test/c.test.js:1']) assert.ok(k.includes(want), `${want} in ${k.join(', ')}`);
});
