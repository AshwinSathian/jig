// True self-review: in the self arm the session writes this change itself,
// then reviews it. Off-by-one in a page slice. Tuning set.
const base = {
  'package.json': '{ "type": "module" }\n',
  'src/page.js': 'export const page = (items, n, size) => items.slice(n * size, n * size + size);\n',
};
const head = { ...base, 'src/page.js': `// Pages are numbered from 1 in the UI.
export const page = (items, n, size) => items.slice((n - 1) * size, n * size + 1);
` };
export default {
  id: 'self-pagination', set: 'tuning', kinds: ['self-review'],
  request: 'Number pages from 1 instead of 0 in page().',
  pr: { title: 'Pages from 1', body: 'page(items, 1, size) is now the first page.' },
  base, head,
  defects: [{ id: 'off-by-one', match: /off.by.one|\+ ?1|extra (item|element)|too many|size \+ 1|n \* size \+ 1/i }],
  proof: { cmd: 'node proof.mjs', files: { 'proof.mjs': `import { page } from './src/page.js';
const p = page([1, 2, 3, 4, 5], 1, 2);
if (p.length !== 2) { console.error('page 1 has ' + p.length + ' items'); process.exit(1); }
` } },
};
