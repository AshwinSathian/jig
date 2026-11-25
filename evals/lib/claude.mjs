// Run `claude -p` in isolation and collect what the evals need. Arms differ
// only in the extra flags they pass. User skills, plugins and MCP servers are
// excluded so a baseline really has no planning skill (see m0-spikes.md).
import { spawn } from 'node:child_process';

export const ISOLATION = ['--setting-sources', 'project,local', '--strict-mcp-config'];

export function arms({ jigDir, superpowersDir }) {
  return {
    none: [],
    jig: ['--plugin-dir', jigDir],
    planmode: ['--permission-mode', 'plan'],
    superpowers: ['--plugin-dir', superpowersDir],
    'jig+superpowers': ['--plugin-dir', jigDir, '--plugin-dir', superpowersDir],
  };
}

// opts: { cwd, prompt, armFlags, model, budgetUsd, timeoutMs, stopOnSkill, extra, env }
export function runClaude({ cwd, prompt, armFlags = [], model, budgetUsd = 2, timeoutMs = 600_000, stopOnSkill = false, extra = [], env = null }) {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', ...ISOLATION, '--max-budget-usd', String(budgetUsd), ...armFlags, ...extra];
  if (model) args.push('--model', model);
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], ...(env ? { env } : {}) });
    const out = { skills: [], tools: [], result: null, killed: false, stderr: '' };
    let buf = '';
    const timer = setTimeout(() => { out.killed = 'timeout'; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content ?? []) {
            if (b.type !== 'tool_use') continue;
            out.tools.push({ name: b.name, input: b.input });
            if (b.name === 'Skill') {
              out.skills.push(b.input?.skill ?? b.input?.command ?? JSON.stringify(b.input));
              if (stopOnSkill) { out.killed = 'skill'; child.kill('SIGTERM'); }
            }
          }
        }
        if (ev.type === 'result') out.result = ev;
      }
    });
    child.stderr.on('data', (d) => { out.stderr += d; });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

// Cost and cache numbers from a result event, for the report.
export function usageOf(result) {
  if (!result) return null;
  const u = result.usage ?? {};
  return {
    costUsd: result.total_cost_usd ?? null,
    turns: result.num_turns ?? null,
    input: u.input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  };
}

export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const k = next++; results[k] = await fn(items[k], k); }
  }));
  return results;
}
