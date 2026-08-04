# Plan 0087 — under `verbatimModuleSyntax`, an inline type import still requests the module

**Status:** **DONE** — shipped 2026-08-04 in v0.49.0. All three phases resolved, and Phase 3's
question ("does the re-export share the defect?") was measured rather than assumed: **it does**, exactly
parallel to the import. Filed 2026-08-04 from
[plan 0085](./0085-the-slice-graph-cannot-see-a-re-export.md) Phase 3, which was to _decide_ this
question and did — by measuring it and concluding the fix does not belong in that plan.
**Priority:** Medium-high. A false negative in cycle detection on a compiler setting that modern
TypeScript setups increasingly turn on, and `tsc --init` recommends.
**Effort:** Medium. Not the detection — the detection is two lines. The work is that the distinction
does not exist in the shared edge model yet, and five conditions read that model.
**Blast radius:** **Published API on five conditions.** `ModuleEdge.typeOnly` is consumed by
`beFreeOfCycles`, `respectLayerOrder`, `notDependOn`, `dependOn`, `notImportFrom` and
`onlyImportFrom`. Adding findings on a compiler-option-dependent basis means two projects with
identical source get different results, which has to be _stated_ rather than discovered. Top row of
[ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6.

## Problem, measured rather than reasoned

`import { type Alpha } from './a.js'` — no `import type` prefix, every named specifier inline-typed.
`isTypeOnlyImport` returns **true** for it, so the slice graph erases it under
`ignoreTypeImports: true`.

That is right under default elision and **wrong** under `verbatimModuleSyntax: true`. Measured through
ts-morph's own emit, both settings, same source:

| `verbatimModuleSyntax` | Emitted for `import { type Alpha } from './a.js'` |
| ---------------------- | ------------------------------------------------- |
| `false`                | _(nothing — fully elided)_                        |
| `true`                 | `import {} from './a.js';`                        |

The specifiers vanish; **the module request does not.** So the module is still evaluated at runtime, in
order, and it can close a cycle — while our graph says there is no edge. `import type { Alpha }` is
erased outright under both settings and genuinely never can.

The option is readable: `project.getCompilerOptions().verbatimModuleSyntax` returned `true`/`false`
correctly in the same measurement. So the information needed is available; what is missing is a place
to put it.

## Why plan 0085 did not fix it

`ModuleEdge.typeOnly` collapses "erased specifiers" and "erased module request" into one boolean, and
those are now known to be different questions. Fixing this means **adding** a distinction to the shared
edge model — not changing `isTypeOnlyImport`, whose current meaning is correct for the four dependency
conditions that ask "is this a type-level coupling".

Doing that inside 0085 would have been a semantic change to five conditions smuggled in under a
re-export fix, which is the shape 0085 explicitly refused. Hence this plan.

## Phase 1 — name the distinction in the edge model

Two booleans where there is one, on `ModuleEdge`:

- `typeOnly` — **unchanged meaning.** The bindings are type-level. This is what a coupling question
  wants, and changing it would move four conditions nobody asked to move.
- something like `erasesModuleRequest` — whether the _statement_ disappears entirely. True for
  `import type { X } from 's'` and `export type { X } from 's'`; true for `import { type X } from 's'`
  **only when `verbatimModuleSyntax` is off**.

Name it for what it means, not for the flag: a reader should not need to know what
`verbatimModuleSyntax` is to understand the field.

The compiler option has to reach `buildEdges`, which currently takes only a `SourceFile`.
`sourceFile.getProject().getCompilerOptions()` is available there — check what that costs per call
against the `edgesOf` cache before threading it as a parameter.

## Phase 2 — the slice graph asks the right question

`sliceEdgesOf` filters on `erasesModuleRequest` rather than `typeOnly`, because a slice graph models
eager module-initialization dependencies. The four dependency conditions keep asking `typeOnly`.

That split is the whole point and it should be stated in one place both sides link to: **cycles are
about whether the module is evaluated; layering is about whether the code is coupled.** They are
already documented as differing in their _defaults_
([plan 0085](./0085-the-slice-graph-cannot-see-a-re-export.md) Phase 2) — this makes them differ in the
_question_, which is a stronger claim and needs the same care.

## Phase 3 — decide whether a re-export has the same problem

`export { type X } from 's'` — inline-typed specifiers on a re-export. `isTypeOnlyReExport` treats it
as erased on the same "every specifier" rule, so it plausibly has the identical defect under
`verbatimModuleSyntax`. **Not measured.** Measure it the same way — emit under both settings — before
assuming it matches, because the emit rules for export declarations are not the same as for imports.

## Result

`ModuleEdge` now carries **two** fields where it carried one, and `typeOnly`'s meaning is untouched:

- `typeOnly` — the _bindings_ are type-level. The **coupling** question. Read by `dependOn`,
  `notImportFrom`, `onlyImportFrom`, the module predicates, and now explicitly by `notDependOn` and
  `respectLayerOrder`.
- `erasesModuleRequest` — the _statement_ vanishes, so the target is never evaluated. The
  **initialization** question, which is what a cycle actually is. Read by `beFreeOfCycles`.

`erasesModuleRequest` implies `typeOnly` — a statement cannot vanish while binding a runtime value —
and that invariant is asserted over every form at both flag positions rather than left as a claim.

### Phase 3, answered by measurement

The plan said not to assume the re-export matched the import, because export emit rules differ. It does
match, and the full table was measured through ts-morph's own emit before any code was written:

| form                          | `vms: false` | `vms: true`              |
| ----------------------------- | ------------ | ------------------------ |
| `import type { X } from 's'`  | erased       | erased                   |
| `import { type X } from 's'`  | erased       | **`import {} from 's'`** |
| `import { type X, y } from`   | requests     | requests                 |
| `export type { X } from 's'`  | erased       | erased                   |
| `export { type X } from 's'`  | erased       | **`export {} from 's'`** |
| `export { type X, y } from`   | requests     | requests                 |
| `export * from 's'`           | requests     | requests                 |
| `export type * as N from 's'` | erased       | erased                   |

**Exactly two spellings are flag-dependent**, and both are the "every specifier inline-typed" branch of
`isTypeOnlyImport` / `isTypeOnlyReExport`. That collapses the whole fix to one formula:
`erasesModuleRequest = typeOnly && (declaration has the type modifier || !verbatimModuleSyntax)`.

**One measurement was nearly wrong.** The first probe showed `import { type X, y }` as _erased_ under
`vms: false`, which would have made the fix much larger. It was an artifact: the value binding was
unused, and TypeScript elides unused value imports too. Re-run with the binding used, it requests the
module. A probe that conflates "type-erased" with "unused-elided" answers a different question than the
one asked.

### The question is now explicit at every call site

`buildSliceDependencyGraph` and `findSliceDependencyDetails` take a **required** `ErasureQuestion`. No
default — because a default here is the kind that is silently wrong for one of its two callers, and
there is no value that is right for both. `tsc` listed all six call sites the moment the parameter was
added, which is the point.

This also surfaced something the plan had not anticipated: `notDependOn` and `respectLayerOrder` live on
the _cycle_ graph but ask the _coupling_ question. Under the flag, `a → b` can be an eager edge whose
bindings are purely type-level — so `notDependOn(['b'], { ignoreTypeImports: true })` must report
nothing about the very edge `beFreeOfCycles` must report. One project, one edge, two correct and
opposite answers, asserted as its own row.

### Two builders, one constructor

`buildEdges` and `edgeStream` each spelled out the same field list. Both now route through one
`makeEdge()`, because `edgeStream`'s only consumer reads `typeOnly` — so a field wrong on the cold path
would not have surfaced until some future reader trusted it. Sabotage confirmed exactly that: building
`edgeStream`'s edges at the wrong flag was **caught by nothing**, and the guard that fixes it compares
the two builders field-by-field at both flag positions.

While writing `makeEdge` I reached for `literal.getText().slice(1, -1)` because the parameter was typed
`Node`. The module's own docstring forbids that in bold. Typed the parameter as `StringLiteral` and used
`getLiteralText()` — the fix the docstring asks for, and a reminder that a warning is only as good as the
next person's willingness to read it.

### Sabotage

14 reverts enumerated from `git diff main...HEAD`, isolated worktree, asserted-green baseline, exit code
read unpiped, typecheck scored alongside the tests. **14 of 14 caught**, after two rounds.

| Revert                                                             | Result                                              |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| `erasesModuleRequest` collapses back into `typeOnly`               | CAUGHT — 5 rows (and incidentally tsc)              |
| The flag is ignored, treated as always OFF                         | CAUGHT                                              |
| The flag is ignored, treated as always ON                          | CAUGHT                                              |
| An absent flag counts as ON (`=== true` → `!== false`)             | CAUGHT — the default matters, and it is off         |
| The import branch stops checking the declaration-level modifier    | CAUGHT                                              |
| The re-export branch stops checking the declaration-level modifier | CAUGHT                                              |
| A type _expression_ stops being erased                             | **nothing → fixed** (missing row in the table)      |
| Cycles ask the coupling question                                   | CAUGHT                                              |
| `notDependOn`/`respectLayerOrder` ask the cycle question           | CAUGHT                                              |
| The graph ignores the question, always reads `typeOnly`            | CAUGHT                                              |
| The graph ignores the question, always reads `erasesModuleRequest` | CAUGHT                                              |
| `edgeStream` builds edges at the wrong flag                        | **nothing → fixed** (the two builders now compared) |
| The ON fixture's tsconfig turns the flag off                       | CAUGHT — incl. the vacuity row                      |
| The OFF fixture's tsconfig turns the flag on                       | CAUGHT — incl. the vacuity row                      |

Both gaps were the same shape as 0085's: **a decision whose only witness was a comment.** The
type-expression exclusion is unobservable through the slice graph because that kind is excluded by kind,
and the cold edge path is unobservable because its one consumer reads the other field. Neither is
reachable from a rule today; both would be a trap for whoever reaches them first.

Two harness rows initially reported `PATCH FAILED` — the occurrence counts for `'module-request'` and
`'type-bindings'` were wrong because I forgot the explanatory comments contain the same literals. A
`PATCH FAILED` is a _loud_ failure and cost nothing; the same mistake with a permissive matcher would
have scored two silent CAUGHTs.

## Test inventory

1. **A fixture project with `verbatimModuleSyntax: true` on disk**, with its own tsconfig, in the
   style of `tests/fixtures/jsx-on-disk/`. In-memory options are not the configuration adopters have,
   and bug 0051 is what that lesson cost.
2. **`import { type X }` is a cycle edge with the flag ON**, by identity. The row that is currently a
   false negative.
3. **`import { type X }` is NOT an edge with the flag OFF** — the pairing, or the fix is just "count
   everything".
4. **`import type { X }` is not an edge under EITHER setting.** The control that keeps the fix from
   collapsing the two forms.
5. **`typeOnly` is unchanged for all four spellings**, asserted through `dependOn`/`notImportFrom`, so
   the four conditions that were not supposed to move are proven not to have moved.
6. **The re-export forms**, once Phase 3 has measured what they should do.
7. **The existing caveat row** in `tests/conditions/type-only-cycles.test.ts` — "EVERY specifier
   inline-typed is treated as type-only — with a caveat" — must be **updated, not deleted**. It is the
   marker this plan was left by, and it currently asserts the behaviour this plan changes.

## Out of scope

- **`isolatedModules`.** Different flag, different question, and it does not change emit this way.
- **Changing `isTypeOnlyImport`'s meaning.** Explicitly not this plan: four conditions depend on it
  meaning what it means.
- **`export =` / CJS.** ESM-only package (ADR-004).

## Related

- [Plan 0085](./0085-the-slice-graph-cannot-see-a-re-export.md) Phase 3 — asked the question, measured
  the answer, and scoped the fix out with the reason.
- [Plan 0084](./0084-cycle-detection-that-ignores-type-only-imports.md) — introduced
  `ignoreTypeImports` on cycles, where the wrong answer here becomes visible.
- [Plan 0071](./0071-one-definition-of-a-module-edge.md) — the edge model this extends.
- `src/core/module-edges.ts` — `ModuleEdge`, `buildEdges`, `isErased`.
- `src/core/import-options.ts` — `isTypeOnlyImport`, `isTypeOnlyReExport`.
