# Plan 0085 — the slice graph cannot see a re-export

**Status:** **DONE** — shipped 2026-08-04 in v0.48.0. All three phases resolved: 1 and 2 implemented,
3 decided by measurement and filed as
[plan 0087](./0087-an-inline-type-import-still-requests-the-module.md). Filed 2026-08-04 from
[plan 0084](./0084-cycle-detection-that-ignores-type-only-imports.md), whose test-inventory row 4
assumed re-exports were edges and found they are not.
**Priority:** Medium-high. A false negative on three published conditions, and the shape it misses is
the single most common real-world cycle.
**Effort:** Small to implement, medium to ship. The edge collection is ~10 lines in one function; the
work is the second call site, the migration note, and deciding one genuinely open semantic question.
**Blast radius:** **Published API, and this one only ADDS findings.** Three exported conditions —
`beFreeOfCycles`, `respectLayerOrder`, `notDependOn` — will report violations they have never reported,
on codebases that are green today. That is the top row of [ADR-008](../../adr/008-agent-first-failure-surfaces.md)
rule 6, and it is a harder migration than 0084's: 0084 removed findings, this adds them.

## Problem

`collectEdgesFromFile` (`src/helpers/slice-graph.ts`) reads `file.getImportDeclarations()` and nothing
else. So no re-export is an edge:

```ts
export { createUser } from '../users/service.js' // runtime dependency. NOT an edge.
export * from '../users/service.js' // runtime dependency. NOT an edge.
export type { User } from '../users/types.js' // erased. correctly not an edge, by accident.
```

The first two are real runtime dependencies — the emitted JavaScript imports the module — and the graph
cannot see them.

**The shape this misses is the classic one.** A barrel file is built out of `export … from`, and
`a → barrel → a` is the cycle most codebases actually have. `beFreeOfCycles`' docstring says so
already, in the file, today:

> **The slice graph sees static `import` declarations only** … That matters most for the shape it
> misses: **a barrel re-export is _the_ classic cycle** … Deliberate, not an oversight (plan 0071, Out
> of scope): a cycle finding is the hardest class to remedy and belongs to its own upgrade story.

This plan is that upgrade story. Two things have changed since plan 0071 deferred it:

1. **The asymmetry is now visible inside one run.** `src/core/module-edges.ts` — used by
   `notImportFrom`, `dependOn`, `onlyImportFrom` — _does_ count re-exports, and `isTypeOnlyReExport`
   exists there for exactly this purpose. So `strictBoundaries` reports a barrel re-export as a
   cross-boundary violation while `no-cycles` reports the cycle it creates as absent. One run, two
   answers, same edge.
2. **The rule can now fail.** Plan 0084 moved `arch/no-cycles` to `.check()`. A false negative in a
   rule at `.warn()` costs nothing because the rule costs nothing; in a rule that gates a build it is
   a green that means nothing, which is ADR-008's whole subject.

### The gap is wider than the graph

`findSliceDependencyDetails` has the **same** blind spot, and it is not a duplicate of the first — it
is why fixing only the graph would change nothing:

```ts
const details = findSliceDependencyDetails(slices, edge.from, edge.to, fileToSlice)
for (const detail of details) {
  violations.push({ … })   // no details -> NO VIOLATION, even though the edge was found
}
```

`respectLayerOrder` and `notDependOn` both push one violation _per detail_. Add re-export edges to the
graph without teaching `findSliceDependencyDetails` about them, and those two conditions find the edge,
resolve zero details, and report nothing. `beFreeOfCycles` differs — it uses the first detail only for
the violation's file/line and reports the cycle regardless — so it would half-work, reporting cycles
located at `unknown:0`.

**Verify this claim before relying on it.** It is read off the code above, not measured, and the two
conditions have no test for a details-less edge.

## Phase 1 — one definition of an edge, used by both functions

Extend `collectEdgesFromFile` to walk `file.getExportDeclarations()` alongside imports, skipping
`isTypeOnlyReExport(decl)` when `ignoreTypeImports` is set, and do the same in
`findSliceDependencyDetails`. A bare `export { x }` with no `from` has no module specifier and falls out
at the existing `if (!resolved) continue`.

Better than doing it twice: `src/core/module-edges.ts` already defines a module's edges _including_
re-exports, with the type-only predicates beside it. Prefer making the slice graph consume that over
growing a second definition — plan 0071 was named "one definition of a module edge" and this is the
call site that never adopted it. Check whether `edgesOf()` gives what the graph needs before writing
new traversal.

## Phase 2 — the option on all three conditions, with the defaults argued

`respectLayerOrder` and `notDependOn` take no `ImportOptions` at all, so after 0084 there is a visible
inconsistency: `beFreeOfCycles` can ignore type-only edges and its two siblings cannot.

**They should accept the option and they should NOT share the default**, which is worth stating because
it looks like an inconsistency and is not:

- **Cycles** are about runtime module-initialization order. A type-only edge is erased and cannot
  contribute. Default `ignoreTypeImports: true`.
- **Layering and isolation** are about coupling. A type-only dependency on `legacy` is still a
  dependency on `legacy` — it will break when `legacy` is deleted, and "don't reach into that layer" is
  a design statement, not a runtime one. Default `false`, matching `dependOn`/`notImportFrom` as shipped.

Put that paragraph in the docs. A reader who notices the difference must find the reason next to it, or
they will file it as a bug — and a future maintainer will "fix" it.

## Phase 3 — the open question, decided

**Decided by measurement: the concern is real, and the fix is not this plan's.**

`import { type Alpha } from './a.js'` — emitted through ts-morph, same source, both settings:

| `verbatimModuleSyntax` | Emitted                    |
| ---------------------- | -------------------------- |
| `false`                | _(nothing — fully elided)_ |
| `true`                 | `import {} from './a.js';` |

The specifiers vanish, the **module request does not**, so under that flag the form is an eager edge
that can close a cycle and our graph drops it. The option is readable —
`project.getCompilerOptions().verbatimModuleSyntax` returned the right value in the same measurement —
so nothing is blocked on discovery.

What blocks it is the edge model: `ModuleEdge.typeOnly` conflates _erased bindings_ with _erased
statement_, and those are now known to be different questions. The fix **adds** a distinction rather
than changing `isTypeOnlyImport`, whose present meaning is correct for the four coupling conditions
that read it. Doing that here would be a semantic change to five conditions smuggled in under a
re-export fix — the thing this plan refused to do in Phase 2.

Filed as [plan 0087](./0087-an-inline-type-import-still-requests-the-module.md), which also has to
measure whether `export { type X } from 's'` shares the defect (**not** measured — export emit rules
differ from import emit rules, so it must not be assumed).

The caveat row in `tests/conditions/type-only-cycles.test.ts` now carries the measurement and names
0087 as its owner.

## Result

All three slice conditions now read `edgesOf()` — the definition plan 0071 wrote and this call site
never adopted. `import` and `reexport` count; `dynamic`, `require` and `type-expression` do not, each
for a stated reason.

`findSliceDependencyDetails` was fixed in the same change, and the plan was right that this mattered:
`respectLayerOrder` and `notDependOn` push one violation _per detail_, so a fixed graph with an unfixed
lookup would have found every re-export dependency and reported **nothing**. The plan flagged that
claim as read-off-the-code rather than measured — it held.

`notDependOn` and `respectLayerOrder` gained `ImportOptions` in the same two-overload shape as
`dependOn`, with the _opposite_ default to `beFreeOfCycles` and the reason documented beside both.

### Inventory row 8 was vacuous for us, which is the more useful finding

Row 8 said "our own suite is the end-to-end proof and may well surface new cycles in `src/`". It
surfaced none — and **not because the fix is inert**. Our three in-slice re-exports are all
_intra_-slice (`core → core`, `predicates → predicates`) and the graph skips same-slice edges by
design, so `arch/no-cycles` staying green says nothing about the new path in either direction.

The proof had to come from somewhere real, so it comes from `src/index.ts`: **90 re-exports, zero plain
imports**, meaning before this plan it had no edges at all and no slice rule could see it. It also
sits in none of `arch-rules.test.ts`' slices, which is why turning the rule on in plan 0084 could not
have caught this. A control row reads the file and asserts the zero-plain-imports property still holds,
because a single ordinary `import` would quietly route that proof back through the old code path.

### Sabotage

12 reverts enumerated from `git diff main...HEAD`, isolated worktree, asserted-green baseline, exit code
read unpiped. **12 of 12 caught — after five were caught by nothing on the first pass.**

| Revert                                               | First pass       | Now          |
| ---------------------------------------------------- | ---------------- | ------------ |
| Re-export edges dropped — only `import` counts       | CAUGHT (11 rows) | CAUGHT       |
| `dynamic` added to the counted kinds                 | **nothing**      | CAUGHT       |
| `type-expression` added to the counted kinds         | **nothing**      | CAUGHT       |
| Type-only filter no longer applied                   | CAUGHT           | CAUGHT       |
| Type-only filter made unconditional                  | CAUGHT           | CAUGHT       |
| Details lookup reads imports only again              | CAUGHT           | CAUGHT       |
| Details lookup stops receiving the graph's options   | **nothing**      | CAUGHT       |
| `notDependOn` stops passing options to the graph     | CAUGHT           | CAUGHT       |
| Builder drops options forwarding `notDependOn`       | CAUGHT           | CAUGHT       |
| Builder drops options forwarding `respectLayerOrder` | **nothing**      | CAUGHT       |
| `resolvedPath === undefined` guard removed           | **nothing**      | CAUGHT (tsc) |
| Same-slice edges no longer skipped                   | CAUGHT           | CAUGHT       |

What the five gaps had in common: **each was a decision recorded only in prose.**

- The two edge-kind exclusions were argued at length in a docstring. Adding `dynamic` or
  `type-expression` to the set left all 3025 tests green, so the argument was decoration.
- The details-lookup options gap hid because an _unfiltered_ lookup is a **superset**: the cycle is
  still located and nothing looks wrong. It only becomes visible where extra details become extra
  _violations_ (`notDependOn` reports per site) or where the extra detail is _first_ (the cycle's
  reported line moves to an erased import). Both are now rows; the second is filed as a Fixed entry
  because a finding pointing at an `import type` line asks the reader to delete a dependency that is
  not there.
- The `respectLayerOrder` option row asserted **the same expectation for both values of the option**,
  so it passed with the forwarding removed. A row that passes under every value of the thing it tests
  is testing nothing. Retitled to what it actually proves, with the real guard added beside it.
- The `resolvedPath` guard is caught by `tsc`, not by a test — a legitimate second derivation, since
  `typecheck` is its own step in `validate`. The harness reported it as unguarded because **it only ran
  vitest**. Fixed there too: it now runs both, and scores `CAUGHT (tsc)` distinctly.

### And the harness lied twice more

Both worth recording, because 0084 ended with the same lesson and it still was not enough:

1. **The summary counter used `not verdict.startswith("CAUGHT")`** — and `"CAUGHT BY NOTHING"` starts
   with `"CAUGHT"`. It printed **"NOT CAUGHT: 0 of 12"** directly beneath a row reading
   `CAUGHT BY NOTHING`. An aggregate that cannot express failure reports success, which is this
   project's subject applied to its own tooling for the third time in two plans.
2. A row crashed the run mid-matrix with `UnicodeDecodeError`: vitest's captured output split a
   multi-byte character. Rows after it never ran, and without the traceback that would have read as a
   short matrix rather than an aborted one.

## Test inventory

1. **A value re-export is an edge.** `a` re-exports from `b`, `b` imports `a` → one cycle, by identity.
   This row fails today and is the plan.
2. **`export * from` is an edge.** Separate row: `getNamedExports()` is empty for it, so it takes a
   different path through `isTypeOnlyReExport`.
3. **`export type { X } from` is not an edge** under the default, and **is** under
   `ignoreTypeImports: false` — the option proven in both positions on the re-export path specifically.
4. **A bare `export { x }` with no `from` is not an edge**, and does not throw.
5. **`respectLayerOrder` and `notDependOn` report a re-export-only violation** — the row that proves
   `findSliceDependencyDetails` was fixed too. Without it those two conditions find the edge and
   silently report nothing, which is a false green _introduced by this fix_.
6. **The existing "re-export is not an edge AT ALL" row in `type-only-cycles.test.ts` must be
   inverted**, not deleted. It is the marker plan 0084 left for this one; deleting it loses the record
   that the limit was known and deliberate.
7. **Baseline migration:** a cycle's identity when a re-export joins a slice to it, before and after,
   through `hashViolation`. Same reason as 0084 row 7 — adopters have baselines, and the entries will
   not match.
8. **Our own suite**, which is the end-to-end proof and may well surface new cycles in `src/`. If it
   does: fix them or waive them by identity with a filed reason. Do **not** widen the exclusion pattern
   already there, and do not return `arch/no-cycles` to `.warn()` — `gate()` no longer lets you, which
   is deliberate.

## Out of scope

- **File-granularity cycle detection.** Still a different feature.
- **Dynamic `import()` expressions.** Also an edge, also invisible, and a bigger question because they
  are usually _deliberate_ cycle breakers. Separate plan if it matters.
- **`export =` / CommonJS interop.** ESM-only package (ADR-004).

## Related

- [Plan 0084](./0084-cycle-detection-that-ignores-type-only-imports.md) — turned the rule on and found
  this; its test row 4 rested on the false premise that re-exports were edges.
- [Plan 0071](./0071-one-definition-of-a-module-edge.md) — deferred this deliberately, and
  named the principle the fix should follow.
- `src/core/module-edges.ts` — the definition that already handles re-exports.
- `src/helpers/slice-graph.ts` — the two functions that do not.
