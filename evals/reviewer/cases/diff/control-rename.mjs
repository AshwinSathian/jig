// Clean control: a rename with its call site and test updated.
const base = {
  'package.json': '{ "type": "module" }\n',
  'src/total.js': 'export const sum = (xs) => xs.reduce((a, b) => a + b, 0);\n',
  'src/report.js': "import { sum } from './total.js';\nexport const report = (xs) => `total ${sum(xs)}`;\n",
};
const head = {
  'package.json': base['package.json'],
  'src/total.js': 'export const total = (xs) => xs.reduce((a, b) => a + b, 0);\n',
  'src/report.js': "import { total } from './total.js';\nexport const report = (xs) => `total ${total(xs)}`;\n",
};
export default {
  id: 'control-rename', set: 'control', kinds: ['plan-free'],
  request: 'Rename sum to total.',
  pr: { title: 'Rename sum to total', body: 'Rename only.' },
  base, head, defects: [],
  proof: { cmd: 'node proof.mjs', files: { 'proof.mjs': `import { report } from './src/report.js';
import { total } from './src/total.js';
if (report([1, 2]) !== 'total 3' || total([]) !== 0) process.exit(1);
` } },
};
