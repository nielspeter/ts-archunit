# Plan 0069 — No rule may certify nothing

**Status:** DRAFT — not reviewed. Do not implement until it has been through `/review-proposal`.
**Priority:** Highest open item. This is the defect the tool exists to prevent, committed by the tool, and it has now been measured in every codebase we have pointed it at.
**Effort:** ~2 days, phased. Phase 1 is breaking.
**Supersedes:** the deferred part C of [plan 0067](./0067-empty-selector-safety.md); absorbs [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md); closes [bug 0011](../bugs/0011-dogfood-rules-select-nothing.md).
**Builds on:** [proposal 014](../proposals/014-empty-selector-safety.md) draft 2 (architect + product reviewed, 2026-07-24) — with one **correction to its central check**, below.

---

## Problem

A rule that matches nothing passes. Every time. Measured:

| Where                          | What                                                                                                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **This repo**                  | 13 dogfood rules select nothing outside a checkout literally named `ts-archunit`; 1 more selects nothing everywhere and hides a live violation ([bug 0011](../bugs/0011-dogfood-rules-select-nothing.md)) |
| **This repo's own test suite** | 5 pre-existing tests assert on rules that select nothing — including one in a shipped **preset test**                                                                                                     |
| **An adopting codebase**       | 7 rule sites across 4 globs, **2 of them security rules** — JWT verification and internal-route auth, both guarding nothing                                                                               |
| **v0.19.0**                    | shipped with all 14 of ours still in it                                                                                                                                                                   |

The tool ships `.expectNonEmpty()` for exactly this. It is **opt-in**, and the evidence that opt-in does not work is now conclusive: the adopting team calls it **eight times**, in the same files as their seven vacuous rules, with a source comment showing they understand it. They still shipped seven. Not one of our own 14 rules uses it.

> An opt-in guard against a mistake you do not know you are making is not a guard.

---

## The correction to 014 / 0067-C

0067-C specifies the check as _"fail when a path glob matches zero project **files**"_, chosen so a valid-but-classless folder does not false-fire. **Measured against the real bugs, that check catches none of them:**

| Real bug                                       | matches files | matches dirs |
| ---------------------------------------------- | ------------- | ------------ |
| `resideInFolder('**/services/jwks-client*')`   | **1**         | 0            |
| `resideInFolder('**/routes/internal*')`        | **1**         | 0            |
| `resideInFolder('**/src/predicates/module**')` | **1**         | 0            |
| a genuine typo — `**/src/nonexistent/**`       | 0             | 0            |

Every real bug is a **folder glob pointed at a file**. The glob matches a file, so a file-level check passes it, while `resideInFolder` compares the _directory_ portion and selects nothing. The file-level check only catches pure typos, which is not the failure mode that keeps happening.

**The check must be per-predicate-semantics, not one global file test.**

### The check belongs to the predicate

Not to the rule. Each predicate is the only thing that knows what "matched
nothing" means for it, and the answers are opposite:

| Predicate                                                                          | Empty means                    | Verdict                                   |
| ---------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| `resideInFolder(glob)`                                                             | nothing resides in that folder | **fault** — always                        |
| `resideInFile(glob)`                                                               | no such file                   | **fault** — always                        |
| `havePathMatching(glob)`                                                           | no path matches                | **fault** — always                        |
| `slices().matching()` / `assignedFrom()` globs                                     | discovery found nothing        | **fault** — always (shipped, 0067-D)      |
| `extend('BaseRepository')`, `haveNameMatching(/x/)`, `areAsync()`, `areExported()` | possibly "none yet"            | may be legitimate → `.allowEmpty(reason)` |

A path predicate is an **assertion about the project's structure** — _this
folder exists and has things in it_. A semantic predicate is a **filter** — it
is allowed to select nothing. That is the same line 014 drew, moved to where it
can be enforced per-predicate and reported precisely.

**In a composite this is the whole point.** `resideInFolder(A).and().extend(B)`
collapsing to zero has two opposite causes, and an aggregate check cannot tell
them apart:

- A matches nothing → the glob is wrong → **fail**, naming A.
- A matches, B filters it to nothing → possibly "no repositories yet" → green,
  or `.allowEmpty(reason)` if the author wants it pinned.

Attributing the second to `resideInFolder` would cry wolf on precisely the
legitimate case, which is how a guard gets switched off.

### `resideInFolder` empty has two causes, and they need different messages

| Resolves to                                     | Cause                                                                               | Remedy                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| no path matches the glob                        | typo, or a project-relative glob where absolute is required                         | fix the glob                           |
| paths match, but zero **elements** of that kind | `classes()` over a folder of pure functions; or a **folder glob pointed at a file** | wrong entry point, or `resideInFile()` |

Both fail. The second is the one measured in both codebases, and it is the one
0067-C's file-level check silently passes.

---

## Three glob positions, not one

The first draft of this plan guarded only **predicate** globs. Probing found two
more positions, both live:

### Position 2 — globs inside conditions

A rule can have a perfect selector and still certify nothing, because the glob
that decides what the condition _matches against_ is wrong:

```
modules(p).that().resideInFolder('**/src/core/**')
  .should().notImportFromCondition(<glob>)

  '**/src/builders/**'   -> 1 violation   correct
  '**/src/buidlers/**'   -> 0             typo,      silent green
  'src/builders/**'      -> 0             unanchored, silent green
```

A real violation sat there uncaught in all three runs. **The subject funnel
below does not fire here** — `files>0, candidates>0, subjects>0, conditions=1`,
every stage healthy. This is an _assertion_ fault, not a _selection_ fault, and
it needs its own check: a glob argument to a condition that matches no project
path is as broken as one in a predicate.

Affected: `notImportFrom`, `onlyImportFrom`, `dependOn`, `onlyHaveTypeImportsFrom`,
`onlyBeImportedVia`, and the `ArchFunction` `resideInFile`/`resideInFolder`
condition forms.

### Position 3 — bare package specifiers, which cannot match at all

Filed separately as [bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md):
`notImportFrom('fastify')` compares the glob against the **resolved** path, so it
matches only when the package fails to resolve. Measured: `notImportFrom('ts-morph')`
reports 0 with ts-morph installed, 1 when the package is missing.

This one is **not** a guard question — the user wrote the documented, sanctioned
form and it cannot match by construction. No amount of failing loudly helps. It
is fixed at the matcher, and it establishes the ordering principle for
everything here:

> **First make the natural spelling work. Only then fail loudly when it still
> cannot match.**

0067-C reached the same conclusion for path normalization ("so `src/*` _works_
rather than just failing loudly — the root cause"). A guard that fires on a
spelling users were told to use is a guard they will switch off.

---

## Design — the funnel is the guard

Every rule runs the same pipeline. Each stage can collapse to zero, each collapse has a _different_ cause, and therefore a different remedy. The rule fails at whichever stage collapses, naming that stage.

```
files → candidates → subjects → conditions → violations
```

| Stage collapses to 0                          | What it means                              | Remedy stated in the failure                        |
| --------------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| **files** — glob matches no path at all       | the path does not exist as written         | fix the glob (and: file globs match absolute paths) |
| **files** — 0 dirs, ≥1 file, `resideInFolder` | **folder/file mixup**                      | use `resideInFile()`                                |
| **candidates** — files matched, no elements   | the entry point found nothing of that kind | wrong entry point, or the file is empty             |
| **subjects** — predicates rejected all        | semantic selection matched nothing         | fix the predicate, or `.allowEmpty()` if intended   |
| **conditions** — none registered              | the rule asserts nothing (proposal 019)    | add a condition after `.should()`                   |

This is the same funnel `census()` reports (`spike/0014`). **The diagnostic and the guard become one thing**, which also gives `census()` the consumer it currently lacks.

### The single opt-out

`.allowEmpty()` on the shared base class — one method, every builder:

```typescript
functions(p).that().resideInFolder('**/repositories/**')
  .allowEmpty('no repositories in this package yet')   // reason required
  .should().satisfy(...).check()
```

A **required reason**, following the `deferred(pattern, reason)` idea extracted from proposal 012. An unexplained opt-out is how this comes back.

### Absence conditions declare themselves

`notExist()` and friends set `Condition.emptyIsPass` (prototyped on `spike/0067c`), so `.should().notExist()` does not need an opt-out — zero subjects is its success state. `defineCondition(description, evaluate, { emptyIsPass })` gives third-party absence conditions the same. Without this, every user-written absence condition becomes permanently red with no escape.

### Coverage: every builder, not half

The guard goes on `TerminalBuilder` once, so it reaches `resolvers()`, `schema()`, the smells, `slices()`, `tsconfig()` and `correspondence()` — not just `RuleBuilder`'s six. **This is the whole lesson of bug 0013**: a guard on one of two hierarchies is a guard on half the product. Requires the single-root refactor from `spike/0014`.

---

## Phases

### Phase 1 — the funnel guard (breaking)

1. Land the single-root refactor (`spike/0014`, minus `census()` if it is still unwanted — the guard needs the root, not the accessor).
2. Mark path predicates with their glob and kind: an optional `pathScope?: { glob: string; kind: 'file' | 'folder' }` on `Predicate` (ADR-005-clean, no `as`).
3. In the shared evaluation path, before returning no violations for an empty result, walk the funnel and fail at the first collapsed stage with that stage's remedy.
4. `.allowEmpty(reason)` on `TerminalBuilder`; `Condition.emptyIsPass`; `defineCondition` option.
5. Findings carry `bypassFilters` (they report that a rule enforces nothing, so `.excluding()`/baseline must not silence them).

**Files:** `src/core/terminal-builder.ts`, `src/core/rule-builder.ts`, `src/core/predicate.ts`, `src/core/condition.ts`, `src/core/define.ts`, `src/predicates/*.ts` (path predicates), `src/conditions/{function,call,jsx,structural}.ts` (`emptyIsPass`).

### Phase 1b — condition globs

Same marker, applied to glob **arguments of conditions**. A condition whose path
glob matches no project path fails with its own remedy, independent of whether
the selector found subjects. Depends on bug 0014 landing first, so a bare
package name is a working spelling rather than a reported fault.

**Files:** `src/conditions/dependency.ts`, `src/conditions/reverse-dependency.ts`,
`src/conditions/function.ts`.

### Phase 2 — proposal 019, on the same mechanism

Replace `console.warn(...) + return []` at the five sites where a rule has subjects but no conditions. One implementation on the root, not five copies. This is the `conditions → 0` row of the funnel.

**Files:** `src/core/terminal-builder.ts` (+ delete the five warns).

### Phase 3 — fix our own 14 rules, as the acceptance test

**Important:** the Phase 1 guard does **not** catch our 13. `**/ts-archunit/src/**` matches ~250 files _in a correctly-named checkout_, so nothing fires in our CI — they are only vacuous elsewhere. This corrects what I wrote into bug 0011 and the ROADMAP, which claimed the flip supersedes 0011's own proposed fix. It does not.

They must be rescoped to be checkout-name-independent by construction — a predicate derived from the project's own tsconfig path, which bug 0011 measured as the only correct form (a glob breaks on paths containing glob metacharacters):

```typescript
const inOurSource = definePredicate<SourceFile>('reside in this project src/', (sf) =>
  sf.getFilePath().startsWith(`${path.dirname(p.tsConfigPath)}/src/`),
)
```

And `api/no-single-glob-predicates` gets `resideInFile`, which surfaces the live `havePathMatching` violation at `src/predicates/module.ts:97` — a decision, not a fix.

**Files:** `tests/archunit/arch-rules.test.ts`, possibly `src/predicates/module.ts`.

### Phase 4 — migration surface

CHANGELOG with the honest framing; `docs/` for `.allowEmpty()`; a `--format json` count so a team can triage before upgrading; the preset sweep.

---

## Test inventory

| Test                                                                      | Proves                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| each funnel stage fails with **its own** remedy, not a shared one         | ADR-008 rule 2; the 0.18.1 lesson about one hardcoded remedy |
| `resideInFolder` on a file path fails and says `resideInFile`             | the actual bug, in both codebases                            |
| a genuine typo fails and says the path does not exist                     | distinguishes the two faults                                 |
| a valid folder with no matching elements does **not** fail                | no false positive on the legitimate case                     |
| `.should().notExist()` on an empty selection stays green                  | absence conditions unbroken                                  |
| `.allowEmpty(reason)` silences it; without a reason it does not compile   | the opt-out is deliberate                                    |
| the guard fires for `resolvers()`, smells, `slices()`, `tsconfig()`       | **all** builders, not half                                   |
| a typo'd glob in `notImportFrom` fails, with a real violation present     | position 2 — the funnel cannot see this                      |
| an unanchored condition glob fails rather than passing silently           | position 2, the 0.18.1 anchoring bug in a new position       |
| a bare package name matches an **installed** package (bug 0014)           | the natural spelling works before anything fails loudly      |
| the whole arch suite run from a differently-named checkout is still green | Phase 3 — bug 0011 fixed by construction                     |

Every one to be verified by sabotage: revert the fix, watch it go red.

---

## Open questions for review

1. **`notExist()` with a path glob.** `.that().resideInFolder('**/legacy/**').should().notExist()` — if `legacy/` was deleted, the glob matches nothing. Is that a passing rule (the legacy code is gone, which is the point) or a stale rule to delete? The stage-1 guard fails it; `emptyIsPass` is a _condition_ property and does not reach a _path_ fault. Unresolved.
2. **Presets.** A preset rule that legitimately does not apply cannot call `.allowEmpty()` — the user did not write it. Today their only lever is `overrides: 'off'`, which loses the rule permanently if that layer later appears. Needs a third override value, or a per-rule preset policy.
3. **Blast radius.** Measured only on two codebases. The blunt version of this flip produced 10 failures here and 2 there; the funnel version should produce fewer false ones and more true ones, but that is a prediction, not a measurement. Phase 1 should be measured against both before it merges.
4. **Is `census()` in or out?** The guard needs the funnel. Exposing it as a public accessor is a separate decision that product recommended holding.
5. **Version.** Breaking. 0.20.0, or is this the 1.0 line?

---

## Out of scope

- **Bug 0012** (metric findings have no usable ratchet) — different mechanism, per-element thresholds.
- **[Bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md)** — a prerequisite, not part of this plan. Ships on its own; Phase 1b depends on it.
- **Path normalization** — 0067-C pairs this change with making `'src/*'` _work_ rather than only fail loudly. Worth doing, separable, and bundling two breaking changes is the 0.18.1 mistake.
- **`resolvers()`/`schema()` glob convention** — they match tsconfig-relative paths while every other glob matches absolute. Real inconsistency, not this plan's.
