# Proposal 026 — Sabotage Is a Command, Not a Ritual

**Status:** Proposed.
**Priority:** High — sabotage is the only method in this repo that has ever found a guard that cannot
fail, and it is performed by hand, differently each time, with no check that the sabotage itself
worked. Two false verdicts have already been recorded and retracted.
**Affects:** a new `scripts/sabotage.mjs` and `tests/sabotage/*.ts` spec files. No `src/` change, no
published surface — internal tooling for the ts-archunit project, not a framework primitive.
**Blast radius:** an internal check over a corpus we control (ADR-008 rule 6) — prove each detector
fires once, then stop. Each of the four checks carries a positive and a negative case in Acceptance.
**Related:** [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5 (the question sabotage
answers) and rule 6 (the blast radius this sits in), [bug 0045](../bugs/fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md)
(why this cannot be vitest tests), [bug 0077](../bugs/0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md)
(the class of defect only sabotage found).
**Evidence:** the 2026-08-09 dogfooding session, where seven sabotages were run by hand against
`tests/archunit/dogfood.test.ts`. Every defect found that session was found by sabotage; **none** was
found by reading. Two of the seven mis-executed in ways that would have produced a wrong verdict if
the operator had not been watching for it.

> **The method works and its execution does not.** ADR-008 rule 5 asks what a guard would do if the
> thing it guards were broken. The only honest way to answer is to break it and look — and today that
> means hand-written `cp`/`perl`/`git checkout` sequences, retyped per investigation, whose own
> failure modes are indistinguishable from the answer.

## Problem

### 1. A sabotage that does not apply reports the guard as CAUGHT

Measured twice in one session:

- A `perl -0pi -e` substitution failed with `Substitution replacement not terminated`. The target file
  was unchanged; the test passed; without an explicit "did the patch apply?" check that reads as
  **the guard caught nothing**, or worse, as a clean baseline.
- A revert check reported `REVERT FAILED` on a file that was never modified, because the pattern being
  grepped for had never existed in it. The operator had to re-derive the state from `git status` to
  learn nothing was wrong.

Earlier in the same programme a sabotage was recorded as **CAUGHT** when `tsc` had exited non-zero
because the patch did not compile. The guard never ran. That verdict was published in a plan and later
retracted.

### 2. The sabotage matrices in `bugs/` are prose, not artifacts

Bug files carry sabotage matrices as evidence — this is a good convention and it is why the bug reports
are trustworthy. But the matrix is a table someone typed. Nothing re-runs it, so a matrix stops being
true the moment the code moves, and a reader cannot distinguish "verified last week" from "verified at
some point, by someone, somehow".

### 3. It cannot be solved with vitest, and this repo has the scar

The obvious fix — write sabotages as tests that mutate and restore in `try/finally` — is unavailable.
Vitest runs test files in parallel, so a test mutating `src/` corrupts every sibling file's run. That
is [bug 0045](../bugs/fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md),
_"two tests fail by environment and corrupt sabotage verdicts"_, and `vitest.config.ts` still carries a
pid-liveness pruner because of it. A killed run leaves gitignored, deliberately-failing probe files
behind, and the next run reds for a reason nothing in the working tree shows.

So the runner must be **serial**, **outside vitest**, and must not touch the shared tree.

## The honesty line — measured vs estimated

**Measured:** the three mis-executions above; that vitest parallelism corrupts shared-tree mutation
(bug 0045, already fixed and documented); that seven sabotages were needed for one test file.

**Estimated:** the ~40-line size of the runner, and that worktree setup costs 200–500ms per run. The
latter is taken from the Agent tool's own documented figure for `isolation: 'worktree'`, not measured
here.

## Design

A CLI, serial, operating in a throwaway `git worktree` so the shared tree is never mutated:

```
npm run sabotage -- tests/sabotage/dogfood.ts
```

This is **internal tooling for the ts-archunit project**, not a published framework primitive. It lives
in `scripts/` and `tests/sabotage/` and adds nothing to `src/` or the public API. Exposing it as a user
command (`ts-archunit sabotage`) is a separate decision with its own blast radius (published API,
ADR-006's separate-package rule); this proposal does not make it.

Specs are typed TS beside the tests they attack, not prose parsed out of markdown — for the reason the
ADR-008 Context table documents eight times: hand-maintained matrices in `bugs/*.md` stop being true
the moment the code moves, and parsing fenced blocks out of markdown is that shape. A link from the bug
file to the spec keeps claim and proof associated without prose parsing.

```ts
export const SABOTAGES: Sabotage[] = [
  {
    name: 'crossLayer catches a test that stops importing its builder',
    file: 'tests/builders/type-rule-builder.test.ts',
    find: '../../src/builders/type-rule-builder.js',
    replace: '../../src/index.js',
    // The stable `identity` field on the ArchViolation the guard is expected to
    // raise — not a vitest test title (brittle to renames) and not an exit code
    // (indistinguishable from "no test matched"). The runner reads structured
    // vitest --reporter=json output and asserts this identity is among the failures.
    expectRed: 'cross-layer::missing-counterpart',
  },
]
```

The runner enforces the four things a human does inconsistently:

1. **Applied** — `find` occurred, and occurred exactly once. A `find` matching zero places is the
   silent-no-op above; matching several is a patch whose blast radius the author did not intend.
2. **Compiles** — `tsc --noEmit` on the patched worktree. A non-parsing patch exits non-zero for the
   compiler, and a runner that only reads exit codes scores that as CAUGHT.
3. **Red, and for the right reason** — the named finding identity is among the failures in vitest's
   structured JSON output (`--reporter=json`). **Not** an exit code: `vitest -t "..."` exits 1 both when
   the named test fails an assertion AND when no test matches the filter — ADR-008 rule 5's "unquoted
   `$SUITE`" scar, where a nonexistent filter scored every MISSED as CAUGHT. The runner rejects a RED
   verdict when zero tests matched the filter (`numTotalTests > 0` for the filtered subset), and asserts
   the failure is the expected identity, not a collection error.
4. **Reverted** — by worktree disposal, verified with a tree hash rather than a grep. Grep asks "is
   the string back", which is what produced the false `REVERT FAILED`.

The runner's own preconditions get the same four-check discipline, not just the sabotage verdict. This
follows `scripts/regen-frozen-baseline.sh`'s precedent: `git worktree add` failure (dirty state,
branch in use, ENOSPC) aborts before any patch is applied — every `execFileSync` is checked, the
equivalent of `set -euo pipefail`, with a `trap cleanup EXIT` so a failure or interrupt disposes the
worktree. `tsc` absent from PATH fails the run with a named cause ("tsc not found; run npm install"),
never scored as "patch did not compile". An empty `SABOTAGES` array, or a spec file that exports
nothing, fails the run rather than passing 0/0 CAUGHT — the runner's own vacuity guard, the same shape
as the floor's `0 === 0` refusal. The runner is ADR-005-clean plain JS, same as
`scripts/verify-package.mjs`: JSDoc-typed structs for `Sabotage`, no `any`/`as`-shaped casts.

Output is a matrix in the shape the bug files already use, so it can be pasted back as evidence with a
commit sha attached.

## Why it fits

- It makes ADR-008 rule 5 **executable** instead of aspirational. Today the rule is a question a
  careful reader remembers to ask; after this it is a command whose output is a table.
- It is the cheapest available answer to bug 0077A. Falsifiability cannot be typed, but "break it and
  confirm it reds" is exactly falsifiability, mechanised for the cases someone bothers to write down.
- Worktree isolation is already the pattern used by this repo's review agents, and it removes the one
  genuinely dangerous property of hand-run sabotage: an interrupted run leaving `src/` modified.

## Non-goals / risks

- **Not a CI gate.** It mutates, it is slow, and a flaky sabotage would be disabled within a week.
  On-demand only for v1. A scheduled reporting run (drift in the recorded matrices) adds a second
  delivery channel — cron, notification, its own failure modes — and is scope creep for a first
  version; deferred to a separate proposal if wanted.
- **Not a coverage metric.** The number of sabotages is not a score; a spec file with fifty trivial
  entries is worse than one with three that matter. This is the mistake made with a coverage count in
  the session that motivated this proposal.
- **The specs can rot.** A `find` string that no longer occurs must be an error, not a skip — that is
  requirement 1, and it is the single most important line in the runner.

## Acceptance

ADR-008 rule 6's row for this work is "an internal check over a corpus we control": prove each detector
fires once, then stop. Each of the four checks gets a positive case (it CAUGHTs a real sabotage) **and**
a negative case (it fails rather than scoring a wrong verdict).

- Running the runner against `tests/archunit/dogfood.test.ts`'s six sabotages reproduces the six
  CAUGHT verdicts recorded in PR #50, from a clean checkout, with no hand steps.
- **Applied:** a spec whose `find` string is absent **fails** the run and names the spec. A spec whose
  `find` matches two places **fails** the run (blast radius the author did not intend).
- **Compiles:** a spec whose patch does not compile **fails** the run and is not reported as CAUGHT.
  `tsc` absent from PATH **fails** the run with a named cause, not scored as "did not compile".
- **Red, for the right reason:** a spec whose `expectRed` names a finding identity that is **not**
  among the failures (e.g. a nonexistent test, or a test that fails for a different reason) **fails**
  the run. A spec where the patch makes vitest fail to **collect** (not assert) — zero tests matched
  the filter — **fails** the run and is not reported as CAUGHT. This is the row that pins the
  RED-vs-not-found distinction, and it is the row that would have caught the "unquoted `$SUITE`" scar.
- **Reverted:** killing the runner mid-sabotage leaves `git status` clean in the shared tree, verified
  by tree hash. A spec whose worktree is not reverted (disposal fails) **fails** the run.
- **Vacuity:** an empty `SABOTAGES` array or a spec exporting nothing **fails** the run rather than
  passing 0/0 CAUGHT.

## Open questions for review

1. ~~Spec location: typed files vs parsing `bugs/*.md` fences?~~ **Closed.** Typed files in
   `tests/sabotage/`, with a link from the bug file. Parsing markdown is the hand-maintained-artifact
   shape ADR-008's Context table documents failing; a link keeps claim and proof associated without it.
2. ~~Should `expectRed` name a test or a finding identity?~~ **Closed.** A finding identity — the
   stable `identity` field on `ArchViolation`, already used for dedup. A test title is brittle to
   renames and indistinguishable from "no test matched" via exit code; a finding identity needs the
   structured-output read the runner already requires for check 3.
3. ~~Is one scheduled run worth it?~~ **Deferred.** On-demand carries v1; a scheduled reporting run is
   a separate proposal.
