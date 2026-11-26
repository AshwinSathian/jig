// Held out: never used to tune prompts or graders. A retry loop swallows
// the last error and returns undefined.
const base = {
  'package.json': '{ "type": "module" }\n',
  'src/retry.js': `export async function retry(fn, n = 3) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= n - 1) throw e; }
  }
}
`,
};
const head = { ...base, 'src/retry.js': `export async function retry(fn, n = 3, wait = 0) {
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch { await new Promise((r) => setTimeout(r, wait)); }
  }
}
` };
export default {
  id: 'heldout-retry', set: 'heldout', kinds: ['plan-free'],
  request: 'Let retry wait between attempts.',
  pr: { title: 'retry wait', body: 'Adds a wait argument.' },
  base, head,
  defects: [{ id: 'swallowed-error', match: /swallow|undefined|last error|never throws|rethrow|error is lost/i }],
  proof: { cmd: 'node proof.mjs', files: { 'proof.mjs': `import { retry } from './src/retry.js';
let threw = false;
try { await retry(async () => { throw new Error('x'); }, 2); } catch { threw = true; }
if (!threw) { console.error('retry returned instead of throwing'); process.exit(1); }
` } },
};
