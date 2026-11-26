# jig's state files

jig keeps what it has checked in `.git/jig/` (or `.jig-state/` outside git), so it's never committed. This page describes each file closely enough for CI or another tool to read it without importing jig.

Rules that hold for every file:
- JSONL files are append-only, one JSON object per line, oldest first. Skip a line that doesn't parse, as jig does.
- Every record jig 2.4 and later writes has `"v": 1`. A record without `v` was written by an earlier jig. Treat a `v` you don't know as unreadable rather than guessing.
- Times (`t`) are milliseconds since the Unix epoch.
- A `tree` is jig's fingerprint of the working tree: a sha256 (40 hex characters kept) over every tracked and untracked, non-ignored file's path, type and bytes, leaving out the plan files themselves. It isn't a git tree id, and nothing outside jig computes it. A record is valid only for the tree it names: compare its `tree` with the one `jig review --json` prints for the current state.

## evidence.jsonl

One line per `jig verify` run.

| Field | Meaning |
|---|---|
| `v` | Schema version, `1` |
| `t` | When the checks finished |
| `plan` | The plan path, relative to the repo root |
| `slice` | The slice verified, or `null` for a run by check id |
| `fast` | `true` when run with `--fast` |
| `logged` | `true` when the run wrote a Log line (`--record`) |
| `head` | Full SHA of HEAD |
| `tree` | The working-tree fingerprint, taken after the checks ran, or `null` outside git |
| `checks` | The checks.json snapshot: per check id, `f` holds a 12-character hash of each frozen field (`cmd`, `expect`, `kind`, `timeout_s`, `fast`, `slice`), and `protects` lists its protected paths |
| `results` | One entry per check run: `id`, `pass`, `exit`, `ms`, and `why` (up to 200 characters) when it failed |

## reviews.jsonl

Written by `jig review --record <findings.json>` and `jig review --outcome <id> <outcome>`. The findings JSON carries `base`, `head` and `tree` copied from `jig review --json`, plus `verdict`, `findings` and optionally `dropped`. jig refuses it if the working tree has changed since that brief. The two kinds of line share the file. An outcome line has `kind`, and a review line has none.

A review line:

| Field | Meaning |
|---|---|
| `v` | Schema version, `1` |
| `t` | When it was recorded |
| `id` | 8 hex characters, unique to this review |
| `head` | Full SHA of the commit reviewed |
| `base` | Full SHA the diff was taken from |
| `tree` | The working-tree fingerprint at record time, or `null` when the reviewed commit (a PR head) wasn't checked out |
| `verdict` | `ready`, `fix first` or `rethink` |
| `findings` | The findings, possibly empty (see below) |
| `dropped` | How many Important findings the validator dropped, when the review counted them |

Each finding:

| Field | Meaning |
|---|---|
| `id` | The first 8 hex characters of sha256 over `class`, NUL, `file`, NUL, and `title` lower-cased with runs of whitespace collapsed to one space and trimmed. The same finding gets the same id in a later review, wherever its line moves, and a reworded title gets a new one. Two findings in one review can't share an id |
| `severity` | `Important`, `Nit` or `Pre-existing` |
| `confidence` | `Confirmed`, `Likely` or `Needs verification`. Required on Important findings |
| `file` | Path relative to the repo root |
| `line` | Line number, or `null` |
| `class` | A short kebab-case name for the kind of defect, such as `swallowed-error` |
| `title` | One line saying what's wrong |

An outcome line:

| Field | Meaning |
|---|---|
| `v` | Schema version, `1` |
| `t` | When it was recorded |
| `kind` | `outcome` |
| `finding` | The finding's `id` |
| `outcome` | `fixed`, `wrong`, `intentional`, `didnt-matter` or `missed` |

The latest outcome for a finding id is the current one.

A `missed` line is about a review, not a finding. It is written by `jig review --outcome <review id> missed --file <path> --note "<what>"`, and it has `review` (the review record's `id`), `file` (where the defect was) and `note` (what the review should have caught) in place of `finding`. `jig review --propose` reads outcome lines and git history and never writes REVIEW.md. It proposes `- Suppress: <class> · Source: <review ids>` entries for style and upkeep classes, and `- When: · Check: · Source:` candidates from misses, reverts and `fix:` commits after a `ready` review. The reviewer reads Suppress entries from REVIEW.md at the plan's Baseline, or the merge-base.

## observe.jsonl

One line per ask or block that a gate in observe mode logged instead of raising (`JIG_GATES=observe` or `observe:<gate>,...`).

| Field | Meaning |
|---|---|
| `v` | Schema version, `1` |
| `t` | When the hook ran |
| `hook` | `pre-edit`, `pre-bash` or `stop` |
| `gate` | `protects`, `freeze`, `install`, `tree`, `rounds`, `rules` or `commit` |
| `session` | The Claude Code session id, with characters other than letters, digits, `.`, `_` and `-` replaced by `_` |
| `decision` | `ask` or `block`: what the gate would have done |
| `reason` | The text the gate would have shown |
| `file` | For an edit, the path relative to the repo root |
| `command` | For a Bash call, its first 200 characters |

## sessions/

One JSON file per Claude Code session, `sessions/<session id>.json`, rewritten in place. It's working state for the hooks, so it has no `v`.

| Field | Meaning |
|---|---|
| `editedAt` | When the edit hook last saw an Edit or Write, `0` if never |
| `warned` | Paths that already got the out-of-scope warning this session |
| `startTree` | The working-tree fingerprint when the session first touched an active plan |
| `blockedRecords` | `t` values of evidence records the Stop hook has already blocked on (the last 50) |
| `transcript` | The session's transcript path, from the hook input's `transcript_path` |

`transcript` is only a path. jig never copies the transcript. A review that reads it does so locally, quotes only the lines a finding needs, and never copies a secret it finds there.
