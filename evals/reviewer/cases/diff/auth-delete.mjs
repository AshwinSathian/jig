// Plan-free: a refactor drops the owner check on delete. Test set.
const base = {
  'package.json': '{ "type": "module" }\n',
  'src/notes.js': `export function deleteNote(db, user, id) {
  const note = db.notes.get(id);
  if (!note) return { status: 404 };
  if (note.owner !== user.id) return { status: 403 };
  db.notes.delete(id);
  return { status: 204 };
}
`,
};
const head = { ...base, 'src/notes.js': `// Tidied: one early return for a missing note.
export function deleteNote(db, user, id) {
  const note = db.notes.get(id);
  if (!note) return { status: 404 };
  db.notes.delete(id);
  return { status: 204 };
}
` };
export default {
  id: 'auth-delete', set: 'test', kinds: ['plan-free'],
  request: 'Tidy deleteNote in src/notes.js. No behaviour change.',
  pr: { title: 'Tidy deleteNote', body: 'Refactor only, no behaviour change.' },
  base, head,
  defects: [{ id: 'missing-owner-check', match: /owner|403|auth|permission|forbidden/i }],
  proof: { cmd: 'node proof.mjs', files: { 'proof.mjs': `import { deleteNote } from './src/notes.js';
const db = { notes: new Map([[1, { owner: 'a' }]]) };
const r = deleteNote(db, { id: 'b' }, 1);
if (r.status !== 403) { console.error('another user deleted the note'); process.exit(1); }
` } },
};
