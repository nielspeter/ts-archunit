# Plan 0064 — Filtered-Subject Materialization on RuleBuilder (F1)

**Status:** Complete (implemented on branch `feat/f1-filtered-subjects`)
**Priority:** P1 — foundation keystone. Unblocks proposals 014 (`.expectNonEmpty()`) and 017 (`correspondence().side(selection, keyFn)`).
**Effort:** ~0.5 day
**Depends on:** none. **Blocks:** 017 (F1), 014 Layer 2.
**Context:** `plans/ai-era-product-direction.md` (F1); the architect reviews of 014 and 017 both identified this as the shared, unbuilt prerequisite.

## Problem

Two draft proposals need the same capability that does not exist: **materialize the subject set a rule would evaluate — the elements matched by the predicate chain (`.that()...`), before any condition runs.**

- 017 `correspondence().side(name, selection, keyFn)` must map each of a selection's filtered subjects to a key.
- 014 `.expectNonEmpty()` must know whether the filtered subject set is empty.

Before this change, predicate filtering happened only inside the **private** `evaluate()` (`src/core/rule-builder.ts`): it called `getElements()` (the _pre-filter_ population, `protected abstract`), applied `_predicates.every(...)`, computed `filtered`, and either returned `[]` or ran conditions. `filtered` was never exposed. `getElements()` is the wrong surface (unfiltered), and `evaluate()` returns `ArchViolation[]`, not subjects. So there was **no method, public or protected, returning the post-`.that()` subjects.** Both proposals had wrongly assumed this "reuses existing machinery."

## Design

One small, behavior-preserving refactor plus one public accessor.

### Phase 1 — extract the filter, expose it

Extract the predicate-filtering step into a protected `filterElements()` (the single place filtering happens) and add a public `subjects()`:

```typescript
/**
 * Materialize the subject set: all elements narrowed by the predicate chain
 * (the post-.that() set), before any condition runs. The single place
 * predicate filtering happens — shared by evaluate() and subjects() so the
 * two can never diverge.
 */
protected filterElements(): T[] {
  return this.getElements().filter((element) =>
    this._predicates.every((predicate) => predicate.test(element)),
  )
}

/**
 * Return the subject set this rule would evaluate: the elements matched by
 * the predicate chain, before any condition. Distinct from getElements()
 * (the pre-filter population). Does not evaluate conditions and never warns
 * about their absence, so it is safe on a bare .that() selection.
 */
subjects(): readonly T[] {
  return this.filterElements()
}
```

`evaluate()` now calls `filterElements()` for steps 1–2; every other line is unchanged, so all existing rules behave identically. `subjects()` deliberately does **not** run the "predicates but no conditions" warning — it is a materialization accessor, not execution.

### ADR notes

- **ADR-007 (engine boundary):** `subjects()` returns the builder's element type `T` (e.g. a ts-morph `ClassDeclaration` for `classes()`), so it is an **acknowledged raw-node seam** for callers that derive keys from subjects — the same seam 017's `keyFn` documents. This does not widen the boundary beyond what predicates/conditions already receive; it exposes it to user code deliberately, per the 017 design decision.
- **ADR-005 (no any/no as):** the refactor introduces no casts; `subjects()` is fully typed `readonly T[]`.
- **ADR-003 (fluent builder):** `subjects()` is a terminal-style accessor alongside `.violations()` — returns a computed result without throwing.

## Files changed

| File                              | Change                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/rule-builder.ts`        | Add `filterElements()` (protected) + `subjects()` (public); `evaluate()` uses `filterElements()`. No behavior change to existing rules. |
| `tests/core/rule-builder.test.ts` | New `.subjects()` describe block (6 tests).                                                                                             |

No `src/index.ts` change — `subjects()` is inherited by every entry-point builder that already extends `RuleBuilder`.

## Test inventory

`tests/core/rule-builder.test.ts` → `.subjects() (F1 …)`:

1. returns the predicate-narrowed set, by identity (name list)
2. ANDs multiple predicates
3. returns the full population when no predicate is set
4. returns empty when nothing matches **and does not warn** about missing conditions
5. subjects() equals the set a condition receives — one filter source, asserted by identity both directions with a vacuity guard (regression guard against evaluate()/subjects() drift)
6. reflects a named selection without `.should()` and does not mutate it

Full suite: **2058 passing**, typecheck + lint clean.

## Out of scope (separate plans)

- `.expectNonEmpty()` (proposal 014 Layer 2) — the fail-if-empty terminal built on `subjects()`.
- `correspondence()` (proposal 017) — consumes `subjects()` via `.side(selection, keyFn)`.
- User-facing docs for `subjects()` — ship with the first consumer (017/014), where it has a concrete use.
- Whether to narrow the ADR-007 raw-node seam (a key-extraction vocabulary) — deferred to 017's `keyFn` decision.
