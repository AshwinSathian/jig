// Clean control: input validation added, with the error it documents.
const base = {
  'package.json': '{ "type": "module" }\n',
  'src/age.js': 'export const parseAge = (s) => Number(s);\n',
};
const head = { ...base, 'src/age.js': `// Rejects anything but a whole number from 0 to 150.
export function parseAge(s) {
  if (!/^\\d{1,3}$/.test(String(s))) throw new RangeError('age must be a whole number');
  const n = Number(s);
  if (n > 150) throw new RangeError('age must be at most 150');
  return n;
}
` };
export default {
  id: 'control-validate', set: 'control', kinds: ['plan-free'],
  request: 'parseAge should reject anything that is not a whole number from 0 to 150.',
  pr: { title: 'Validate age', body: 'Throws RangeError on bad input.' },
  base, head, defects: [],
  proof: { cmd: 'node proof.mjs', files: { 'proof.mjs': `import { parseAge } from './src/age.js';
const bad = (s) => { try { parseAge(s); return false; } catch (e) { return e instanceof RangeError; } };
if (parseAge('42') !== 42 || parseAge('0') !== 0 || parseAge('150') !== 150) process.exit(1);
if (!['-1', '1.5', 'x', '151', '', '1e2'].every(bad)) process.exit(1);
` } },
};
