# Bug 0045: two tests fail by environment, and corrupt sabotage verdicts when they do

**Reported:** 2026-08-01 · **Fixed:** 2026-08-01, unreleased
**Found in:** v0.36.3, by two reviewers independently
**Severity:** Medium, and higher than its symptom suggests. Neither failure affects a user. Both
corrupt the **verdict mechanism** this project relies on to validate every guard it ships, which
is [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 5's own corollary: _a sabotage run
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

- [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 5, "the verdict mechanism is part of
  the derivation" — the corollary this bug is an instance of.

## Fix as shipped

Filed as two flaky tests. **One of them turned out to be a shipped defect**, and the framing
had to widen twice: the second is a concurrency fault the suite cannot observe, and a third
cause appeared during the fix itself.

### 1. A symlinked pruned directory was not pruned — and this reaches users

`Dirent.isDirectory()` is **false** for a symlink under `withFileTypes`, which `disk-set.ts`
relies on to make symlink loops impossible. The prune check sat _inside_ that branch, so a
symlinked `node_modules` fell through and was recorded as a **file**. Nothing beneath it could
be classified `not-determined` ("this walk cannot say"); it classified `absent` ("no such
path") — and `absent` is the one that asserts something false, with different advice attached.

`PRUNE.has(entry.name)` now runs **before** `isDirectory()`. Safe: pruning records the path and
does not recurse, so no link is followed and the loop argument is untouched.

**Not a test-infra bug.** `pnpm` builds `node_modules` out of symlinks and `git worktree add`
leaves a symlinked one behind, so real users were getting the wrong diagnosis on the shipped
code path. It surfaced as a flaky test because that is where it was _noticed_.

Reproduced before fixing: a worktree with a symlinked `node_modules`, `diagnose.test.ts` → **1
failed, 38 passed**. Same worktree with the fixed file copied in → **39 passed**.

### 2. The generated directory was shared between processes

`tests/__generated__` was a fixed path, and `beforeAll` deleted **the whole directory**. Two
suites in one checkout — two agents, or a watch run beside a manual one — and each process's
setup destroyed the other's files mid-flight. Now `tests/__generated__/run-<pid>/`, with
teardown removing only its own and `rmdirSync` on the parent, which fails harmlessly while a
sibling still has one.

The generated probes also had `../../` paths encoding their old depth. Made absolute from
`repoRoot`, so the layout and the probe are no longer coupled — the first attempt at this fix
broke the child run into "no tests found", which reads as a library failure rather than a path
bug.

**Measured deterministically**, because three concurrent attempts never reproduced the ~1-in-10
flake by chance:

|          | mid-run action                                            | result                                           |
| -------- | --------------------------------------------------------- | ------------------------------------------------ |
| old code | delete the shared root (what a sibling's `beforeAll` did) | **exit 1**, the same `ENOENT` the flake reported |
| new code | delete a sibling's directory                              | **exit 0**, 7 passed                             |

### 3. The protocol, recorded in the ADR

The deeper fault is that a sabotage matrix assumes exclusive use of the working tree and nothing
enforced it. During this session **two agents sabotaged one checkout simultaneously**: each
reverted the other's file, each credited its own row, and it was noticed only because one row's
failure list named a test file its patch could not reach.

[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 5's verdict-mechanism corollary now
carries all three channel failures seen this session and the two requirements they imply: assert
a green baseline before the first patch, and **hold the tree exclusively**. A matrix without a
recorded green baseline is not a measurement, and neither is one run in a shared checkout.

## Sabotage — 4 rows, 3 caught, 1 green with a stated reason

| Revert                                                | Expected | Result                 |
| ----------------------------------------------------- | -------- | ---------------------- |
| Q1 — remove the prune-by-name check                   | red      | CAUGHT                 |
| Q2 — prune everything                                 | red      | CAUGHT                 |
| Q3 — go back to a shared generated directory          | red      | **GREEN**, then CAUGHT |
| Q4 — a genuinely absent path returns `not-determined` | red      | CAUGHT (the control)   |

**Q3 is the honest one.** The concurrency defect needs two processes and a suite run is one, so
it cannot be guarded behaviourally from inside the suite — reverting to the shared directory left
everything green. A **structural** pin now asserts the path contains the pid and that teardown
cannot remove a sibling's directory, which makes Q3 red. It is labelled a structural pin in the
test rather than dressed up as a behavioural guard: the behavioural proof is the table above,
taken by hand.

## Follow-up

None deferred. The `absent` vs `not-determined` distinction is now guarded in both directions
(`tests/core/the-walk-prunes-a-symlink.test.ts`), including the control that "return
not-determined for everything" fails — without which the fix would have destroyed the
distinction it exists to protect.
