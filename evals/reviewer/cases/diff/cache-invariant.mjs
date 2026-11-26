// Invariant: an update path writes the store but not the cache, so a read
// after an update is stale. Test set.
const base = {
  'package.json': '{ "type": "module" }\n',
  'src/users.js': `const cache = new Map();
export function getUser(store, id) {
  if (!cache.has(id)) cache.set(id, store.get(id));
  return cache.get(id);
}
export function setName(store, id, name) {
  store.set(id, { ...store.get(id), name });
  cache.delete(id);
}
`,
};
const head = { ...base, 'src/users.js': base['src/users.js'] + `export function setEmail(store, id, email) {
  store.set(id, { ...store.get(id), email });
}
` };
export default {
  id: 'cache-invariant', set: 'test', kinds: ['invariant', 'plan-free'],
  request: 'Add setEmail next to setName.',
  pr: { title: 'setEmail', body: 'Mirrors setName.' },
  base, head,
  defects: [{ id: 'stale-cache', match: /cache|stale|invalidat/i }],
  proof: { cmd: 'node proof.mjs', files: { 'proof.mjs': `import * as users from './src/users.js';
// On base setEmail doesn't exist yet: nothing to be stale.
if (!users.setEmail) process.exit(0);
const { getUser, setEmail } = users;
const store = new Map([[1, { email: 'a@x' }]]);
getUser(store, 1);
setEmail(store, 1, 'b@x');
if (getUser(store, 1).email !== 'b@x') { console.error('read after setEmail is stale'); process.exit(1); }
` } },
};
