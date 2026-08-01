# Bug 0033: `assignedFrom()` does not accept a project-relative glob, while everything beside it does

**Reported:** 2026-08-01
**Found in:** v0.35.0, by [plan 0067](../plans/completed/0067-empty-selector-safety.md) part C — measured while writing its docs
**Status:** **FIXED** 2026-08-01, released in **v0.36.1**.
**Severity:** Medium. Nothing is silently wrong: the miss is loud (`assignedFrom` reports "discovers nothing" and fails). The cost is that the glob language is no longer uniform, so a spelling learned in one place stops working in another.

## Description

Part C made the path predicates resolve a project-relative glob against the project root. Measured across every surface that takes a path glob, with `'src/domain/**'` against the same project:

| Surface                                                             | relative | anchored |
| ------------------------------------------------------------------- | -------- | -------- |
| `resideInFolder()` / `resideInFile()` / `havePathMatching()`        | ✅       | ✅       |
| `slices().matching()`                                               | ✅       | ✅       |
| Preset options routed through `atPath()` (`shared`, `repositories`) | ✅       | ✅       |
| **`slices().assignedFrom()`**                                       | **❌**   | ✅       |

`assignedFrom()` is the one holdout, and the layer options of `layeredArchitecture` discover through it, so `layers: { services: 'src/services/**' }` fails while `shared: ['src/shared/**']` in the same call works.

## Why it was left out

Part C's scope, from the plan's own text, is the three named path predicates. `assignedFrom` is **discovery**, not predicate matching: it resolves a glob to a set of slices, has its own non-vacuity guard (`emptyDiscoveryViolation`), and `matching()` — the sibling that does normalize — does it by a **third** mechanism again, rewriting the author's glob to an anchored form rather than resolving it against a root.

Three mechanisms for one concept is the shape worth fixing deliberately rather than by extending the newest one into the next caller.

## Fix

Decide the single mechanism first, then apply it to all three. The root-relative resolution in `core/project-relative.ts` is the most precise of the three — `'src/x/**'` names the root's `src/x` and nothing else — and `matching()`'s rewrite is the loosest, since `'**/src/x/**'` also matches a nested one. Aligning `matching()` onto the root-relative rule is itself a behaviour change and needs its own measurement.

## Guard

The property is uniformity, so the guard should be a **table test over the surfaces**, not one test per surface: for each way of writing a path glob, the relative and anchored spellings must both select the intended set. A per-surface test cannot fail when a _new_ surface is added without normalization, which is how this gap appeared in the first place.

## Related

- [Plan 0067](../plans/completed/0067-empty-selector-safety.md) part C — introduced the split.
- `docs/slices.md` documents the split as a table, so the docs are correct today and will be wrong the moment this is fixed.

## A second instance, found by the same measurement

`tests/docs/doc-globs-are-anchored.test.ts` classifies `assignedFrom` under `RELATIVE_ALLOWED` — "accepts a project-relative glob **by design**". It does not, and `docs/troubleshooting.md` says so on the same page the guard scans. So the guard currently permits an unanchored `assignedFrom` example that would be dead as written.

Not corrected with part C, because moving it to `ANCHORING_REQUIRED` would flag that page's **intentional** `// ❌ 0 files` counter-example. The guard needs to tell a counter-example from an example first. Both belong in this bug's fix, since both are the same misclassification.

## Fix as shipped

`resolveByDefinition` resolves a project-relative glob against the project root, by the same rule the path predicates use — the most precise of the three mechanisms, and the one that makes `'src/api/**'` mean _that folder at the root_ rather than any `src/api` at any depth.

**The root comes from the `ArchProject`'s own `tsConfigPath`**, not from ts-morph's recorded `configFilePath`. The predicates cannot do that — they see only an element, deliberately, so the builder and `.satisfy()` spellings cannot diverge — but the slice resolver holds the project. It matters: `configFilePath` is `undefined` for an in-memory project even when the `ArchProject` carries a good path, so normalization silently did not happen and the failure message then described a relative glob as "anchored but matched no file".

Two declaration sites moved with the behaviour, and both would have shipped a contradiction:

- the glob's declared `base` becomes `'normalized'`, so `doctor` stops calling a working rule dead. Measured before the change: a relative `assignedFrom` glob gave **0 violations and a `dead-glob` diagnosis in the same run** — the same runtime/diagnosis split plan 0067 C nearly shipped with `./`.
- the discovery failure message classifies faults against the same base. Otherwise a relative glob naming a **missing folder** is grouped `unanchored` and told to "prefix these with `**/`" — a remedy that changes a correct spelling and leaves the rule just as empty (ADR-008 rule 2).

### `matching()` was left alone, deliberately

This bug asked for one mechanism across three surfaces. Two now share the root-relative rule; `slices().matching()` still normalizes by **rewriting** the author's glob to an anchored form, which is _looser_ — `'src/x/*'` there matches a nested `src/x` too. Aligning it is a behaviour change that narrows existing matches, so it needs its own measurement and release, not a quiet ride along with a fix. The uniformity guard below covers the four surfaces that share the rule; `matching()` is out of its table for that reason.

### Guard

A **table over the surfaces**, as this report asked for, not one test each: a per-surface test cannot fail when a _new_ surface is added without normalization, which is exactly how this gap appeared. Each surface must select the root folder from a relative glob, agree with the absolute spelling **by count** (not merely both non-empty — a surface normalizing to "anywhere" would pass that), and still select nothing for an absent folder.

### Sabotage

**6 of 6.** One row initially scored MISSED — reverting the fault classification to the default base, which restores the false anchor advice — and two more skipped on anchors prettier had reflowed.
