# Plan 0073 — Conditions declare their globs

**Status:** DONE, 2026-07-30, commit `e125c5c`. Smaller than it looks: the interface, the
gathering and the stamping all existed already and no condition used them.

**Two things the plan got wrong, both corrected by parsing instead of reading:**

1. **The population is 12, not 7.** `structural.ts`'s `resideInFile` / `resideInFolder` —
   the generic element twins, exported publicly as `conditionResideInFile` /
   `conditionResideInFolder` (`src/index.ts:81-82`) and used by the class, module and type
   builders — were missing from the table below. They were the _more_ reachable half of the
   hole, since `function.ts`'s pair is internal to `FunctionRuleBuilder`. Three further
   aliases in `src/rules/dependencies.ts` (`onlyDependOn`, `mustNotDependOn`, `typeOnlyFrom`)
   are pure delegations and inherit the declaration; that is now asserted, because a refactor
   that reimplemented one inline would silently stop declaring.
2. **Guard 4 was vacuous and was dropped.** It asked for an `explain` assertion on the
   ground that "a reader of `explain` cannot see which paths a rule forbids". Measured, that
   ground is false: `explain` renders `describeRule()`, which interpolates the glob into the
   condition's `description` string, so it prints `Do NOT import from "**/legacy/**"` with
   the entire change reverted. `explain` never reads `globs()`. The real consumers are
   `doctor` and `diagnose()`. The discriminator is now an assertion rather than a comment,
   so the vacuous version cannot be re-added.

A derivation detail worth keeping: `onlyImportFrom`, `notImportFrom` and `dependOn` are
**overloaded**, and their implementation signature is
`(...args: [string[], ImportOptions] | string[])`. A walk that reads implementation
signatures only misses three of the four dependency conditions — measured, on the first
version of the guard's own walk.
**Priority:** Medium. Not a false green on its own — nothing reports a condition glob today,
so nothing reports one wrongly. It is the missing half of [plan 0069](./completed/0069-no-rule-may-certify-nothing.md)'s
glob model, and the prerequisite for anything that wants to reason about condition globs at
all.
**Blocks:** [plan 0072](./0072-a-denylist-glob-that-cannot-match.md)'s successor, if that is
ever built. 0072's own mechanism is refuted; this plan is worth doing regardless of it.

## Problem

`Condition<T>` already declares the field, with the contract written:

```ts
// src/core/condition.ts:63
/**
 * The path globs this condition matches against, if any. See
 * `Predicate.globs` — same contract, stamped with `position: 'condition'`.
 */
readonly globs?: DeclaredGlobs
```

`RuleBuilder.globs()` already gathers it and stamps the position
(`src/core/rule-builder.ts:183-186`). **No condition in `src/` populates it** — measured, zero
of them, against 12 declarations across the predicates.

So the glob model 0069 built has a hole exactly where its own decision table has rows. The
consequences today:

| surface                                     | what it sees                   |
| ------------------------------------------- | ------------------------------ |
| a `notImportFrom` rule's `globs()`          | **0** trees                    |
| the same rule with a `.that()`              | **1** tree — the selector only |
| `explain` / `explain --format agent`        | selector globs only            |
| `doctor` / `diagnose()`                     | selector globs only            |
| 0069's `PathUniverse` / emptiness machinery | selector globs only            |

A reader of `explain` cannot see which paths a rule forbids. An agent pasting
`explain --format agent` into a `CLAUDE.md` gets the rule's selector and not its subject.
And 0069's table reasons about `position: 'condition'` rows that no site ever occupies.

## The twelve conditions, measured

Every condition in `src/conditions/` that takes globs, with the kind each glob is matched
against:

| condition                 | file                    | glob is matched against                                 | kind            |
| ------------------------- | ----------------------- | ------------------------------------------------------- | --------------- |
| `onlyImportFrom`          | `dependency.ts`         | `candidatesFor(edge)` — resolved path or bare specifier | `import-target` |
| `notImportFrom`           | `dependency.ts`         | same                                                    | `import-target` |
| `dependOn`                | `dependency.ts`         | same                                                    | `import-target` |
| `onlyHaveTypeImportsFrom` | `dependency.ts`         | same                                                    | `import-target` |
| `onlyBeImportedVia`       | `reverse-dependency.ts` | the **importer's** file path                            | `file-path`     |
| `resideInFile`            | `function.ts`           | `getSourceFile().getFilePath()`                         | `file-path`     |
| `resideInFolder`          | `function.ts`           | the immediate parent directory                          | `parent-dir`    |
| `resideInFile`            | `structural.ts`         | `getElementFile(element)` — the generic element twin    | `file-path`     |
| `resideInFolder`          | `structural.ts`         | the immediate parent directory                          | `parent-dir`    |
| `onlyDependOn`            | `rules/dependencies.ts` | delegates to `onlyImportFrom`                           | `import-target` |
| `mustNotDependOn`         | `rules/dependencies.ts` | delegates to `notImportFrom`                            | `import-target` |
| `typeOnlyFrom`            | `rules/dependencies.ts` | delegates to `onlyHaveTypeImportsFrom`                  | `import-target` |

`onlyBeImportedVia` is the row to get right and the easy one to get wrong: its glob names
the **files allowed to import the subject**, so it is a genuine `file-path` glob and _is_
checkable against the path universe — unlike the four `import-target` rows, which
`path-universe.ts:72` deliberately gives no views because a bare specifier legitimately
matches no project path (bug 0014).

## Mechanism

One line per condition, mirroring what predicates already do:

```ts
// src/conditions/dependency.ts, inside notImportFrom
return {
  globs: globAnyOf(globs, 'import-target'),
  description: `not import from ${quotedGlobs}`,
  evaluate(sourceFiles, context) { … },
}
```

`globAnyOf` is correct for the variadic import family — `importFrom(...globs)` is
`matchers.some`, so the set is dead only when every glob in it is, which is exactly `any`
(`glob-site.ts:185`). `resideInFile` / `resideInFolder` take a single glob and use
`globNode`, as their predicate twins do.

**It is behaviour-neutral, and that is measured rather than assumed.** With
`notImportFrom` declaring its globs: `tsc` clean, **2580 tests pass, zero changed**.
`diagnose.ts:169` skips `position === 'condition'` sites, so nothing new is reported —
which is the point. This plan makes the globs _visible_; deciding what to report about
them is 0069's R3b and 0072's business, and both are separate.

That neutrality is also the risk. A change that alters nothing observable can be reverted
by anyone at any time with the suite still green, so the guards below have to assert the
declaration itself.

## Guards

Ask ADR-008's question of this plan: **what would these tests do if every condition stopped
declaring its globs?** The answer must not be "pass", and today's suite answers "pass" for
all 2580.

1. **The population is derived, not restated.** A test that enumerates every exported
   condition taking a glob-shaped parameter and asserts each declares `globs`. A hard-coded
   list of seven passes forever once an eighth condition is added — which is precisely how
   this hole opened, since the field was added and then never populated. Derive it by
   constructing each condition and checking the field, with a `> 6` non-vacuity anchor.
2. **The kind is asserted per condition**, as an explicit expected list including
   `onlyBeImportedVia` as `file-path` and the four dependency conditions as
   `import-target`. Getting `onlyBeImportedVia` wrong would hand a checkable glob to the
   universe machinery under a kind that has no views, which fails silently in the direction
   that looks fine.
3. **The globs reach `globs()`**, through a real builder — `.should().notImportFrom(…)`
   exposes a tree containing the glob, stamped `position: 'condition'`. That is the
   integration the gathering code claims and no test exercises.
4. **`explain` shows them.** The user-visible payoff, and the reason this is worth doing
   without 0072: assert a `notImportFrom` rule's `explain` output names the forbidden path.
5. **Nothing new is reported.** `diagnose()` over this repository's own rule files returns
   the same findings before and after. A behaviour-neutral change has to be _shown_
   neutral, or the next reader cannot tell this plan from R3b.
6. **Sabotage, from the diff:** drop each declaration in turn (item 1 must red); swap
   `onlyBeImportedVia` to `import-target` (item 2 must red); swap `globAnyOf` for
   `combineGlobs`/`all` on a variadic family (a set with one live glob would read as dead —
   the 0.18.1 withdrawal in the other direction, per `glob-site.ts:185`).

## Result

`tests/core/condition-glob-declaration.test.ts`, 11 tests. Two sabotage matrices enumerated
from the diff, run in the foreground against an asserted-green baseline, reading exit codes:
**21 of 21 caught**, tree verified clean by git after each.

The first 14 attack the source — every declaration dropped in turn, both `onlyBeImportedVia`
and `resideInFolder` kinds swapped, `any` swapped for `all`, and each of the two helpers
(`functionCondition`, `elementCondition`) stopped from threading `globs` through. The other 7
attack the guard's own machinery, which is where the plan's real risk was: a new glob-taking
condition appearing unclassified (S15), an alias reimplemented inline (S16), a **name**
condition wrongly declaring globs so identifiers reach the path universe (S17), the parse walk
matching nothing (S18), a row dropped from the table (S19), overload signatures no longer read
(S20), and the non-path discriminator list emptied (S21).

Behaviour-neutrality confirmed rather than asserted: **2588 tests passed unchanged** with the
nine declarations in place, before the guard was written. That is the measurement that makes
this plan distinguishable from R3b — and the reason the guard has to assert the declaration
itself, since nothing else in the suite can see it.

## Out of scope

- **Reporting anything about a condition glob.** That is 0069's R3b for selectors and
  [0072](./0072-a-denylist-glob-that-cannot-match.md) for the denylist case, whose static and
  runtime mechanisms are both refuted. This plan deliberately changes no verdict.
- **`polarity` on condition sites.** `negateGlobs` is polarity's only writer and it means
  `not()`-combinator negation, not denylist-versus-allowlist. Overloading it to mean the
  second would break the first. If a future plan needs the distinction it should add a field
  and say why, rather than reuse this one — 0072 draft 1 assumed the reuse and was wrong.
- **Giving `import-target` path-universe views.** Deliberate (`path-universe.ts:72`) and
  load-bearing for bug 0014.
- **The `only*` edgeless-subject exposure** — 0069 line 205,
  [bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md).
