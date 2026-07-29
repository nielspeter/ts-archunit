# Bug 0019: a rule with subjects and no condition passes in total silence

**Reported:** 2026-07-28
**Fixed:** 2026-07-29 (v0.23.0)
**Found in:** all versions through v0.20.0
**Severity:** High — this is the defect the whole project exists to prevent, in the library itself. A rule that selects subjects and asserts nothing about them reports no violations, throws nothing, and prints nothing. There is a check for exactly this case and it cannot fire.

## Description

`src/core/rule-builder.ts:378` guards the empty-condition case:

```ts
if (this._conditions.length === 0 && this._phase === 'predicate') {
  console.warn(`[ts-archunit] Rule '${ruleId}' has predicates but no conditions. …`)
```

`should()` sets the phase to `'condition'` (`:71-75` → `fork._phase = 'condition'` at `:76`). So every rule that reached the condition phase — which is every rule spelled `.should()` — fails the `_phase === 'predicate'` test, and the warning is unreachable for it.

**Corrected 2026-07-28, by measurement.** The original text here said the surviving case was "a predicate-only method called after `.should()`, which resets the phase". That is inverted: `that()` is the only writer of `_phase` besides `should()`, and predicate-only methods do not touch it. Measured on `tests/fixtures/poc`:

```
.that().pred.check()               [no should()]      1 warning,  no throw
.that().pred.should().areAsync().check()              0 warnings, no throw   <- the documented mistake, fully silent
.that().pred.should().that().check()                  1 warning,  no throw
.that().pred.should().check()                         0 warnings, no throw   <- this bug's headline
```

So the shape the guard's own message names is the _most_ silent of the four, and what still warns is a selection that never reached `.should()` — a shape this bug did not originally mention, and whose remedy differs again. Four shapes, four remedies; see [plan 0070](../../plans/completed/0070-a-rule-must-assert-something.md).

## Reproduction

Against `tests/fixtures/poc`:

```
functions(p).that().haveNameMatching(/^parse/).should()    // 4 subjects, 0 conditions
  .check() throws:  NO — passes
  warnings:         0 — SILENT
```

Four subjects were selected. Nothing was asserted about them. `.check()` returns normally and stderr is empty.

The same shape via a held rule, which is how it was found:

```
rule = functions(p).that().haveNameMatching(/^parse/).should().notExist()
  rule.violations()            4
  rule.should().violations()   0        <- fork() cleared the conditions
  warnings                     0
```

## Why the ADR-008 question is the whole bug

_What would this test do if the thing it guards were completely broken?_

A consumer's rule file containing nothing but `.should()` calls with the conditions omitted is **green**. Not amber, not noisy — green, with an exit code of 0, which ADR-008 rule 1 says an agent reads as "nothing to do". The library's own guard against this state is present in the source, reads correctly, and is excluded by a phase test written for a different purpose.

## Suggested fix

Two parts, and the second matters more than the first:

1. Drop the `_phase` term. A rule with subjects and no conditions asserts nothing regardless of which phase it stopped in.
2. Make it **fail**, not warn — this is proposal 019's ask, and it is a configuration finding (plan 0067 / R3a): not excludable, not downgradable to `warn`, bypassing diff and baseline. A warning here is worth nothing: ADR-008 rule 1 exists because the primary consumer does not read them.

[Proposal 019](../../proposals/019-rules-that-enforce-nothing-must-fail.md) describes this shape as `console.warn(...) + return []` sites that are "still there". That framing is what hid this: it treats the warn as a working-but-too-quiet mechanism. For the main case it is not too quiet, it is **absent**. (The count is four, not the five the proposal claimed; `plans/ROADMAP.md` was corrected in v0.21.0.)

## Guard this needs

The guard must be built on the **fluent** form, because that is the form that is silent:

- `.should()` with no condition method **fails**, on a non-empty subject set.
- The same on a held rule whose conditions were cleared.
- A rule with subjects and one real condition still passes — or the guard is satisfied by failing everything.
- The finding is refused by `.excluding()` and by `asSeverity('warn')`, per R3a.

Asserting on `console.warn` being called is not a guard. Under the current behaviour it is not called, so a test that asserts the warning fires would already be red; a test that asserts it does _not_ fire would pin the bug.

## Relationship to plan 0069

**Closing via [plan 0070](../../plans/completed/0070-a-rule-must-assert-something.md)** (0.22.0 completes the diagnostic; 0.23.0 makes it fail). It was filed as an R3b precondition, and it inverted one of R3b's assumptions: R3b absorbs proposal 019 ("rules that enforce nothing must fail") and its inventory counts the `console.warn(...) + return []` sites as the places to convert. Building on that inventory would produce a guard that fires only in the phase where the problem does not occur — a false green of exactly the shape the glob work spent four review rounds eliminating.

R3b's empty-**selector** half and this empty-**condition** half are the two directions of one property: _a rule must have something to check, and something to check it against._ Neither is currently enforced, and this one has no `doctor` coverage either — `diagnose()` reports `kind: 'no-condition'` as a diagnostic, which is the measuring instrument, not the gate.

See also [bug 0020](./0020-should-twice-silently-drops-the-first-assertion.md), which is how a rule reaches this state without the author omitting anything.

## How it was fixed

Two releases, deliberately, so consumers could measure before anything broke.

**v0.22.0 — the instrument.** `assertsSomething()` and `assertionAdvice()` on every builder
(`TerminalBuilder` is the single root, so one hook reaches all fifteen), plus `describeRule()` on
the six that reported `unnamed`. `doctor` and `diagnose()` name every assertion-less rule and the
remedy for its own shape. Nothing at runtime changed. The four old `console.warn(...) + return []`
sites were deleted — the `RuleBuilder` one could never fire for the commonest shape anyway, being
gated on a phase `.should()` had already left, which is the specific defect this bug reported.

**v0.23.0 — the flip.** One private gate, `TerminalBuilder.collectWithAssertionGuard()`, called
from `violations()` / `check()` / `warn()`, raising an `ArchViolation` with `bypassFilters` —
`error` severity whatever the rule asked for, refused by `.excluding()`, skipped by baseline and
diff. Gate-first, ahead of `collectViolations()`, for three measured reasons recorded in the
method's docstring.

**Eight shapes, not seven.** A review of the release branch measured an eighth that the plan never
enumerated and that is the worst of them: a predicate used after `.should()` **alongside a real
condition** retroactively narrows the subject set the conditions are evaluated over. Measured
`subjects 4 -> 0`, `violations 4 -> 0`, `diagnose() []`, `check()` passed — and its description
reads as deliberate, so nobody had a reason to look. `assertsSomething()` consulted the
misplaced-predicate list only when there were zero conditions.

The finding also states that it cannot be suppressed and links the rule (ADR-008 rule 3): measured
before that was added, a reader given only the remedy tries `.asSeverity('warn')`, `.excluding()`,
the baseline and `--changed` first — four CI cycles.

**An earlier revision emitted the remedy as a runtime stderr warning and it was withdrawn.** A
bespoke output path bypassed the formatter, the JSON payload, the annotation surface and the exit
code, and a five-persona review found a defect at each of those seams. The finding form reaches
all four by construction. That withdrawal is what made the 0.23.0 gate cheap. It also uncovered
[bug 0024](../0024-warn-terminal-is-invisible-inside-a-test-runner.md), which is the pre-existing
half and remains open.
