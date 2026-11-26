// 2.4.5: the declared-install skip applies only when every other segment is
// on a short allowlist, so a new spelling of shell state can't slip past.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { hook, base } from './helpers.mjs';
import { tempRepo } from './verify.test.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'jig-home-')));
const xdg = realpathSync(mkdtempSync(join(tmpdir(), 'jig-xdg-')));
const env = { HOME: home, XDG_CONFIG_HOME: xdg };
const start = (dir, session = 's1', e = env) => hook('session-start', base(dir, { session_id: session }), e);
const bash = (dir, command, extra = {}, e = env) => hook('pre-bash', base(dir, { tool_input: { command }, ...extra }), e);
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

test('any segment outside the allowlist makes a declared install ask', () => {
  const { dir } = repo();
  for (const cmd of ['read HOME <<< /tmp/x; npm i lodash', 'printf -v HOME /tmp/x; npm i lodash', 'mapfile -t a < f; npm i lodash', 'let x=1; npm i lodash', 'cp /tmp/e "$HOME/.config/pnpm/rc"; npm i lodash', 'python3 -c "print(1)"; npm i lodash', 'node -e 1 && npm i lodash', '"cd" /tmp; npm i lodash', 'c\\d /tmp; npm i lodash', '$X /tmp; npm i lodash', 'npm i lodash && npm test', 'tee x < y; npm i lodash', 'npm i lodash | tee .npmrc2']) {
    assert.ok(asked(bash(dir, cmd)), cmd);
  }
});

test('plain installs, plain cd and output filters stay quiet', () => {
  const { dir } = repo();
  for (const cmd of ['npm i lodash', 'npm i lodash 2>&1 | tail -3', 'npm i lodash | grep -v warn', 'npm i lodash 2>&1 | head -n 20', 'cd ./web && npm i astro', 'cd ./web; npm i astro 2>&1 | tail -5']) {
    assert.equal(bash(dir, cmd), null, cmd);
  }
});

test('XDG, pnpm and parent-directory config, and registry env vars, are fingerprinted', () => {
  const cases = [
    () => { mkdirSync(join(xdg, 'pip'), { recursive: true }); writeFileSync(join(xdg, 'pip/pip.conf'), '[global]\nindex-url=https://evil\n'); },
    () => { mkdirSync(join(xdg, 'pnpm'), { recursive: true }); writeFileSync(join(xdg, 'pnpm/rc'), 'registry=https://evil\n'); },
  ];
  for (const change of cases) {
    const { dir } = repo();
    change();
    assert.ok(asked(bash(dir, 'npm i lodash')), String(change));
  }
  // A repo inside its own parent directory, so the parent's uv.toml is ours.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'jig-parent-')));
  const dir = join(parent, 'repo');
  mkdirSync(dir);
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4' } }));
  g('add', '-A'); g('commit', '-qm', 'pkg');
  start(dir);
  assert.equal(bash(dir, 'npm i lodash'), null, 'before the parent uv.toml');
  writeFileSync(join(dirname(dir), 'uv.toml'), 'index-url = "https://evil"\n');
  assert.ok(asked(bash(dir, 'npm i lodash')), 'uv.toml in a parent directory');
  const r = repo();
  assert.ok(asked(bash(r.dir, 'npm i lodash', {}, { ...env, NPM_CONFIG_REGISTRY: 'https://evil' })), 'a registry env var that differs from the session start');
});

test('cd -, CDPATH, an env-named config file and ~/.config under a set XDG_CONFIG_HOME are covered', () => {
  const { dir, g } = tempRepo();
  mkdirSync(join(dir, '-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4' } }));
  writeFileSync(join(dir, '-/package.json'), JSON.stringify({ dependencies: { lodash: '^4' } }));
  g('add', '-A'); g('commit', '-qm', 'dash'); start(dir);
  assert.ok(asked(bash(dir, 'cd - && npm i lodash')), 'cd - goes to OLDPWD');
  const cdpath = { ...env, CDPATH: tmpdir() };
  const c = repo(); start(c.dir, 'cp', cdpath);
  assert.ok(asked(bash(c.dir, 'cd web && npm i astro', { session_id: 'cp' }, cdpath)), 'CDPATH can send cd elsewhere');
  const conf = join(realpathSync(mkdtempSync(join(tmpdir(), 'jig-conf-'))), 'pip.conf');
  writeFileSync(conf, '');
  const named = { ...env, PIP_CONFIG_FILE: conf };
  const n = repo(); start(n.dir, 'n', named);
  assert.equal(bash(n.dir, 'npm i lodash', { session_id: 'n' }, named), null, 'unchanged');
  writeFileSync(conf, '[global]\nindex-url=https://evil\n');
  assert.ok(asked(bash(n.dir, 'npm i lodash', { session_id: 'n' }, named)), 'the file PIP_CONFIG_FILE names changed');
  const x = repo();
  mkdirSync(join(home, '.config/pip'), { recursive: true });
  writeFileSync(join(home, '.config/pip/pip.conf'), '[global]\nindex-url=https://evil\n');
  assert.ok(asked(bash(x.dir, 'npm i lodash')), '~/.config/pip/pip.conf with XDG_CONFIG_HOME set elsewhere');
});

test('a bare relative cd asks: a CDPATH from the shell profile could redirect it', () => {
  const { dir } = repo();
  assert.ok(asked(bash(dir, 'cd web && npm i astro')));
  assert.equal(bash(dir, 'cd ./web && npm i astro'), null, './web is never looked up in CDPATH');
});

test('a relative env-named config path asks', () => {
  const rel = { ...env, NPM_CONFIG_USERCONFIG: 'my.npmrc' };
  const r = repo(); start(r.dir, 'rel', rel);
  assert.ok(asked(bash(r.dir, 'npm i lodash', { session_id: 'rel' }, rel)), 'a relative path depends on the cwd');
});
