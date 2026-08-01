# Bug 0045: two tests fail by environment, and corrupt sabotage verdicts when they do

**Reported:** 2026-08-01 · **Found in:** v0.36.3, by two reviewers independently
**Severity:** Medium, and higher than its symptom suggests. Neither failure affects a user. Both
corrupt the **verdict mechanism** this project relies on to validate every guard it ships, which
is [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5's own corollary: _a sabotage run
that reads its own result through a fragile channel has the same defect as the guards it is
auditing._

## Two independent failures

**1. `tests/core/diagnose.test.ts:583` fails in a worktree.** Expects `'not-determined'`, gets
`'absent'`, when `node_modules` is a symlink — which is what `git worktree add` produces in this
repo's usual setup. A reviewer's first 12-row sabotage matrix scored **every row CAUGHT** because
of it; only an asserted-green baseline revealed the cause.

**2. `tests/core/warn-survives-the-test-runner.test.ts:212` flakes.** `ENOENT` on
`tests/__generated__/channel.mjs` — the shared directory disappears mid-run. Observed once in ten
full runs. The generated directory is shared across test files with no per-file isolation, so a
parallel file removing it races the reader.

## Why this is filed rather than shrugged at

Every fix this project ships is validated by a sabotage matrix whose verdicts are exit codes.
Both failures make the exit code non-zero for reasons unrelated to the patch under test, and the
failure mode is **silent and directional**: every row reads CAUGHT, which is the reassuring
answer. A matrix that cannot return MISSED tells you nothing and feels like it told you
everything.

This has now cost measurable review time twice in one session, and both times the only thing
that caught it was baselining green before patching — a discipline that is written down but not
enforced.

## Fix

1. Make the `diagnose` case environment-independent: resolve the real path before classifying,
   or assert on the classification's inputs rather than on the `'not-determined'` outcome, which
   is what actually varies.
2. Give `tests/__generated__` per-file isolation — a subdirectory keyed to the test file, or
   `mkdtemp` — so no two files share a lifecycle.

## Guard

The honest guard is process, not a test: **a sabotage matrix must record its asserted-green
baseline**, and a matrix whose baseline is non-zero is void. That is already the practice; it is
not written into the ADR. Consider adding it to rule 5's corollary list, where "read the exit
code" already lives — the missing half is "and prove the exit code means something before you
trust it".

For the two failures themselves: run each in a worktree with a symlinked `node_modules`, and run
the generated-channel test file concurrently with the rest of the suite ten times.

## Related

- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5, "the verdict mechanism is part of
  the derivation" — the corollary this bug is an instance of.
