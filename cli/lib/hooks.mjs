// Hook entry points. Each reads the hook JSON on stdin and prints a hook
// response (or nothing). Rules, with reasons in docs/research/m0-spikes.md:
// - never return permissionDecision "allow": that would skip the user's prompts
// - never run repo-defined commands: checks.json is untrusted input
// - append short context, and don't repeat it
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { repoRoot, stateDir } from './git.mjs';
import { activePlans, doingSlice, sliceTouch, statusSummary } from './status.mjs';
import { loadChecks } from './checks.mjs';
import { lastEvidence } from './verify.mjs';

const off = (name) => {
  const v = (process.env.JIG_HOOKS_OFF ?? '').split(',').map((s) => s.trim());
  return v.includes('all') || v.includes(name);
};

function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj));
const sid = (input) => String(input.session_id ?? 'nosession').replace(/[^\w.-]/g, '_');

function rootOf(input) {
  const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  return repoRoot(cwd) ?? cwd;
}

function sessionState(root, input) {
  const dir = join(stateDir(root), 'sessions');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sid(input)}.json`);
  let data = { editedAt: 0, warned: [] };
  try { data = { ...data, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch {}
  return { data, save: () => writeFileSync(file, JSON.stringify(data)) };
}

// `a/b/` covers everything below a/b; `*` and `**` are simple wildcards.
export function pathMatches(rel, pattern) {
  if (pattern.endsWith('/')) return rel.startsWith(pattern);
  if (!/[*?]/.test(pattern)) return rel === pattern;
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + '$');
  return re.test(rel);
}

export const NUDGE = 'jig is installed: before changing code for an engineering task, use the jig:plan skill to plan it at the right size (a one-line fix is a four-line plan in chat; larger work gets a plan file with checks). Skip it for questions, explanations, reviews and debugging an unknown cause.';

export function sessionStart(input) {
  const root = rootOf(input);
  const parts = [];
  if (process.env.JIG_NUDGE !== 'off') parts.push(NUDGE);
  const status = statusSummary(root, { max: 2 });
  if (status.length) parts.push('Active jig plans (read the plan before continuing; use the jig:build skill to work the next slice):\n' + status.join('\n'));
  if (!parts.length) return null;
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') } };
}

export function preEdit(input) {
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file) return null;
  const root = rootOf(input);
  const rel = relative(root, isAbsolute(file) ? file : join(root, file));
  if (rel.startsWith('..')) return null;
  const st = sessionState(root, input);
  st.data.editedAt = Date.now();
  st.save();

  const plans = activePlans(root);
  if (!plans.length) return null;
  for (const { path } of plans) {
    const checks = loadChecks(path);
    for (const c of checks.data?.checks ?? []) {
      if ((c.protects ?? []).some((p) => pathMatches(rel, p))) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `jig: ${rel} is protected by check ${c.id} in ${relative(root, path)}. Acceptance tests come from the spec; edit one only when the spec changed, and log the decision in the plan.`,
          },
        };
      }
    }
  }
  if (rel.startsWith('docs/plans/')) return null;
  const doing = plans.map(({ path, plan }) => ({ path, slice: doingSlice(plan) })).find((x) => x.slice);
  if (!doing) return null;
  const touch = sliceTouch(doing.slice);
  if (!touch.length || touch.some((p) => pathMatches(rel, p))) return null;
  if (st.data.warned.includes(rel)) return null;
  st.data.warned.push(rel);
  st.save();
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `jig: ${rel} is outside ${doing.slice.id}'s Touch list (${touch.join(', ')}). If the slice needs it, add it to Touch with a Log line; otherwise leave it for its own slice.`,
    },
  };
}

const INSTALLERS = [
  { re: /\b(npm|pnpm|yarn|bun)\s+(?:i|install|add)\b(.*)/, eco: 'npm' },
  { re: /\b(?:pip3?|python3?\s+-m\s+pip|uv\s+pip)\s+install\b(.*)/, eco: 'pypi' },
  { re: /\b(?:uv|poetry)\s+add\b(.*)/, eco: 'pypi' },
  { re: /\bcargo\s+(?:add|install)\b(.*)/, eco: 'crates' },
  { re: /\bgo\s+(?:get|install)\b(.*)/, eco: 'go' },
  { re: /\bgem\s+install\b(.*)/, eco: 'rubygems' },
  { re: /\bcomposer\s+require\b(.*)/, eco: 'packagist' },
];

// Package names an install command would add. Lockfile installs (`npm ci`,
// bare `npm install`, `pip install -r req.txt`, `pip install -e .`) add none.
export function installedPackages(command) {
  const found = [];
  for (const seg of command.split(/&&|\|\||;|\|/)) {
    for (const { re, eco } of INSTALLERS) {
      const m = seg.match(re);
      if (!m) continue;
      const rest = m[m.length - 1] ?? '';
      const toks = rest.trim().split(/\s+/).filter(Boolean);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '--prefix', '--registry', '-i', '--index-url'].includes(t)) { i++; continue; }
        if (t.startsWith('-') || t === '.' || t.startsWith('./') || t.startsWith('/') || t.startsWith('$')) continue;
        found.push({ eco, name: t.replace(/^['"]|['"]$/g, '') });
      }
    }
  }
  return found;
}

export function preBash(input) {
  const cmd = input.tool_input?.command ?? '';
  const pkgs = installedPackages(cmd);
  if (!pkgs.length) return null;
  const names = pkgs.map((p) => `${p.name} (${p.eco})`).join(', ');
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `jig: this adds ${names}. A new dependency is a one-way door: check that the name is the real package (hallucinated names get registered by attackers), its age and downloads, and record it in the plan's Decisions.`,
    },
  };
}

export function stop(input) {
  if (input.stop_hook_active) return null;
  if ((input.background_tasks ?? []).length) return null;
  const root = rootOf(input);
  const st = sessionState(root, input);
  if (!st.data.editedAt) return null;
  const plans = activePlans(root).filter(({ plan }) => doingSlice(plan));
  if (!plans.length) return null;
  // Only when a checks.json exists; brief plans state checks as commands.
  if (!plans.some(({ path }) => loadChecks(path).exists)) return null;
  const ev = lastEvidence(root);
  if (!ev || ev.t < st.data.editedAt) {
    return { decision: 'block', reason: 'jig: files changed since the last `jig verify`. Run `jig verify --fast --record` for the slice in progress and report its result before finishing. If a check cannot run here, say which one and why.' };
  }
  const failed = (ev.results ?? []).filter((r) => !r.pass).map((r) => r.id);
  if (failed.length && !st.data.reportedFailure) {
    st.data.reportedFailure = ev.t;
    st.save();
    return { decision: 'block', reason: `jig: the last \`jig verify\` had failing checks (${failed.join(', ')}). Fix them, or tell the user plainly they are failing; don't describe the slice as done.` };
  }
  return null;
}

const HANDLERS = { 'session-start': sessionStart, 'pre-edit': preEdit, 'pre-bash': preBash, stop };

export function runHook(name) {
  const fn = HANDLERS[name];
  if (!fn) { console.error(`jig hook: unknown hook "${name}" (${Object.keys(HANDLERS).join(', ')})`); return 2; }
  if (off(name)) return 0;
  try {
    const out = fn(readStdin());
    if (out) emit(out);
  } catch (e) {
    // A broken hook must never block the user's work.
    process.stderr.write(`jig hook ${name}: ${e.message}\n`);
  }
  return 0;
}
