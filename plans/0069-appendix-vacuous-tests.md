# Appendix to plan 0069 — the 35 tests that assert on an empty selection

**Derived:** 2026-07-26. **Precondition for:** R3b.

Reproduce in one edit: set `_requireNonEmpty = true` in `src/core/rule-builder.ts` and run the suite. 35 tests fail across 19 files.

The plan claimed **8**. It was wrong by more than 4×, and worse, nobody could have checked it — which is why this appendix exists rather than another number in a table.

**Corrected 2026-07-26, after review found the same defect one level down.** The first version counted 26 rows in a table that had 27, dropped one of the 35 tests entirely, and classified a **live shipped preset bug** as legitimate. Three reviewers found all three independently. A hand-typed count, wrong, in the document written because a hand-typed count was wrong — which is the argument for the mechanism and not for more care, again.

Rows are keyed by **test name**, not `file:line`. The first version's line numbers were stale the day they merged, because the fixes in the same commit moved them.

**35 is the blast radius, not the defect count.** Most of these are correct: `notExist()` is _satisfied_ by an empty set, so a test asserting "nothing matches X" must keep passing after R3b. Shipping R3b without this classification would have meant either 35 spurious failures or a guard weakened until it stopped catching anything.

---

## A — legitimate: the empty selection is the point (22)

Conditions that assert **cardinality** — `notExist()` — plus tests written to check that a selector matches nothing. **R3b must not fail these.** See the discriminator below for why that phrase had to be narrowed.

| Test                                                                                                | Why it is fine                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `builders/call-rule-builder.ts:106` `.notExist() passes when no calls match`                        | states the contract                                                                              |
| `builders/call-rule-builder.ts:183` `.resideInFolder() filters by folder glob`                      | two halves; the empty half is the negative control                                               |
| `builders/calls-identified-by-arg.ts:95` `test #14 — identity scope`                                | negative case, with a positive control in the same test                                          |
| `builders/jsx-rule-builder.ts:26` `passes when no banned HTML elements exist`                       | states the contract                                                                              |
| `builders/jsx-rule-builder.ts:306` `passes any rule`                                                | a file with no JSX at all                                                                        |
| `builders/module-rule-builder.ts:40` `.resideInFolder() filters modules by folder`                  | two halves; the empty half is the negative control                                               |
| `builders/type-rule-builder.ts:104` `resideInFolder with nonexistent folder matches nothing`        | states the contract                                                                              |
| `builders/type-rule-builder.ts:145` `extendType with nonexistent base matches nothing`              | states the contract                                                                              |
| `integration/advanced-features.ts:122` `custom predicate that matches nothing…`                     | states the contract                                                                              |
| `integration/advanced-features.ts:325` `notExist — non-existent classes…`                           | states the contract                                                                              |
| `integration/call-entry-point.ts:141` `onObject("db").notExist() in route files`                    | a real architectural assertion satisfied by emptiness                                            |
| `integration/class-type-predicates.ts:348` `no interfaces extend BaseService`                       | ditto                                                                                            |
| `integration/coverage-gaps.ts:89` `importFrom with no matches produces no violations`               | states the contract                                                                              |
| `integration/coverage-gaps.ts:153` `no module exports a nonexistent symbol`                         | states the contract                                                                              |
| `integration/coverage-gaps.ts:1339` `.notExist() — asserts no matching modules exist`               | states the contract                                                                              |
| `integration/function-rules.ts:71` `no function has more than 5 parameters`                         | a real assertion satisfied by emptiness                                                          |
| `integration/function-rules.ts:221` `functions in a non-existent folder should pass trivially`      | says so in the title                                                                             |
| `integration/function-rules.ts:280` `exported async functions with unreachable name should pass`    | says so in the title                                                                             |
| `integration/function-rules.ts:464` `private methods with too many params should not exist`         | a real assertion satisfied by emptiness                                                          |
| `integration/metrics.ts:113` `haveCyclomaticComplexity filters then asserts`                        | ditto                                                                                            |
| `integration/metrics.ts:206` `haveComplexity with high threshold finds nothing`                     | says so in the title                                                                             |
| `archunit/arch-rules.ts:768` `module predicate functions must not accept a single "glob" parameter` | selects 0 **because R-any moved `havePathMatching` out of scope** — the rule working as intended |

## B — asserts the current default, and R3b invalidates it by design (5)

| Test                                                                       | What to do                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `is opt-in — an empty selector WITHOUT it stays green (default unchanged)` | States the default in its own title. Invert it, do not delete it.                                                                                                                                                                                                            |
| `.check() passes when no elements match predicates`                        | **Was misfiled under A.** Its condition is `alwaysFail('unreachable')`, chosen precisely _because_ it is not satisfied by emptiness. "A condition that always fails passes over an empty set" IS the default R3b inverts.                                                    |
| `.check() passes when element list is empty`                               | Same — and it raises a spec question R3b must answer: this builder has **zero predicates**, so is "empty selector" _predicates matched nothing_ or _no elements at all_? The shipped meta-finding says "likely a wrong glob or filter", false on that path (ADR-008 rule 2). |
| `getElements returns empty when call selection matches no calls`           | **Was misfiled under A.** Ends in `should().contain(call('anything'))`; `contain()` says nothing about cardinality, so this reds under R3b. Its title claims to assert emptiness while the body asserts a rule did not throw.                                                |
| `returns no elements when no calls match the selection`                    | **Was misfiled under A.** Identical shape to the row above.                                                                                                                                                                                                                  |

## C — genuine: the test believes it is checking something and is not (8) — **all fixed**

These are the real find. Each has a name or a comment that promises enforcement, and a body that asserts on nothing.

| Test                                                                                                       | The gap                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration/coverage-gaps.ts:480` `finds interfaces extending Entity`                                     | The name says _finds_; the body checks `extendType('NonExistentBase')`. Its own comment records the author losing track mid-test: _"In poc fixture, let's check that no type extends a nonexistent base"_.                                                                                                                                                                                                                                                  |
| `integration/class-entry-point.ts:76` `repos must accept DatabaseClient`                                   | A **positive** requirement, asserted with `.not.toThrow()`. The selector is empty, so no repo is checked for anything.                                                                                                                                                                                                                                                                                                                                      |
| `builders/function-rule-builder.ts:178` `named selection reuse works`                                      | Its second half is commented _"Rule 2: parseConfig should exist and be exported"_ — and `parseConfig` is not in this test's project, so the rule asserts nothing. The comment states the precondition and nothing verifies it.                                                                                                                                                                                                                              |
| `helpers/within.ts:78` `supports predicates on scoped functions`                                           | The name claims to test predicate support. The comment admits `areAsync()` filters to zero, so nothing about predicate support is exercised.                                                                                                                                                                                                                                                                                                                |
| `builders/scoped-function-rule-builder.ts:45` `inherits all FunctionRuleBuilder predicates and conditions` | Same shape: claims to verify inheritance, selects nothing.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `conditions/bare-package-imports.ts:199` `permits the package inside the layer that owns it`               | **Written during this plan, in the commit that fixed bug 0014.** The allowed set is everything, so the preset generates a rule with no subjects and `[]` violations is trivially true.                                                                                                                                                                                                                                                                      |
| `non-exported functions should not exist (negative test — some exist)`                                     | **Dropped from the first version of this appendix entirely** — the 35th test, counted by the measurement and classified by nothing. Its title says _some exist_; its body asserts `.not.toThrow()`, which requires that none do. Seven lines of comment record the author reasoning toward the empty result and then accepting it.                                                                                                                          |
| `passes when only good repo and baseClass not specified`                                                   | **Was filed under A**, on a rationale measurement contradicts: the preset does generate the rule and it does apply — it selects nothing, because `repositories` takes a file glob and `resideInFolder` reads the parent directory. A live shipped defect, now [bug 0018](../bugs/0018-data-layer-preset-silently-enforces-nothing-for-a-file-glob.md). Had R3b been built to leave category A untouched, the guard would have been designed to preserve it. |

The last one is the useful one. It was written by someone who had spent a week on exactly this failure mode, in the change that fixed a neighbouring instance of it, and it still went in. That is the argument for the mechanism rather than for more care.

---

## Status

**The six in C are fixed** (2026-07-26), and the population is 35 → 30. The remaining 30 are the 26 in A, the 1 in B, and three follow-on empty rules inside tests that now assert something real beside them.

Two of the six turned out to be a **library** defect rather than a test defect — see [bug 0016](../bugs/0016-narrowing-a-named-selection-mutates-it.md). `named selection reuse works` was demonstrating that it does not: narrowing a named selection mutates it, so the second rule lost the subject it was written for. `inherits all FunctionRuleBuilder predicates and conditions` had the same shape twice over — its `contain()` assertion ran on the set that its own `areAsync()` filter had already emptied.

Neither would have been found by reading. Both surfaced from the measurement.

## The discriminator R3b can branch on

The first version of this appendix said the flip must be "empty selector fails **unless the condition is satisfied by emptiness**". Review killed that, on two counts, and both are right:

- **It is true of every condition.** Universal quantification over ∅ is vacuously true, so `beExported([])`, `contain([])` and `notImportFrom([])` are all "satisfied by emptiness". Read literally it exempts all 35 and R3b catches nothing.
- **It is not derivable.** Every condition returns `[]` for `[]`, so probing `evaluate([], ctx)` cannot tell `notExist` from `beExported`. That is the same-derivation non-guard ADR-008 rule 5 warns about.

The workable form is narrower and must be **declared**, not inferred: a condition is exempt when it asserts something about the selection's **cardinality**, where zero subjects is the answer rather than the absence of one. `notExist()` is the only shipped condition of that kind.

Four implementation constraints, so R3b does not rediscover them:

- Read the flag off the **condition object**, not the builder method. `tests/builders/type-rule-builder.test.ts` reaches it via `.satisfy(notExist())`, so both spellings must behave identically.
- `Condition` is a public export and `defineCondition` is its sanctioned constructor. If the flag is expressible there, it is a one-line silent opt-out on any user condition — the hazard the Decisions section used to reject `.allowEmpty()`, relocated onto the condition object. A module-private `unique symbol`, with no `defineCondition` parameter, closes it by construction (ADR-008 rule 3's corollary).
- `andShould()` ANDs, so the verdict on empty is "**every** condition is exempt".
- `evaluate()` returns at the empty-subject branch _before_ reading `_conditions`; that branch has to move below the condition list.

## What R3b has to do

1. **The 8 in C are fixed.** Two turned out to be library defects rather than test defects — bugs 0016 and 0018.
2. **Invert the 5 in B** so the new default is stated somewhere.
3. **Leave the 22 in A alone.** They are the specification of the discriminator above.
4. **Decide what a preset does.** `strictBoundaries` emits 37 rules and `layeredArchitecture` generates per-layer rules; R3b as drafted would fail every generated rule that does not apply to the options a user set — a rule they never wrote, with a remedy they cannot apply. This needs a decision, and at minimum a Known exposure.
5. **Decide the user-side escape hatch.** R3b's Upgrading section offers `workspace([...])` and "delete the rule", both assuming the fault is a path glob. Neither reaches a legitimately-empty name, decorator or type predicate — a tripwire on `haveDecorator('Deprecated')` before anyone uses it. CHANGELOG 0.18.1 set the bar for reinstating a withdrawn guard as "each remedy is executable data **and an opt-out exists**"; as drafted R3b does not meet it.

Items 4 and 5 were not visible from the number, and not visible from the first version of this classification either.
