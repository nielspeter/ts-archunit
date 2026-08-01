# Plan 0077 — `doctor`: promote it

**Status:** DONE, 2026-07-31 — and **reversed during its own investigation**. Draft 1 recommended retiring
`doctor`. Four measurements refuted the premise it rested on; the reversal is left visible below
because the refuted argument is the one a future reader will reach for again.
**Priority:** High as a decision, Low as work. It settles the open question
[plan 0069](./0069-no-rule-may-certify-nothing.md) required be answered **before R3**,
and which has now been deferred across five sessions — 0069 named the mechanism exactly:
_"shipping it experimental/hidden is precisely the mechanism that defers the decision."_
**Effort:** ~2 hours. It is documentation and one `HELP_TEXT` entry.
**Breaking:** no.

## The question

> **`doctor`'s life after R3** — keep as a supported command, or retire it?

## Draft 1 said retire. Here is what refuted it

Draft 1's deciding fact was: _"it cannot load the shape the docs lead with"_ — a rule file that
imports vitest cannot be `import()`ed outside vitest, so `doctor` is blind to the primary
authoring shape.

**The first half is true and measured.** Running `doctor` against a vitest-importing rule file:

```
exit=1
Error: … could not be loaded (Cannot read properties of undefined (reading 'config')),
so none of it could be diagnosed. If this file imports a test runner (vitest/jest),
doctor cannot load it — run your test suite instead.
```

**The second half is false, and that is the whole argument.** `docs/getting-started.md:10`:

> _"That's it — no test runner required. (Already run vitest/jest and prefer your rules there?
> See Running Rules in Tests.) **This guide uses the CLI, the default path.**"_

`npx ts-archunit init` scaffolds `arch.rules.ts` — measured, **zero** vitest imports — plus `arch`
and `arch:baseline` scripts. So the documented default path produces exactly the shape `doctor`
loads, and `doctor` works on it: run earlier in this investigation against a rule file of that
shape, it reported the dead glob, named the site and exited 1.

Draft 1 read CLAUDE.md's _"rules run in vitest/jest"_ — which is the description of **this
repository's own** suite — as a statement about adopters. It is not. The user-facing default is
the CLI.

**Two further facts draft 1 missed, both pointing the same way:**

1. **`check` never calls `diagnose()`, so a dead glob is invisible to the gate.** Measured on a
   scratch rule whose selector glob matches nothing: `check` exits **0 with no output**, while
   `doctor` exits **1** and names `reside in folder matching "**/nonexistent-folder/**"
[selector]`. `grep diagnose src/cli/commands/check.ts src/core/execute-rule.ts
src/core/check-all.ts` finds only a comment. A rule that can never match certifies nothing and
   the gate calls it green — ADR-008 rule 1 — and until 0074's R3b turns that into a check-time
   failure, `doctor` and `diagnose()` are the only surfaces that see it.

   **A draft of this plan claimed the justification was load failures instead. That was false and
   review caught it**: `check tmp/unloadable.mjs` exits **1** with _"This rule file could not be
   evaluated, so its rules enforced nothing in this run"_ and a `Fix:` remedy. `doctor`'s
   load-failure machinery is real and its comment at `doctor.ts:55-60` is accurate about why it
   must not swallow one, but it is **not** unique to `doctor`, so it cannot be what earns the
   slot. The claim was written from reading the code and never run — which is the same failure
   mode as draft 1's.

2. **The present state is a documented holding pattern, not an accident.** `docs/cli.md:141-143`
   already says it is _"deliberately absent from `--help`: retiring a documented command later
   would be its own breaking change, and its future is undecided,"_ and points vitest users at
   `diagnose()`. Draft 1 called this _"neither hidden nor supported… the worst of both"_. That was
   unfair to a deliberate decision that is honestly labelled.

So the two authoring shapes each already have a working pre-flight — `doctor` for the CLI default,
`diagnose()` for the vitest path — and the docs already route between them. Nothing is broken. The
only thing outstanding is the **decision**, which is what 0069 asked for.

## Decision: promote it

Make `doctor` supported: list it in `HELP_TEXT`, replace the "future undecided" warning with its
**scope**, and keep everything else exactly as it is.

Scope, stated once and in the one place a reader looks:

> `doctor` diagnoses rule files the CLI can load — the `arch.rules.ts` shape `init` scaffolds. If
> your rules live in a vitest or jest test file, the CLI cannot import it; call `diagnose(rules)`
> in that suite instead, which reports the same findings.

Two things deliberately **not** changed:

- **It stays out of build pipelines.** 0069's reasoning holds: it is an explicitly-invoked
  diagnostic, not a gate, and `check` is the gate. Promotion is about discoverability, not role.
- **`diagnose()` stays public and stays the answer for vitest.** Promoting the command does not
  demote the function; they serve different hosts and the docs already say so.

## Phases

### Phase 1 — make it discoverable

Add `doctor` to `HELP_TEXT` in `src/cli/index.ts`, beside `check`, `baseline`, `explain` and
`init`, with a one-line description naming its scope.

**Files:** `src/cli/index.ts`.

### Phase 2 — restate the docs from "undecided" to "scoped"

`docs/cli.md:112` drops "(experimental)" from the heading; the warning block at `:141` becomes the
scope statement above, keeping the do-not-wire-into-a-pipeline guidance and the `diagnose()`
pointer.

**Files, counted rather than estimated.** Seven pages mention `doctor`, but only **two** carry the
word "experimental": `docs/cli.md` and `docs/api-reference.md`. The other five
(`custom-rules`, `upgrading`, `troubleshooting`, `violation-reporting`, `running-in-tests`) just
reference the command and need nothing. The `#diagnostics-experimental` anchor lived in exactly
**one** page — `docs/cli.md`, verified with `git grep -l diagnostics-experimental cb8b69f^`. Also
`README.md`'s CLI line, which omitted `doctor` entirely, and `CHANGELOG.md`.

### Phase 3 — unblock 0074's gate

This survives the reversal, and it is the part with real value. 0074's gate says it needs _"a real
project with ts-archunit rules in a **loadable** `arch.rules.ts` — not a vitest test file, because
`doctor` cannot load one."_ That constraint is real for `doctor` and **not** real for the
diagnosis: `diagnose()` runs wherever the rules are built. Restate the gate as _"run the
pre-flight — `doctor` for a CLI-shaped project, `diagnose()` for a test-hosted one — and classify
each finding against the registered decision rule."_

That is why this repository could never run its own gate: 43 rules inside `it()` callbacks, so
`doctor` cannot see them — but `diagnose()` can, once the rules are collected.

**Files:** `plans/0074-r3b-the-selector-glob-flip.md`.

## Test inventory

| test                                                  | asserts                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `doctor is listed in --help`                          | phase 1, the whole point of promotion                                         |
| `doctor still reports a dead glob and exits 1`        | promotion changed discoverability, not behaviour — the 14 existing tests stay |
| `a dead glob is reported here and silent under check` | the capability that justifies keeping the command at all                      |
| `doctor rejects a --format it does not support`       | a listed command's flag surface must be real; unvalidated while hidden        |
| `the docs no longer call it experimental`             | phase 2, `tests/docs/doctor-is-not-experimental.test.ts` — scans every page   |

## Guards

ADR-008's question: **what would these tests do if `doctor` were quietly reduced to a pass-through
that reports nothing?** Rows 1 and 4 still pass — `--help` listing and flag validation are not
findings. So row 3 is load-bearing, and it must assert both halves of the contrast: the rule
produces **no violations** (so a `check` run is silent) and `diagnose()` reports **`dead-glob`**.
Asserting only the second half would pass against a `check` that had learned to call `diagnose()`
itself, which is exactly the world where this command stops earning its slot.

The half that was shipped first here was `expect(diagnose([])).toEqual([])` — true for every
implementation, ∀ over ∅, and caught by review. A contrast test whose contrast side is vacuous is
one assertion, not two.

## Sabotage matrix

Six reverts, enumerated from `git diff` rather than from memory, baseline asserted green first,
exit codes only, tree git-verified after each. **6 of 6 caught.**

| revert                                                  | caught by                                         |
| ------------------------------------------------------- | ------------------------------------------------- |
| the `doctor` line removed from `HELP_TEXT`              | `run.test.ts` — is listed in `--help`             |
| the `doctor` branch removed from the dispatch guard     | `run.test.ts` — rejects an unsupported `--format` |
| `FORMATS.doctor` widened to accept `github`             | same                                              |
| `diagnose()` stops emitting `dead-glob`                 | `doctor.test.ts` — the dead-glob contrast         |
| "experimental" re-added beside `doctor` in `cli.md`     | `doctor-is-not-experimental.test.ts`              |
| the retired `#diagnostics-experimental` anchor relinked | same                                              |

**The last two reported MISSED on the first run and were not.** Their sabotage strings were
`'### doctor'`, but the heading is ``### `doctor` — Report Rules That Enforce Nothing``, so
`str.replace` found nothing and wrote the file back unchanged — a sabotage that did not sabotage,
scoring the guard as absent. Rows 1-4 asserted their anchor matched and rows 5-6 did not. A no-op
revert reads exactly like an unguarded one, and the reading it produces is the flattering
direction: it sends you to write a guard that already exists. **Assert the anchor, or the row is
not evidence.**

Not covered by any guard, stated rather than implied: the `docs/api-reference.md` prose that told
the reader to run `doctor` in CI while `cli.md` said not to. It is corrected, and nothing would
catch its return.

## Result

Implemented. `doctor` is in `--help` with its scope stated; `docs/cli.md` and
`docs/api-reference.md` drop "experimental" for a scope note and a not-a-build-gate note; the
`#diagnostics-experimental` anchor was repointed in the one page that carried it. `README.md`'s
CLI line now lists the command, and `doctor --format` is validated — it accepted anything while
hidden, so `--format github` ran silently as terminal.

One guard changed hands rather than being added. `tests/cli/run.test.ts` asserted `doctor` is
**absent** from `--help` "because it is experimental" — the guard for the decision this plan
reverses — and it is now inverted, with the reasoning in the test so the next reader sees why it
flipped. `tests/cli/doctor.test.ts` gained the dead-glob **contrast** that justifies keeping the
command: a rule whose selector can never match reports zero violations, so `check` is silent,
while `diagnose()` returns `dead-glob`. Without that pair the promotion rests on prose.

**Review then reversed a second claim inside this plan.** Its own justification section had
asserted that load failures are what only `doctor` catches. Running the case showed `check` catches
them too, with a remedy. The correction is above, and it cost a rewrite of the plan, the dispatch
comment, `docs/cli.md`, `docs/api-reference.md` (which told the reader to run `doctor` in CI while
`cli.md` said not to) and the test. Two drafts of one plan, both wrong from reading rather than
running — that is the pattern worth carrying forward, not the conclusion.

Phase 3 corrected a false claim in 0074 as well as restating its gate: the old text said "neither
`doctor` nor `diagnose()` can reach them" of this repository's 43 rules. `diagnose()` can — the
rules are simply never returned from their `it()` callbacks, which is a test-authoring problem,
not a tool limitation. The gate no longer waits on finding a differently-shaped project.

## Out of scope

- **Making `doctor` load vitest files.** Not possible; the docs route those users to `diagnose()`.
- **Making `doctor` a build gate.** 0069 decided against it and nothing here reopens that.
- **Whether R3b ships.** This unblocks the decision, not the flip.

## Postscript: why draft 1 went wrong

It reasoned from an error message and a sentence in CLAUDE.md without running the command or
reading `getting-started.md`. Both checks took two minutes and both pointed the other way. The
error message was real evidence about a real limitation, and the mistake was inferring the
**population** it affects from one internal sentence rather than from what `init` produces.
