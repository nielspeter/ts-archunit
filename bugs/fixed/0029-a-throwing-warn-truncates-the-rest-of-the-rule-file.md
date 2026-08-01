# Bug 0029: a throwing `.warn()` truncates the rest of the rule file, silently

**Reported:** 2026-07-30
**Fixed:** 2026-07-30, released in **v0.29.0**
**Found in:** v0.20.0 (R3a's warn-throw) through v0.26.0
**Status:** **FIXED** — the CLI now reports the truncation, and each finding is reported once. Guarded by `tests/cli/rule-file-truncation.test.ts` against **real** rule files on disk, with the `export default [...]` control as the discriminator. Six reverts, all caught.
**Severity:** High — silent coverage loss, shipped by the release whose thesis is that silent
coverage loss is the defect. Every rule after the throwing one is never registered, its violations
never reported, and the run is **red for a different reason** — so nobody investigates. The
enforcement surface says "1 finding" while four real violations went unreported.

## Description

Plan 0069's R3a made `.warn()` throw for a **configuration finding** — correct, and deliberate: a
finding that reports the rule enforces nothing must not be silenceable. But in a **self-executing
rule file** — the shape `init` scaffolds and `docs/cli.md` documents — a throw at module scope
aborts evaluation of the module. Every statement after it never runs, so those rules are never
registered.

The CLI then catches the throw, folds the thrown finding into the run
(`src/cli/commands/check.ts`, via `failureOrViolations`), and reports normally. Output looks
entirely ordinary. Nothing says the file stopped early.

**Plan 0069 predicted this and specified the remedy**: _"R3a states the semantics, and the CLI
**reports the truncation rather than absorbing it**."_ The semantics were stated; the reporting was
never built.

## Reproduction

Measured at v0.26.0 with the built CLI. Two rules in one file; the first produces a shipped
configuration finding (`.expectNonEmpty()` on a dead selector) and calls `.warn()`:

```ts
// arch.rules.ts
modules(p)
  .that()
  .resideInFolder('**/no-such-folder-xyz/**')
  .expectNonEmpty()
  .should()
  .notHaveDefaultExport()
  .warn()

// FOUR real violations. Never registered.
functions(p)
  .that()
  .haveNameMatching(/^parse/)
  .should()
  .notExist()
  .check()
```

```
$ ts-archunit check arch.rules.ts
Architecture Violation [1 of 1]
  Selector matched 0 subjects, but .expectNonEmpty() requires at least one …
Architecture Violation [1 of 1]        <- printed twice; see below
  Selector matched 0 subjects, but .expectNonEmpty() requires at least one …
exit 1

parseFooOrder mentions: 0        <- the four violations are GONE
--format json: {"total": 1, "errors": 1}   and no parse* element
```

**Control, isolating the cause** — same two rules, `.violations()` (non-throwing) in place of
`.warn()`:

```
parseFooOrder mentions: 4        <- all four reported
```

So the loss is caused by the throw, not by the dead glob or the rule order.

## Why it is worse than a crash

1. **The run is red for the wrong reason.** Exit 1, one finding, a plausible remedy. A reader fixes
   the glob and moves on; the four violations surface later "out of nowhere", or not at all if
   somebody takes the sanctioned remedy for a dead glob — _delete the rule_ — and never learns the
   rest of the file was being skipped.
2. **The loss is ordering-dependent and invisible.** Rules before the throw are registered; rules
   after are not. Nothing in the output distinguishes "this file had 1 rule" from "this file had 40
   and we stopped at 2".
3. **A passing tail hides it completely.** If the truncated rules would all have passed, there is no
   symptom at all — and no way to know that is what happened.

## The second, lesser defect: the finding prints twice

The terminal output above shows two `Architecture Violation [1 of 1]` blocks with identical
content, while `--format json` reports **1**. `executeWarn` calls `writeReport` before it throws,
and the CLI then folds `error.violations` into `collected` and `writeReport` runs again. Two prints
of the same finding, each labelled "1 of 1". Terminal-only; the JSON path emits once.

## Why no test caught it

`tests/cli/check.test.ts` mocks `loadRuleFiles`, so no test evaluates a real self-executing rule
file whose module scope throws partway through. The CLI tests that _do_ exercise a throwing import
assert that the thrown finding is reported — which it is. Ask ADR-008's question of them: _what
would they do if every rule after the throw were dropped?_ They pass, which is the shipped state.

There is also no test anywhere asserting that a rule file's **later** rules are registered when an
earlier one throws, because before R3a `.warn()` could not throw and `.check()`'s version of this
hazard was pre-existing and unexamined.

## Suggested fix

The CLI cannot know _what_ was lost — the module never finished — but it knows a file threw at
import, which means **the rest of that file did not evaluate**. Say so.

Alongside the thrown findings, emit one configuration finding per truncated file:

> `arch.rules.ts` stopped evaluating at the finding above, so any rule declared after it was not
> registered and its violations are not in this report. Fix the finding, then re-run to see the
> rest of the file. (Rules that were already registered are reported normally.)

`bypassFilters: true` — it reports that coverage is missing, which is not something to grade,
exclude or baseline. Attribute it to the rule file, as bug 0026's stamp already does.

Two things to decide rather than discover:

- **`.check()` has the same hazard** and it is pre-existing. The plan notes this. The finding above
  covers both, because it keys on "the file threw", not on which terminal threw.
- **`export default [rule1, rule2]`** is unaffected — no rule executes at module scope — and the
  fix must not report truncation for it. That is the discriminator to test.

Fix the double print in the same change: the CLI should not re-report findings that `executeWarn`
has already written, or `executeWarn` should not write before throwing. The second is cleaner —
the throw path already carries the findings.

## Guard this needs

- A **real** self-executing rule file (not a mocked loader) with a throwing rule followed by a rule
  with known violations: the truncation finding is reported, and it names the file. Asserted by
  identity.
- **The four lost violations are still lost** — that is the honest state until someone re-runs — so
  assert the _report says so_, not that they appear.
- **The `export default [...]` control must NOT produce a truncation finding**, or the guard is
  satisfied by a finding that fires on everything.
- The single finding is printed **once** in terminal output, and `--format json` still reports one.
- Sabotage in both directions: remove the truncation finding and it must red; make it fire for the
  array-export shape and it must red.

## Relationship to other work

- **Plan 0069 R3a** specified exactly this reporting and shipped without it. Its Releases section is
  the record.
- **[Bug 0025](./0025-a-non-archruleerror-from-one-rule-file-drops-every-other-finding.md)**
  made a throwing rule file stop discarding _other files_' findings, and made the error visible.
  It cannot detect truncation _within_ a file — the module simply never finished — so this is the
  remaining half.
- **[Bug 0026](./0026-a-location-less-finding-does-not-say-which-rule-file-it-came-from.md)**
  supplies the file attribution this finding needs.

## How it was fixed

**The truncation notice**, `ruleFileTruncated` in `src/cli/rule-file-findings.ts`, emitted
at the load boundary in `runCheck` — and **only for an `ArchRuleError`**. That is the
signal a terminal fired at module scope, so rules before it ran and rules after did not.
For any other error nothing ran at all, and `ruleFileFailure` already says the file could
not be evaluated; adding "the rules after this never ran" there would imply some had, and
point at a "finding above" that is an error rather than a finding. Three of bug 0025's own
tests caught exactly that when the notice fired unconditionally.

**The double print** was subtler than the report suggested, and the report's preferred
option was wrong. It proposed that `executeWarn` should not write before throwing, since
"the throw path already carries the findings". True for the CLI, which catches and
re-renders — but on the **in-test** path nothing catches, so `ArchRuleError.message` (a
one-line summary by design) would be all a reader gets, losing the finding's message, its
remedy and the sentence saying it cannot be suppressed. Measured: that regression showed
up as `config-findings-cannot-be-downgraded.test.ts` failing.

So the write is suppressed only for findings an aggregator can recover, and only when one
is present: `setCallerAggregatesReports(true)`, set by the CLI. The ordinary warn-level
violations are always written, because they travel on no error and the CLI never calls
`.violations()` on a self-executing rule file — suppressing those would lose them outright.
That third failure mode is in the sabotage matrix too.

## What is still true

The lost violations stay lost in the run where the truncation happens. The module never
finished, so the CLI cannot know what did not register — only that something did not. The
notice says so and says what to do; naming a count would be invention.
