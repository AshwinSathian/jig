// Parse a jig PLAN.md into a plain object. No dependencies.

export const STATUSES = ['draft', 'approved', 'building', 'shipped', 'abandoned'];
export const TIERS = ['brief', 'full', 'program'];
export const SLICE_STATES = ['todo', 'doing', 'done', 'dropped'];
export const SECTIONS = ['Outcome', 'Decisions', 'Out of scope', 'Questions', 'Assumptions', 'Slices', 'Log'];

const SLICE_RE = /^###\s+(S\d+):\s*(.*?)\s*(?:\[([a-z]+)\])?\s*$/;

export function parsePlan(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const plan = { lines, title: null, header: null, headerLine: -1, now: null, nowLine: -1, sections: [], slices: [] };

  const titleIdx = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (titleIdx !== -1) plan.title = lines[titleIdx].replace(/^#\s+/, '').trim();

  for (let i = 0; i < Math.min(lines.length, (titleIdx === -1 ? 0 : titleIdx) + 6); i++) {
    if (plan.headerLine === -1 && /^Status:/.test(lines[i])) {
      plan.headerLine = i;
      plan.header = {};
      for (const part of lines[i].split(/\s+·\s+/)) {
        const m = part.match(/^([A-Za-z]+):\s*(.*)$/);
        if (m) plan.header[m[1].toLowerCase()] = m[2].trim();
      }
    }
    if (plan.nowLine === -1 && /^Now:/.test(lines[i])) {
      plan.nowLine = i;
      plan.now = lines[i].replace(/^Now:\s*/, '').trim();
    }
  }

  lines.forEach((l, i) => {
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (m && !l.startsWith('###')) plan.sections.push({ name: m[1], start: i });
  });
  plan.sections.forEach((s, k) => {
    s.end = k + 1 < plan.sections.length ? plan.sections[k + 1].start : lines.length;
    s.body = lines.slice(s.start + 1, s.end);
  });

  const slicesSec = section(plan, 'Slices');
  if (slicesSec) {
    let cur = null;
    for (let i = slicesSec.start + 1; i < slicesSec.end; i++) {
      const l = lines[i];
      if (l.startsWith('###')) {
        const m = l.match(SLICE_RE);
        cur = { line: i, raw: l, id: m?.[1] ?? null, title: m?.[2] ?? '', state: m?.[3] ?? null, fields: {}, risks: [] };
        plan.slices.push(cur);
        continue;
      }
      if (!cur) continue;
      const f = l.match(/^(Goal|Touch|Checks|Plan):\s*(.*)$/);
      if (f) cur.fields[f[1].toLowerCase()] = { value: f[2].trim(), line: i };
      const r = l.match(/^\s*-\s*Risk:\s*(.*)$/);
      if (r) cur.risks.push({ text: r[1], line: i });
    }
  }
  return plan;
}

export function section(plan, name) {
  return plan.sections.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
}

// Lines from the title to just before "## Slices": the part the owner approves.
export function humanLayer(plan) {
  const s = section(plan, 'Slices');
  return plan.lines.slice(0, s ? s.start : plan.lines.length);
}

// Paths in backticks, e.g. `src/a.ts (new)` or `src/a.ts` (new).
export function touchPaths(value) {
  const out = [];
  const re = /`([^`]+)`(\s*\(new\))?/g;
  let m;
  while ((m = re.exec(value))) {
    let p = m[1].trim();
    let isNew = Boolean(m[2]);
    const inner = p.match(/^(.*?)\s*\(new\)$/);
    if (inner) { p = inner[1]; isNew = true; }
    out.push({ path: p, isNew });
  }
  return out;
}

export function checkIds(value) {
  const stripped = value.replace(/`[^`]*`/g, '');
  return stripped.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^[A-Za-z][\w.-]*$/.test(s));
}

export function logEntries(plan) {
  const s = section(plan, 'Log');
  if (!s) return [];
  return s.body.filter((l) => /^\s*-\s/.test(l)).map((l) => l.trim());
}
