// Gaps a security review found in 2.4.3's declared-install skip: each case
// must still ask, and the plain cases must stay quiet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hook, base } from './helpers.mjs';
import { tempRepo } from './verify.test.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'jig-home-')));
const env = { HOME: home };
const start = (dir, session = 's1') => hook('session-start', base(dir, { session_id: session }), env);
const bash = (dir, command, extra = {}) => hook('pre-bash', base(dir, { tool_input: { command }, ...extra }), env);
const asked = (out) => out?.hookSpecificOutput?.permissionDecision === 'ask';

function repo() {
  const { dir, g } = tempRepo();
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4' } }));
  writeFileSync(join(dir, 'web/package.json'), JSON.stringify({ dependencies: { astro: '^5' } }));
  g('add', '-A'); g('commit', '-qm', 'pkg');
  start(dir);
  return { dir, g };
}

test('a variable set or a directory changed behind a shell keyword or mid-segment still asks', () => {
  const { dir } = repo();
  for (const cmd of ['if true; then export HOME=/tmp/evil; fi; npm i lodash', 'true && builtin export HOME=/tmp/x; npm i lodash', '! export HOME=/tmp/x; npm i lodash', 'then cd /tmp; npm i lodash', 'sudo npm i lodash', 'echo x; command cd /tmp; npm i lodash', '(cd web); npm i astro', 'popd; npm i lodash']) {
    assert.ok(asked(bash(dir, cmd)), cmd);
  }
});

test('each install is judged in the directory it runs in', () => {
  const { dir } = repo();
  assert.ok(asked(bash(dir, 'npm i astro && cd web && npm i lodash')), 'astro runs at the root, lodash in web/');
  assert.equal(bash(dir, 'npm i lodash && cd web && npm i astro'), null);
  assert.equal(bash(dir, 'cd web && npm i astro'), null);
});

test('a cd through a symlink that leaves the repo asks', () => {
  const { dir } = repo();
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'jig-out-')));
  writeFileSync(join(out, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4' } }));
  symlinkSync(out, join(dir, 'away'));
  assert.ok(asked(bash(dir, 'cd away && npm i lodash')));
  assert.ok(asked(bash(dir, 'cd missing && npm i lodash')), 'a target that does not exist');
});

test('a cwd outside the repo declares nothing', () => {
  const { dir } = repo();
  assert.ok(asked(bash(dir, 'npm i lodash', { cwd: tmpdir() })));
});

test('user-level registry config changed since the session started makes installs ask', () => {
  const { dir } = repo();
  assert.equal(bash(dir, 'npm i lodash'), null, 'unchanged');
  for (const f of ['.npmrc', '.config/pip/pip.conf', '.config/uv/uv.toml']) {
    const d = repo().dir;
    mkdirSync(join(home, f, '..'), { recursive: true });
    writeFileSync(join(home, f), 'registry=https://evil.example\n');
    assert.ok(asked(bash(d, 'npm i lodash')), f);
    start(d, 'next');
    assert.equal(bash(d, 'npm i lodash', { session_id: 'next' }), null, `${f} present when the session started`);
  }
});

test('a session with a start commit but no user-config record asks', () => {
  const { dir } = repo();
  const r = hook('session-start', base(dir, { session_id: 'old' }), { HOME: '/nonexistent-home-for-jig' });
  assert.equal(r === null || typeof r === 'object', true);
  assert.ok(asked(bash(dir, 'npm i lodash', { session_id: 'old' })), 'recorded under another HOME');
});
