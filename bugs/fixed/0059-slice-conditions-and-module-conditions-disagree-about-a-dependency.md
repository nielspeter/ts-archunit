# Bug 0059: slice and module conditions disagree about what a dependency is, in the same run

**Reported:** 2026-08-04 · **Fixed:** 2026-08-05, unreleased at time of writing

> **Fixed as filed, and then twice more.** The `QUESTIONS` table in `src/helpers/slice-graph.ts`:
> `'module-request'` keeps the eager static set, `'type-bindings'` reads `FORWARD_EDGE_KINDS` — the same
> constant `notImportFrom` and `dependOn` read, so the two families agree by construction rather than by
> two lists. Tests in `tests/conditions/slice-and-module-agree.test.ts`.
>
> One thing the report did not anticipate, found while writing the tests: the slice conditions were
> **already** per-kind on the message side. `Slice "feature" dynamically imports forbidden slice
"legacy"` comes from `edgeVerb(kind)`, which has carried a distinct verb for `dynamic` and
> `type-expression` since plan 0071. Only the graph's kind filter was holding those edges back.
>
> **But "the fix is one function" was wrong, and this note claimed it for a day.** Making those kinds
> reportable made an existing fail-open reachable: a finding's identity is `kind::specifier::names`, and
> `names` is empty wherever no name crosses the edge, so two lazy imports of one module from one file
> gave **2 findings and 1 hash**. `ModuleEdge.ordinal` closed that — and the first form of _that_ fix
> moved the identity of four ordinary `import`/`reexport` spellings (`import D from`,
> `import * as NS from`, bare `import './x.js'`, `export * from`) while three shipped sentences promised
> it had not, because `names` is empty for the SPELLING and not only for the KIND. The same 2/1 collision
> turned out to have been live in the **slice** family too, which this note previously said was
> unreachable there. Both closed by emitting an empty discriminator for the first edge of each group, so
> no baseline entry moves at all; `tests/conditions/identity-does-not-move.test.ts` enumerates all seven
> spellings against the identities v0.55.3 actually produces, and reverting the fix fails 9 of its 14 rows.
>
> The lesson is in the sequence, not the defect: three rounds, each fix guarded by a row that exercised
> only the case where its claim held. What broke the loop was enumerating from the **diff** and asserting
> against a **differently derived** value. Residual items are
> [plan 0094](../../plans/0094-the-residual-findings-from-the-v0-56-0-review.md).
>
> The `require` gap is **decided rather than left open**: no condition in either family counts it,
> which is consistent, and the limit is now stated in `docs/slices.md` where a user reads it rather
> than in a docstring. The test pins `FORWARD_EDGE_KINDS.require === false` so the decision cannot
> drift silently.
> **Found in:** v0.48.0
> ([plan 0085](../../plans/completed/0085-the-slice-graph-cannot-see-a-re-export.md)) — which closed this
> asymmetry for re-exports and left it open for two other edge kinds.
> **Severity:** Medium-high. A documented false negative on two published conditions, contradicted by a
> sibling condition on the same edge in the same run.

## What

`src/helpers/slice-graph.ts` shares one edge-kind set across all three slice conditions:

```ts
const EAGER_STATIC_KINDS = new Set<ModuleEdgeKind>(['import', 'reexport'])
```

and justifies it with a **cycle** argument: _"A slice graph answers 'what does this slice depend on when
the program starts', which is what makes a cycle a cycle."_ Plan 0087's whole insight is that cycles and
coupling are **different questions** — and the release split the _erasure_ predicate per question while
leaving the _kind_ set shared. So the cycle rationale now governs two conditions that are not about
cycles.

Measured. One file containing `export const load = () => import('../legacy/index.js')`:

```
slices(p).…should().notDependOn('legacy')                    -> 0 violations
modules(p).that().resideInFolder('**/feature/**')
          .should().notImportFrom('**/legacy/**')            -> 1 violation
```

Same file, same edge, same run. `type X = import('../legacy/x.js').Y` diverges identically:
`FORWARD_EDGE_KINDS` in `src/core/module-edges.ts` includes `type-expression`, so `notImportFrom` counts
it and the slice graph excludes it by kind.

This is [bug 0022](./0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md)'s
exact shape — two sites disagreeing about what an import is — re-opened one layer up by the release whose
changelog cites bug 0022 as the thing it closes.

## Why the rationale does not transfer

_"Reporting a dynamic import would fail the rule for applying its own remedy"_ is **true** for
`beFreeOfCycles`: `import()` is lazy, cannot deadlock initialization, and is often the deliberate fix for
a cycle.

It is **false** for `notDependOn('legacy')`. A lazy import of `legacy` is a forbidden dependency — it is
still coupling, it still breaks when `legacy` is deleted, and nobody is applying a remedy. Same for
`respectLayerOrder`: reaching up a layer through `import()` is the thing the rule exists to forbid.

`docs/slices.md` states the exclusion with the cycle rationale, so it is a _documented_ false negative.
That does not make it right when the sibling condition disagrees about the same edge.

## Fix

Make the kind set a function of the `question`, as the erasure predicate already is:

- `'module-request'` → `{ import, reexport }`. Eager only; a cycle is an initialization-order question.
- `'type-bindings'` → whatever `FORWARD_EDGE_KINDS` says. That constant already exists, already claims to
  be the one definition of "what a forward dependency site reports on", and already compile-errors when a
  sixth kind is added.

Reusing `FORWARD_EDGE_KINDS` rather than writing a second list is the point: it is what makes
`notDependOn` and `notImportFrom` agree **by construction** instead of by two lists someone must keep in
step.

`require` under `allowJs` is the remaining gap on the cycle side, recorded in the docstring and defensible
for an ESM-only package — but by this project's own standard (v0.48.0's changelog: _"two edge-kind
exclusions argued only in a docstring"_ were the sabotage misses) an unfiled gap is not acceptable. It is
part of this bug's scope: decide it explicitly or state the limit where a user reads it.

## Test inventory

1. **`notDependOn` reports a dynamic-import-only dependency**, by identity. Reds today.
2. **`respectLayerOrder` reports an upward dynamic import.** Reds today.
3. **`beFreeOfCycles` still does NOT** report a dynamic-only cycle — the discrimination, and the row that
   stops the fix from being "count everything everywhere".
4. **The same three rows for `type-expression`.**
5. **`notDependOn` and `notImportFrom` agree on every edge kind**, over one fixture carrying all five —
   the by-construction claim, asserted rather than argued.
6. **VACUITY: the fixture's dynamic import really resolves**, or rows 1–4 pass over an unresolvable
   specifier.

## Related

- [Bug 0022](./0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md) — the
  same defect one layer down.
- [Plan 0085](../../plans/completed/0085-the-slice-graph-cannot-see-a-re-export.md) — closed it for
  re-exports; this is the residue.
- `src/helpers/slice-graph.ts`, `src/core/module-edges.ts` (`FORWARD_EDGE_KINDS`).
