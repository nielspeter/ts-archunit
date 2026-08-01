# Bug 0033: `assignedFrom()` does not accept a project-relative glob, while everything beside it does

**Reported:** 2026-08-01
**Found in:** v0.35.0, by [plan 0067](../plans/completed/0067-empty-selector-safety.md) part C — measured while writing its docs
**Status:** OPEN
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
