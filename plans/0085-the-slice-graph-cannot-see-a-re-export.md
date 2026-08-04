# Plan 0085 — the slice graph cannot see a re-export

**Status:** Open, not started. Filed 2026-08-04 from
[plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md), whose test-inventory row 4
assumed re-exports were edges and found they are not.
**Priority:** Medium-high. A false negative on three published conditions, and the shape it misses is
the single most common real-world cycle.
**Effort:** Small to implement, medium to ship. The edge collection is ~10 lines in one function; the
work is the second call site, the migration note, and deciding one genuinely open semantic question.
**Blast radius:** **Published API, and this one only ADDS findings.** Three exported conditions —
`beFreeOfCycles`, `respectLayerOrder`, `notDependOn` — will report violations they have never reported,
on codebases that are green today. That is the top row of [ADR-008](../adr/008-agent-first-failure-surfaces.md)
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

## Phase 3 — the open question this plan owns

**Does `import { type Alpha } from './a.js'` create a runtime edge?** `isTypeOnlyImport` says no. Under
`verbatimModuleSyntax: true` the answer is **yes**: TypeScript emits `import {} from './a.js'`, dropping
the specifiers and keeping the module request, so the module is still evaluated and can still close a
cycle. Without the flag the import is elided and there is no edge.

So the correct answer depends on a compiler option we do not read. Recorded, with a test pinning
current behaviour, in `tests/conditions/type-only-cycles.test.ts`. Not changed in 0084 because
`isTypeOnlyImport` is shared with `dependOn`/`notImportFrom` and has had these semantics since v0.28.0
— changing it quietly under a cycle fix would be a behaviour change to four conditions smuggled in
under a fifth.

Deciding it needs: what `ts-morph` exposes for the effective `verbatimModuleSyntax`, whether the answer
should differ per condition (it plausibly should — see Phase 2's split), and a fixture project with the
flag on. If the conclusion is "leave it", say so in the docstring with the reason; a documented limit is
fine, an undocumented one is the thing this library is against.

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

- [Plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md) — turned the rule on and found
  this; its test row 4 rested on the false premise that re-exports were edges.
- [Plan 0071](./completed/0071-one-definition-of-a-module-edge.md) — deferred this deliberately, and
  named the principle the fix should follow.
- `src/core/module-edges.ts` — the definition that already handles re-exports.
- `src/helpers/slice-graph.ts` — the two functions that do not.
