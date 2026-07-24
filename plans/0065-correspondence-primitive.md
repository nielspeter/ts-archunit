# Plan 0065 — Correspondence / Coverage Primitive (proposal 017)

**Status:** Complete (implemented on branch `feat/f1-filtered-subjects`)
**Priority:** P2 — the flagship primitive answering the two largest cmless bug clusters (route↔matrix drift, phantom limits; ~24 bugs). Proposal 017.
**Effort:** ~1 day
**Depends on:** plan 0064 (F1 — `RuleBuilder.subjects()`). **Builds on / reconciles:** `crossLayer`.
**Context:** `proposals/017-correspondence-coverage-primitive.md` (draft 2), `plans/ai-era-product-direction.md` (F2).

## Problem

"Every X has a matching Y" is a first-class architectural relation the DSL could not state — every entry point selects one set and asserts a property of its members. The drift that ships is relational: a route with no permission-matrix entry, a declared limit no code enforces. cmless hand-rolled this twice (`sdk-coverage.test.ts`, `limits-enforcement-completeness.test.ts`), one certifying coverage with a `mapCount === permCount` **cardinality** check — the exact ADR-008 Rule 5 anti-pattern.

## Design

Three pieces, built on plan 0064's `subjects()`.

### F2 — `setCorrespondence()` (`src/core/correspondence-core.ts`)

Pure, engine-neutral: compares two key sets by **identity** (`missing = A\B`, `orphans = B\A`) and flags empty sides. No counts. The shared core behind both `correspondence()` and `crossLayer`'s existence check, so the two "every X has Y" engines cannot drift and neither can green on an empty side.

### `correspondence()` builder (`src/builders/correspondence-builder.ts`)

Extends `TerminalBuilder` (inherits `.rule`/`.excluding`/`.check`/`.warn`/`.violations`). Chain:

```typescript
correspondence(p)
  .side('routes', calls(p).that().onObject('app'), byArg(0)) // selection + keyFn
  .side('matrix', Object.keys(ROUTE_PERMISSIONS)) // pre-derived keys
  .should()
  .beComplete() // A ⊆ B — else FAIL naming the uncovered A keys
  .andShould()
  .haveNoOrphans() // B ⊆ A   (.beBijective() = both)
  .rule({ id, because, suggestion })
  .check()
```

- **`.side(name, selection, keyFn)` | `.side(name, keys)`** — a selection is materialized via `subjects()` (F1) and keyed by `keyFn`; a keys side is a pre-normalized `string[]`/`Set`. Overloads make a keyFn on a keys side a type error (keys are pre-normalized).
- **Identity, never cardinality** — the API exposes no count; the `mapCount===permCount` bug is unwritable.
- **Non-vacuity (ADR-008)** — an empty side fails (it is the root cause; the coverage flood is suppressed); `.allowEmpty(name)` opts out.
- **`.distinctKeysOn(name)`** — fail if a side maps two distinct subjects to one key (over-normalization masks a real mismatch).
- **Independence footgun** — both-literal sides `console.warn` (two hand-lists guard nothing).
- **keyFn** is a documented ADR-007 raw-node seam plus a `byName` / `byArg(i)` / `byPropertyNames` vocabulary. file:line attaches across raw ts-morph nodes (`Node.isNode`) and model wrappers (`getNode()`) with no `as` casts.

### `crossLayer` reconcile (`src/conditions/cross-layer.ts`)

`haveMatchingCounterpart` now computes its unmatched-file diff via `setCorrespondence` (shared F2) **and fails when the left layer matched zero files** — previously a vacuous green (ADR-008). Non-empty-layer behavior is byte-identical; `crossLayer`'s pairwise-content conditions (`haveConsistentExports`, `satisfyPairCondition`) are untouched.

### ADR notes

ADR-005: no `any`/`as` — the location adapter uses `Node.isNode` + a `getNode` type guard; typed errors (`TypeError`/`RangeError`) for precondition failures (caught in-flight by the project's own dogfooded "no generic Error" rule). ADR-006: generic primitive; the cmless rules are compositions, not baked in. ADR-003: fluent, extends `TerminalBuilder`. ADR-007: `keyFn` is the one acknowledged raw-node seam.

## Files changed

| File                                            | Change                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/core/correspondence-core.ts`               | New — `setCorrespondence()` (F2).                                                                    |
| `src/builders/correspondence-builder.ts`        | New — `correspondence()`, `CorrespondenceBuilder`, `byName`/`byArg`/`byPropertyNames`.               |
| `src/conditions/cross-layer.ts`                 | `haveMatchingCounterpart` reconciled onto F2 + non-vacuity.                                          |
| `src/index.ts`                                  | Export `correspondence`, builder, vocabulary, `setCorrespondence`, types.                            |
| `tests/core/correspondence-core.test.ts`        | 7 tests.                                                                                             |
| `tests/builders/correspondence-builder.test.ts` | 20 tests (logic, non-vacuity, collision, warn, errors, metadata, vocabulary, real-project location). |
| `tests/builders/cross-layer-builder.test.ts`    | +1 test — empty left layer now fails.                                                                |

Full suite: **2086 passing**, typecheck + lint clean.

## Out of scope (follow-ups)

- User-facing docs page for `correspondence()` (docs/ + VitePress nav).
- Extracting `byName`/`byArg`/`byPropertyNames` into a shared matcher module if reused elsewhere.
- The phantom-limit "flows-into-reject" value-flow variant (proposal 017 §honest limits) — v2.
- Whether `crossLayer` needs its own `.allowEmpty()` for a legitimately-empty layer (none observed; add on demand).
