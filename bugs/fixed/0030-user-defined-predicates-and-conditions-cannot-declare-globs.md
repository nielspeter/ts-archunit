# Bug 0030: user-defined predicates and conditions cannot declare their globs

**Reported:** 2026-07-30
**Found in:** all versions since v0.20.0 (R2a) for `definePredicate`; the asymmetry with
built-ins dates from v0.29.0 and [plan 0073](../plans/completed/0073-conditions-declare-their-globs.md)
**Fixed:** 2026-07-30 — **not yet released.** Additive and non-breaking; both parameters are
optional, so every existing two-argument call is unaffected.
**Severity:** Medium for `definePredicate`, Low for `defineCondition`, and the split is the
point — see below. Neither is a false green: a glob nobody declares is a glob `doctor` does not
report, so this is **under-detection**, not a wrong verdict.

## Description

Both public factories return exactly the fields they are handed, and neither has a parameter for
globs:

```ts
// src/core/define.ts:20
export function definePredicate<T>(
  description: string,
  test: (element: T) => boolean,
): Predicate<T> {
  return { description, test }
}

// src/core/define.ts:47
export function defineCondition<T>(
  description: string,
  evaluate: (elements: T[], context: ConditionContext) => ArchViolation[],
): Condition<T> {
  return { description, evaluate }
}
```

`Predicate.globs` and `Condition.globs` are both optional, so this compiles and always has. But a
user whose custom predicate or condition matches paths against a glob has **no way to declare
it**, so their glob never reaches `globs()`, `doctor` or `diagnose()`.

## Why the two halves have different severity

Measured against what the machinery does with each position today:

| position    | acted on today?                                                     | so a user-declared glob would…    |
| ----------- | ------------------------------------------------------------------- | --------------------------------- |
| `selector`  | **yes** — `doctor` reports a dead selector glob (R2a, v0.20.0)      | be reported dead; today it is not |
| `condition` | **no** — `diagnose.ts` skips `position === 'condition'` by decision | change nothing until 0074 lands   |

So `definePredicate` is a **present-tense** detection gap: a team that writes a custom
path-matching predicate with a typo'd glob gets a clean bill of health from `doctor`, and
`doctor` exits 0. `defineCondition` is a **latent** one, and it only matters once
[plan 0074](../plans/0074-r3b-the-selector-glob-flip.md) or 0072's successor starts acting on
condition globs — at which point built-in conditions would be checkable and user-defined ones
silently exempt.

## Why plan 0073 is what surfaced it

Before 0073 the condition half of the asymmetry did not exist: **no** condition declared globs,
built-in or otherwise. 0073 populated twelve built-ins and gave both internal factories a
`globs` parameter — `elementCondition` and `functionCondition` — and left the public factory
without one. The predicate half is older and independent of 0073; 0073 is only what prompted
looking.

`docs/custom-rules.md:6` already makes the adjacent point about a different field, which is why
this shape is worth naming rather than treating as an oversight: _"a condition written with
`defineCondition()` does **not** get that for free"_.

## Suggested fix

An optional third parameter on each, mirroring what the two internal factories now take:

```ts
export function definePredicate<T>(
  description: string,
  test: (element: T) => boolean,
  globs?: DeclaredGlobs,
): Predicate<T> {
  return { description, test, globs }
}
```

Additive, no call site changes, and it composes with `globAnyOf` / `globNode`, which are already
public. **Fix both in one change** — fixing only the condition half would leave the
higher-severity one open while looking like the bug was closed.

**Do not ship it without a guard, and the guard is not "it compiles."** Assert that a
`definePredicate` carrying `globNode({ glob, kind: 'file-path' })` reaches `globs()` stamped
`position: 'selector'` **and is reported by `doctor` when the glob is dead** — the second half is
the one that matters, since the first would pass while the finding still never surfaced. Sabotage
by dropping each parameter in turn. `tests/core/condition-glob-declaration.test.ts` is the file
for the condition half and the model for both.

## Not in scope for the fix

Whether a user-declared glob should be _believed_ about its `kind`. A user passing
`kind: 'file-path'` for something matched against a bare specifier would get the `import-target`
exemption backwards and see a false dead-glob report. That is an argument for documenting the
kinds, not for withholding the parameter — but it should be decided in the same change rather
than discovered after.

## The fix, and what it measured

Two optional parameters, exactly as suggested. `tests/core/user-defined-globs.test.ts`, 8 tests,
**6 of 6 sabotages caught** plus one more that mattered more than any of them (below).

Verified end to end through the real CLI rather than through `diagnose` alone. A custom
predicate declaring `globNode({ glob: '**/generated/**', kind: 'file-path' })` in a rule file:

```
  rules/arch.rules.ts
    that reside in '**/generated/**' should not import from "**/banned/**"
    reside in '**/generated/**'  [selector]
    no-match: these are anchored but matched no file. Common causes: …
```

`doctor` exits **1**. Without the parameter there is no such report and it exits 0 — which is
the whole bug, now observable from the outside.

### The plumbing never needed changing, and that was measured before writing any code

A hand-built `Predicate` object literal carrying `globs`, passed to `.satisfy()`, **already**
reached `globs()` stamped `position: 'selector'` and **was already reported dead by
`diagnose()`, identically to a built-in `resideInFolder` control.** `satisfy()` stores the
object as-is (`rule-builder.ts:104-109`). So the fix is a signature, not a mechanism — which is
why it is two lines rather than a plan.

### It found a vacuous assertion in plan 0073's own guard

`condition-glob-declaration.test.ts`'s "reports nothing new" test asserted that a condition
glob matching nothing produces no finding — using `notImportFrom`, which declares
`import-target`. Measured: **removing the `position === 'condition'` skip from
`diagnose.ts:169` leaves that test green.** `import-target` has no path universe
(`path-universe.ts:72`), so `isDeadSite` is false for it whether the skip exists or not — the
test proved an exemption by **kind** while claiming to prove one by **position**.

Fixed in the same change by adding a case that uses `onlyBeImportedVia`, which declares
`file-path` and therefore _is_ checkable: the site exists, carries the dead glob, and is still
not reported, so the position is doing the work. That case reds when the skip is removed. This
guard file's own `defineCondition` test used `file-path` deliberately for the same reason, which
is what exposed the gap.

### The `kind` question, decided

The bug listed "should a user-declared `kind` be believed?" as needing a decision in the same
change. **Decided: believed, and documented.** `definePredicate`'s JSDoc and
`docs/custom-rules.md` both carry the table of kinds and state the cost in each direction — a
bare specifier declared `file-path` earns a false dead-glob report; a real path declared
`import-target` is silently exempt — with the explicit advice that declaring nothing is the
honest choice when unsure, since that is exactly the prior behaviour. Validating the kind is not
possible without knowing what the user's `test` function does with the glob, which is the thing
only they can see.
