# Appendix to plan 0069 — the 35 tests that assert on an empty selection

**Derived:** 2026-07-26. **Precondition for:** R3b.

Reproduce in one edit: set `_requireNonEmpty = true` in `src/core/rule-builder.ts` and run the suite. 35 tests fail across 19 files.

The plan claimed **8**. It was wrong by more than 4×, and worse, nobody could have checked it — which is why this appendix exists rather than another number in a table.

**35 is the blast radius, not the defect count.** Most of these are correct: `notExist()` is _satisfied_ by an empty set, so a test asserting "nothing matches X" must keep passing after R3b. Shipping R3b without this classification would have meant either 35 spurious failures or a guard weakened until it stopped catching anything.

---

## A — legitimate: the empty selection is the point (26)

`notExist()` rules and tests explicitly written to check that a selector matches nothing. **R3b must not fail these**, which is the constraint that shapes it: the flip cannot be "empty selector fails", it has to be "empty selector fails _unless the condition is satisfied by emptiness_".

| Test                                                                                                | Why it is fine                                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `builders/call-rule-builder.ts:106` `.notExist() passes when no calls match`                        | states the contract                                                                              |
| `builders/call-rule-builder.ts:183` `.resideInFolder() filters by folder glob`                      | two halves; the empty half is the negative control                                               |
| `builders/calls-identified-by-arg.ts:95` `test #14 — identity scope`                                | negative case, with a positive control in the same test                                          |
| `builders/jsx-rule-builder.ts:26` `passes when no banned HTML elements exist`                       | states the contract                                                                              |
| `builders/jsx-rule-builder.ts:306` `passes any rule`                                                | a file with no JSX at all                                                                        |
| `builders/module-rule-builder.ts:40` `.resideInFolder() filters modules by folder`                  | two halves; the empty half is the negative control                                               |
| `builders/scoped-function-rule-builder.ts:68` `getElements returns empty when…`                     | the emptiness IS the assertion                                                                   |
| `builders/type-rule-builder.ts:104` `resideInFolder with nonexistent folder matches nothing`        | states the contract                                                                              |
| `builders/type-rule-builder.ts:145` `extendType with nonexistent base matches nothing`              | states the contract                                                                              |
| `core/rule-builder.ts:182` `.check() passes when no elements match predicates`                      | states the contract                                                                              |
| `core/rule-builder.ts:194` `.check() passes when element list is empty`                             | states the contract                                                                              |
| `helpers/within.ts:95` `returns no elements when no calls match the selection`                      | the emptiness IS the assertion                                                                   |
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
| `presets/data-layer.ts:42` `passes when only good repo and baseClass not specified`                 | a generated preset rule that does not apply to the given options                                 |
| `archunit/arch-rules.ts:768` `module predicate functions must not accept a single "glob" parameter` | selects 0 **because R-any moved `havePathMatching` out of scope** — the rule working as intended |

## B — asserts the current default, and R3b invalidates it by design (1)

| Test                                                                                                  | What to do                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/rule-builder.ts:492` `is opt-in — an empty selector WITHOUT it stays green (default unchanged)` | Rewrite as part of R3b. It is not a defect; it is the contract test for the behaviour R3b changes, and it should be inverted rather than deleted so the new default is stated somewhere. |

## C — genuine: the test believes it is checking something and is not (6) — **all fixed**

These are the real find. Each has a name or a comment that promises enforcement, and a body that asserts on nothing.

| Test                                                                                                       | The gap                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `integration/coverage-gaps.ts:480` `finds interfaces extending Entity`                                     | The name says _finds_; the body checks `extendType('NonExistentBase')`. Its own comment records the author losing track mid-test: _"In poc fixture, let's check that no type extends a nonexistent base"_.                     |
| `integration/class-entry-point.ts:76` `repos must accept DatabaseClient`                                   | A **positive** requirement, asserted with `.not.toThrow()`. The selector is empty, so no repo is checked for anything.                                                                                                         |
| `builders/function-rule-builder.ts:178` `named selection reuse works`                                      | Its second half is commented _"Rule 2: parseConfig should exist and be exported"_ — and `parseConfig` is not in this test's project, so the rule asserts nothing. The comment states the precondition and nothing verifies it. |
| `helpers/within.ts:78` `supports predicates on scoped functions`                                           | The name claims to test predicate support. The comment admits `areAsync()` filters to zero, so nothing about predicate support is exercised.                                                                                   |
| `builders/scoped-function-rule-builder.ts:45` `inherits all FunctionRuleBuilder predicates and conditions` | Same shape: claims to verify inheritance, selects nothing.                                                                                                                                                                     |
| `conditions/bare-package-imports.ts:199` `permits the package inside the layer that owns it`               | **Written during this plan, in the commit that fixed bug 0014.** The allowed set is everything, so the preset generates a rule with no subjects and `[]` violations is trivially true.                                         |

The last one is the useful one. It was written by someone who had spent a week on exactly this failure mode, in the change that fixed a neighbouring instance of it, and it still went in. That is the argument for the mechanism rather than for more care.

---

## Status

**The six in C are fixed** (2026-07-26), and the population is 35 → 30. The remaining 30 are the 26 in A, the 1 in B, and three follow-on empty rules inside tests that now assert something real beside them.

Two of the six turned out to be a **library** defect rather than a test defect — see [bug 0016](../bugs/0016-narrowing-a-named-selection-mutates-it.md). `named selection reuse works` was demonstrating that it does not: narrowing a named selection mutates it, so the second rule lost the subject it was written for. `inherits all FunctionRuleBuilder predicates and conditions` had the same shape twice over — its `contain()` assertion ran on the set that its own `areAsync()` filter had already emptied.

Neither would have been found by reading. Both surfaced from the measurement.

## What R3b has to do

1. **Fix the six in C** — give each a real subject, or delete it if the thing it claims to test is covered elsewhere.
2. **Invert B** so the new default is stated.
3. **Leave A alone**, and make sure the flip does not touch them. The 26 are the specification: R3b's guard has to distinguish "this selector is empty and the condition is satisfied by emptiness" from "this selector is empty and the rule therefore checks nothing". `notExist()` is the former; almost everything else is the latter.

Item 3 is the design constraint, and it was not visible from the number alone.
