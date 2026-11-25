#!/usr/bin/env node
// jig: plan, verify and guard agent-built work. No dependencies; Node 20+.
import { relative, join, isAbsolute } from 'node:path';
import { statSync, readdirSync, existsSync } from 'node:fs';
import { lintFile } from './lib/lint.mjs';
import { newPlan } from './lib/scaffold.mjs';
import { statusSummary, findPlans, activePlans, doingSlice, plansDir } from './lib/status.mjs';
import { verifyPlan } from './lib/verify.mjs';
import { repoRoot } from './lib/git.mjs';

const VERSION = '2.0.0';
const HELP = `jig ${VERSION}

Usage:
  jig new <slug> [--tier brief|full|program] [--title "..."] [--dir <plans dir>]
  jig lint [PLAN.md|dir ...] [--json] [--no-paths]
                                         Check plans against the format (default: every plan in docs/plans);
                                         --no-paths skips Touch path checks for plans linted outside their repo
  jig status                             Active plans, their Now line and the current slice
  jig verify [--plan P] [--slice S1] [--fast] [--check C1,C2] [--record]
                                         Run checks from checks.json; --record appends the result to the Log
  jig doctor [--json] [--ack]            Report harness gaps in this repo (changes nothing in the repo);
                                         --ack records that you've read the repo's agent config
  jig hook <session-start|pre-edit|pre-bash|stop>   Hook entry points (read JSON on stdin)

Exit codes: 0 ok, 1 problems found or checks failed, 2 usage error.`;

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

// A directory argument means every PLAN.md below it (bounded depth, no node_modules).
function expand(p, depth = 0) {
  if (!existsSync(p) || !statSync(p).isDirectory()) return [p];
  if (depth > 4) return [];
  return readdirSync(p).flatMap((n) => (n === 'node_modules' || n.startsWith('.') ? [] : n === 'PLAN.md' ? [join(p, n)] : statSync(join(p, n)).isDirectory() ? expand(join(p, n), depth + 1) : []));
}

const BOOL = new Set(['json', 'fast', 'record', 'help', 'no-paths', 'ack']);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  // boolean flags must not swallow the next positional
  const { pos, flags } = parseArgs(rest.flatMap((a) => (BOOL.has(a.replace(/^--/, '')) && a.startsWith('--') ? [a + '=true'] : [a])));
  const cwd = process.cwd();
  const root = repoRoot(cwd) ?? cwd;

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    case '--version':
      console.log(VERSION);
      return 0;

    case 'new': {
      if (!pos[0]) { console.error('jig new: give a slug, e.g. jig new csv-export'); return 2; }
      try {
        const files = newPlan(root, pos[0], { tier: flags.tier ?? 'brief', title: flags.title, dir: flags.dir ?? plansDir(root) });
        for (const f of files) console.log(`wrote ${relative(cwd, f)}`);
        return 0;
      } catch (e) { console.error(`jig new: ${e.message}`); return 2; }
    }

    case 'lint': {
      const targets = pos.length ? pos.flatMap((p) => expand(isAbsolute(p) ? p : join(cwd, p))) : findPlans(root);
      if (!targets.length) { console.error(`jig lint: no plans found under ${plansDir(root)}/`); return 2; }
      const reports = targets.map((t) => lintFile(t, { cwd, paths: flags['no-paths'] !== 'true' }));
      if (flags.json === 'true' || flags.json === true) { console.log(JSON.stringify(reports, null, 2)); }
      else {
        for (const r of reports) {
          const rel = relative(cwd, isAbsolute(r.path) ? r.path : join(cwd, r.path));
          if (!r.problems.length) { console.log(`${rel}: ok`); continue; }
          for (const p of r.problems) console.log(`${rel}:${p.line}: ${p.level} ${p.rule} ${p.msg}`);
        }
      }
      return reports.some((r) => r.problems.some((p) => p.level === 'error')) ? 1 : 0;
    }

    case 'status': {
      const lines = statusSummary(root, { max: 10 });
      console.log(`Plans live in ${plansDir(root)}/ (set "plansDir" in .jig.json to change).`);
      console.log(lines.length ? lines.join('\n') : 'No approved or in-progress plans.');
      return 0;
    }

    case 'verify': {
      let planPath = flags.plan ? (isAbsolute(flags.plan) ? flags.plan : join(cwd, flags.plan)) : null;
      if (!planPath) {
        const active = activePlans(root);
        if (active.length !== 1) { console.error(`jig verify: ${active.length} active plans; pass --plan <path>`); return 2; }
        planPath = active[0].path;
      }
      let slice = flags.slice ?? null;
      if (!slice && !flags.check) {
        const s = doingSlice((await import('./lib/status.mjs')).readPlan(planPath));
        slice = s?.id ?? null;
      }
      const res = verifyPlan(root, planPath, { slice, fast: flags.fast === 'true', record: flags.record === 'true', ids: flags.check ? String(flags.check).split(',') : null });
      if (res.error) { console.error(`jig verify: ${res.error}`); return 2; }
      if (!res.results.length) { console.log('jig verify: no checks matched'); return 0; }
      for (const r of res.results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} (${(r.ms / 1000).toFixed(1)}s) ${r.cmd}${r.pass ? '' : `\n     ${r.why}`}`);
      const failed = res.results.filter((r) => !r.pass).length;
      console.log(`${res.results.length - failed}/${res.results.length} passed${flags.record === 'true' ? ' · recorded in the plan Log' : ''}`);
      return failed ? 1 : 0;
    }

    case 'doctor': {
      const { doctor } = await import('./lib/doctor.mjs');
      return doctor(root, { json: flags.json === 'true', ack: flags.ack === 'true' });
    }

    case 'hook': {
      const { runHook } = await import('./lib/hooks.mjs');
      return runHook(pos[0]);
    }

    default:
      console.error(`jig: unknown command "${cmd}"\n\n${HELP}`);
      return 2;
  }
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(`jig: ${e.stack ?? e}`); process.exitCode = 2; });
