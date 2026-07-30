# Plan 0071 — Forward dependency conditions see every module edge

**Status:** **0.27.0 SHIPPED** (2026-07-30) — the three instruments are released; §Test inventory items 1-3 are done, with 29 tests and a 15-revert sabotage matrix. **0.28.0 — the widening — is the remaining work**, and DRAFT 4 is its spec. Drafts 1–3 each had claims measured wrong; that history is in this branch's commit messages and in the two bug files, not here. **Draft 4 exists because two independent reviewers, working from opposite ends, found the same thing: item 7 — the release's headline guard — was green with bug 0022 fully reinstated.**
**Priority:** High. [Bug 0022](../bugs/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md) is a false green in the enforcement itself: `export { x } from '…'` and `import('…')` cross every banned edge unflagged.
**Closes:** bug 0022. [Bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md) is **out of scope** — its option 1 is refuted and the evidence lives in that file.

**Two releases, deliberately:**

|                             |                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **0.27.0 — instruments** ✅ | `--changed` discloses what it filtered; `baseline` prints the delta it accepted; `docs/upgrading.md` — **shipped 2026-07-30** |
| **0.28.0 — the widening**   | `moduleEdges`, the four forward conditions, the two predicates, the reverse-graph consumers, per-kind messages                |

Instruments first, because an adopter's **pre-upgrade** measurement must be trustworthy before the thing it measures changes. Same shape as 0.22.0 → 0.23.0. Cost: one extra bump, and the fix slips a release — cheap against shipping a migration path that cannot be relied on.

## Problem

`src/conditions/dependency.ts` collects edges from `sf.getImportDeclarations()` at five sites — static `import` statements and nothing else. The reverse graph indexes static imports, re-exports **and** dynamic imports, so `onlyBeImportedVia('…')` sees a re-export as an import and `notImportFrom('…')` does not.

### The bar

Blinding `onlyImportFrom` + `notImportFrom` to collect no edges — ADR-008's "completely broken" floor. Reproduced in five isolated worktrees, and the last two rows reproduced independently by a reviewer who also widened through a real `moduleEdges` including §4's per-kind verbs:

|                                                                |                                |
| -------------------------------------------------------------- | ------------------------------ |
| Baseline                                                       | 2479 passed / 176 files        |
| Both conditions collecting nothing                             | **38 failed**, 12 files        |
| `tests/archunit/arch-rules.test.ts` (18 of the affected sites) | **39/39 passed — zero caught** |
| Widening to all edge kinds                                     | **2479 passed — zero changed** |

The 38 come from 12 files, concentrated in four: `tests/presets/boundaries-folder-level.test.ts` (7), `tests/conditions/bare-package-imports.test.ts` (7), `tests/integration/module-rules.test.ts` (5), `tests/conditions/dependency.test.ts` (5).

Widening was verified non-trivial first: **643 static declarations → 801 edges over `src/`** (+24.6%), `src/index.ts` 0 → **114**.

So 1.5% of the suite distinguishes "collects static imports" from "collects nothing", and **0 of 2479** distinguishes it from "collects everything". The suite pins that the loop runs, never what it collects. **The test surface is most of the work.**

## §1 One walk, `src/core/module-edges.ts`

`SourceFile.getImportStringLiterals()` returns one literal per module specifier across every edge-carrying form. Measured, 20 forms:

| Form                                                                                                                        | literal? | parent kind                   |                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- | --------------------------------------------------------------------- |
| `import { x } from 's'`, `import type { X }`, `import { type X as X2 }`                                                     | 1        | `ImportDeclaration`           |                                                                       |
| `import 's'` (side-effect), `import {} from 's'`                                                                            | 1        | `ImportDeclaration`           | runtime, 0 named specifiers                                           |
| `import * as NS from 's'`, `import D from 's'`                                                                              | 1        | `ImportDeclaration`           | runtime binding, **contributes no `names`** — see the field docs      |
| `export { x } from 's'`, `export { x as y } from 's'`, `export * from 's'`, `export * as NS from 's'`, `export {} from 's'` | 1        | `ExportDeclaration`           | runtime                                                               |
| `export type { X } from 's'`, `export { type X } from 's'`, `export type * from 's'`                                        | 1        | `ExportDeclaration`           | type-only — §2                                                        |
| `import('s')`                                                                                                               | 1        | `CallExpression`              |                                                                       |
| ``import(`s`)``                                                                                                             | 1        | `CallExpression`              | **`NoSubstitutionTemplateLiteral`** — hazard below                    |
| `type A = import('s').X`                                                                                                    | 1        | `LiteralType`                 |                                                                       |
| `import x = require('s')`                                                                                                   | 1        | **`ExternalModuleReference`** | **runtime**                                                           |
| `require('s')` in `.js` under `allowJs`                                                                                     | 1        | `CallExpression`              | **runtime, indistinguishable from `import()` by parent kind**         |
| ``require(`s`)`` in `.js` under `allowJs`                                                                                   | 1        | `CallExpression`              | `NoSubstitutionTemplateLiteral` **and** `require` — both hazards      |
| `require('s')` in `.ts`                                                                                                     | 0        | —                             |                                                                       |
| `declare module 's' {}`                                                                                                     | 0        | —                             | correctly not an edge — but only when the body is **empty**, below    |
| `import('./' + n)` (computed)                                                                                               | 0        | —                             | not an edge for **any** family                                        |
| `export { x as y }` (no specifier)                                                                                          | 0        | —                             |                                                                       |
| `declare module './rel.js' { … }`                                                                                           | 0        | —                             | **a hole**, not a correct exclusion — routed to `moduleAugmentations` |

**Two classification traps**, both of which would mark a _runtime_ dependency as erased:

- **`import x = require('s')`** — parent `ExternalModuleReference`, grandparent `ImportEqualsDeclaration`. A 4-way branch ending in `else → 'type-expression'` gives it `typeOnly: true`, exempt under `ignoreTypeImports`. Common in hand-written `.d.ts`.
- **`require()` in `.js`** — the binder collects it into `sourceFile.imports` with parent `CallExpression`. Discriminate with `callExpr.getExpression().getKind() === SyntaxKind.ImportKeyword`, as the reverse graph already does.

**Type hazard:** ``import(`./x.js`)`` yields `NoSubstitutionTemplateLiteral`, for which `Node.isStringLiteral()` is **false**, while `getImportStringLiterals()` is declared `StringLiteral[]`. ADR-005 forbids `as`, so an implementer narrowing defensively drops the edge and typecheck says nothing. `getLiteralText()` typechecks and works on both. Guarded by identity, item 4.

**A second hole in the recorded family.** `declare module 'some-pkg' { import type { Deep } from './impl.js' }` in a `.d.ts` yields **zero** literals while `getDescendantsOfKind(ImportDeclaration)` yields one. So the table row `declare module 's' {}` → "correctly not an edge" is correct only for an empty body. Weaker than `declare module './rel.js'` — TS refuses to resolve the relative specifier inside an ambient body anyway — and the common real shape, a top-level `import type` beside `declare module 'express' { … }` in a normal `.ts`, **is** visible. Stated in Out of scope.

```ts
// src/core/module-edges.ts — the return type is ts-morph-free by construction.
export type ModuleEdgeKind = 'import' | 'reexport' | 'dynamic' | 'type-expression' | 'require'

export interface ModuleEdge {
  readonly kind: ModuleEdgeKind
  /** The specifier as written. */
  readonly specifier: string
  /** Resolved absolute path, when the compiler resolved it. */
  readonly resolvedPath: string | undefined
  /**
   * 1-based line of the statement carrying the edge. Equals
   * `decl.getStartLineNumber()` for `kind === 'import'`: 88 of this repo's 1751
   * import declarations (5.0%) put the specifier on a different line from the
   * keyword, so keying off the literal moves 5% of reported lines. Not a
   * baseline concern — `hashViolation` never sees the line — but it drives the
   * code frame and the GitHub annotation position. The same is true per kind:
   * a multi-line `export { … } from` and a multi-line `import(…)` both move,
   * which is why item 8's fixture carries a multi-line row for every kind.
   */
  readonly line: number
  /** Erased at compile time, so no runtime dependency. Per-kind; see §2. */
  readonly typeOnly: boolean
  /**
   * Named bindings crossing the edge.
   *
   * **The name, not the local binding** — and the two differ per kind:
   *   - `reexport`: the **outward** name, `getAliasNode() ?? getName()`. For
   *     `export { INNER as OUTER } from 's'` this is `OUTER`, because that is
   *     the key the barrel's runtime namespace carries and item 7 compares
   *     against a runtime namespace.
   *   - `import`: the **inward** name, `getName()`. For `import { c as d }` this
   *     is `c` — the name crossing the edge, not the local binding `d`.
   *
   * **Empty for `export *`.** Not because the names are unknowable: measured,
   * `sf.getExportSymbols()` flattens `export *` in a single call, and on a
   * circular pair the compiler and the Node runtime independently produce the
   * same answer. Nothing is recursive. It is empty for two different reasons:
   *   1. it cannot separate an erased re-export from a runtime one — `export
   *      type { X } from` and `export { X } from` both come back with
   *      `SymbolFlags.Alias` and a single `ExportSpecifier`, indistinguishable
   *      without `getAliasedSymbol()` per name; and
   *   2. it includes names with no runtime existence at all — a `declare module
   *      './star-src.js' { export const INJECTED: number }` augmentation
   *      anywhere in the project injects `INJECTED` here.
   *
   * (`symbol.getExports()` does **not** flatten — it hands back a synthetic
   * `__export` member. The obvious call gives the unflattened view.)
   *
   * **`export * as NS from 's'` is NOT a star edge for this purpose**: it
   * contributes exactly one name, `NS`, statically, with no recursion. And
   * `isNamespaceExport()` returns **true for both** star forms — measured — so
   * `getNamespaceExport()` is the only discriminator.
   *
   * Also empty for `dynamic`, `require`, and for a default or namespace
   * `import` binding (`import D from 's'`, `import * as NS from 's'`), which
   * cross an edge under a name the specifier list does not carry.
   */
  readonly names: readonly string[]
}

/** Every module edge leaving each file, in one call (ADR-007 rule 2). */
export function moduleEdges(
  files: readonly SourceFile[],
): ReadonlyMap<string, readonly ModuleEdge[]>
```

**Resolution is uniform: `lit.getSymbol()`.** Measured across all five parent kinds, with `paths` aliases and bare packages, and it returns the **named** module — `type A = import('./barrel.js').Deep` resolves to `barrel.ts`, where following the type symbol instead lands on `impl.ts` and would make `notImportFrom('**/impl.ts')` fire on a file that never names `impl`. One mechanism, no per-kind branch, no `getType()` call.

**Getting a path out of the symbol is not `getDeclarations()[0]`.** Measured: with `import { STAR } from './star-src.js'` and another file augmenting `'./star-src.js'`, the symbol has **two** declarations — the `SourceFile` and a `ModuleDeclaration` in the augmenting file. `[0]` happens to be the SourceFile here, but that is a compiler merge-order artefact: ts-morph's own `ModuleUtils.getReferencedSourceFileFromSymbol` takes `declarations[0]` and **bails to `undefined`** when it is not a SourceFile, so the reference implementation in the same library treats the other ordering as live. If `resolvedPath` lands on the augmenting file, `notImportFrom('**/augment.ts')` fires on a file that never names it. Use `sym.getDeclarations().find((d) => Node.isSourceFile(d))` — at most one exists, and it is the ADR-005-clean narrowing. **Invisible on this repo**: every unaugmented case measures one declaration, so only a dedicated fixture shows it.

**No `candidates` field** — it is `candidatesFor(specifier, resolvedPath)`, so storing it beside its two inputs is two representations of one fact. Expose the function.

**No cache, and the honest number is a range.** Draft 3 said ~17%. That was measured on a **resolve-only** pass; the pass §1 actually specifies — kind classification, `typeOnly`, `names`, `line`, the SourceFile-declaration filter and the `ReadonlyMap` — measures 9.6–17.1ms warm over 471 files (1914 edges), a 1.8× spread across rounds. Re-running the same arithmetic over `strictBoundaries`' 1665 file-visits: **34–40ms, 25–29%** against a 137ms preset baseline. Understated by 1.4–1.7×.

The decision still holds, and on a better argument the draft did not make: cold, the first `getSymbol()` on this project costs **143ms**, and the incumbent `getModuleSpecifierSourceFile()` costs the same order (131ms cold / 6.4ms warm vs 92ms cold / 6.7ms warm). **The incremental cost of the new mechanism over the old is near-zero; the absolute cost is checker warm-up today's code already pays.** Quote the range, not a point.

Two shapes to name in the changelog, not one. The worst case (527ms, 4.8×) needs rules whose selector spans the whole project — `modules(p).should().notImportFrom(…)` with no `.that()`, legal and in the docs' own examples. The second is `.that().importFrom(…)` / `.that().notImportFrom(…)` in **predicate** position, which walks every file one at a time (§3) and is on `docs/api-reference.md:98`. The fix in both places is a cache of _resolution_, not of the walk.

**The bulk signature does not fit the predicate site, and that is a stated cost, not an oversight.** `Predicate<T>` is `test(element: T): boolean` — one element — so the predicate must call `moduleEdges([sf])`: 471 calls on a project-wide rule. This is **not** the N-crossings problem ADR-007 rule 2 addresses: the walk has no per-project setup, so N calls of one file cost the same total as one call of N files, and the checker warm-up is shared. What it forecloses is batching the _resolution_ cache later. Six call sites in two shapes; say so rather than implying five in one.

**Location:** `src/core/`, not `src/core/engine/`. 60 files under `src/` import ts-morph, so a one-module boundary is cosmetic. The ts-morph-free **return type** is the genuine ADR-007 rule 2 down-payment.

## §2 The `typeOnly` contract

`import type` is a full edge today; the only exemption is `{ ignoreTypeImports: true }`. **That is preserved for `kind === 'import'`.**

| Kind              | Rule                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import`          | **Reuse `isTypeOnlyImport` unchanged.** Its `getDefaultImport()`/`getNamespaceImport()` guards are load-bearing: `import React, { type FC } from 'react'` is a **runtime** edge, and a formula without them classifies it type-only and skips it under `ignoreTypeImports` — a lost existing finding                          |
| `reexport`        | New `isTypeOnlyReExport`: `decl.isTypeOnly() \|\| (namedExports.length > 0 && namedExports.every(isTypeOnly))`. **Both halves needed** — `export type { X as XT } from` has decl `true`/specifiers `false`; `export { type X as XI } from` has decl `false`/specifiers `true`. No default/namespace analogue exists, verified |
| `dynamic`         | Always runtime                                                                                                                                                                                                                                                                                                                |
| `type-expression` | Always erased                                                                                                                                                                                                                                                                                                                 |
| `require`         | Always runtime                                                                                                                                                                                                                                                                                                                |

Every row of this table was independently re-measured and holds. **`isTypeOnlyImport`'s guard is now pinned only by item 5** — see item 15's rescope.

`onlyHaveTypeImportsFrom` (`:227`) has **no `ImportOptions` overload**, unlike its three siblings. **Pin the asymmetry, do not fix it here:** adding an overload in the release that also widens the condition changes one signature's meaning twice, and `ignoreTypeImports: true` on a type-imports-only condition is near-contradictory. Say that in the JSDoc.

## §3 Per-site disposition

| Site                                                      | Disposition                                                                                       | Direction                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------- |
| `onlyImportFrom` (:57)                                    | all edge kinds; `typeOnly` exempt only under `ignoreTypeImports`                                  | green→red, monotone             |
| `notImportFrom` **condition** (:105)                      | same                                                                                              | green→red, monotone             |
| `notImportFrom` **predicate** (`predicates/module.ts:18`) | same edge set as the condition                                                                    | **subjects LOST** — see below   |
| `importFrom` **predicate** (`predicates/module.ts:50`)    | same edge set                                                                                     | **subjects GAINED** — see below |
| `dependOn` (:155)                                         | **new kinds require runtime; `kind === 'import'` unchanged** — see below                          | red→green, new kinds only       |
| `onlyHaveTypeImportsFrom` (:235)                          | `import` + `reexport`; **excludes `dynamic`**; per-kind remedy — see below                        | green→red, monotone             |
| `notHaveAliasedImports` (:196)                            | **not routed through `moduleEdges`.** Keeps `sf.getImportDeclarations()`, reason in its docstring | none                            |
| `require` kind — every site                               | **excluded, by an exhaustive `switch`** — see below                                               | none                            |
| `reverse-dependency.ts` (:77-100)                         | replace all three collectors; delete `resolveDynamicImport`; dedup on `(importer, target)`        | mixed                           |

Measured on this repo: `no-cross-boundary` 289 → **292**, `shared-isolation` 80 → **94**, `innermost-isolation` 20 → **21**, **0 findings lost**, 0 messages or lines changed for pre-existing findings.

**But that measurement cannot see the predicates, and they run in opposite directions.** `importCandidatePaths` (`predicates/module.ts:16`) has **two** consumers, and draft 3 named one:

- **`notImportFrom`** (`:78`) is **anti-monotone** — a file with a matching re-export now fails the predicate and drops out of the selection, so rules select **fewer** subjects and report **fewer** findings. The dual-role method at `src/builders/module-rule-builder.ts:122` dispatches to the predicate before `.should()` and the condition after: one identifier, two definitions, chosen by chain position. That is this plan's Problem statement inside one method name.
- **`importFrom`** (`:50`) is **monotone-increasing** — more subjects match, more findings. It is public (`src/index.ts:90`), a builder method (`module-rule-builder.ts:106`), documented, and used in this repo's own tests as `.that().importFrom('**/infra/**').should().notExist()`. It appeared nowhere in draft 3.

So **monotonicity is a condition-layer property only, and the predicate layer has two directions**. This repo's dogfood rules use `notImportFrom` in condition position 16 times and predicate position **zero**, so "0 findings lost" was measured on a corpus that structurally cannot show the loss. Item 14 asserts a deliberately lost subject; item 21 the gained one.

**Also check `src/core/glob-site.ts:132` and `:185`**, which both pin `importFrom(...globs)` semantics into plan 0069's emptiness machinery. A widened predicate changes which globs are "never exercised".

**`dependOn`: only the new kinds require runtime.** Measured — today an `import type` of the target **satisfies** `dependOn`, and `{ ignoreTypeImports: true }` already makes it fail:

```
dependOn('**/src/security/**')  with only an import type    ->  0 violations (satisfied)
dependOn([...], { ignoreTypeImports: true })  same fixture  ->  1 violation
```

So requiring runtime for `kind === 'import'` would be a green→red change to an existing contract **that already has an opt-in** — a docs gap, not a behaviour gap. What this release must not do is _create_ a new false green: `export type { SecurityConfig } from './security-middleware.js'` satisfying `dependOn('**/security/**')` while the server installs nothing. Measured against `docs/modules.md`'s own teaching example, a naive widening turns a real violation into a pass — and on the baseline side that reads as "the violation was fixed", which 0.24.0's table calls success.

So: `reexport`, `dynamic` and `type-expression` count only when runtime; `import` behaves exactly as today. `typeOnly` therefore means something per-kind on this one condition — say it in the JSDoc, which is **rewritten, not deleted**, since it is the only place a reader learns what a `dependOn` green means. Note `dependOn` is not a builder method: it is reached via `.satisfy(dependOn(…))`.

**`onlyHaveTypeImportsFrom` excludes `dynamic` but keeps `reexport` — and draft 3's own argument said otherwise.** Draft 3 justified the `dynamic` exclusion on ADR-008 rule 2 with a clause that argues equally against `reexport`: the preset's remedy _"Use `import type { X }` so the dependency is erased"_ cannot be followed for `await import(…)`, "and which for a re-export (`export type`) would delete the runtime re-export and change what the module publishes." The row nonetheless included `reexport`. Resolved, and the resolution is not to exclude it:

- For **`dynamic`** there is **no** remedy that preserves behaviour. You cannot erase an `await import(…)`. Excluded.
- For **`reexport`** a remedy exists, it is just not purely local: `export type { X } from` erases the edge and removes a runtime export consumers may be importing as a value. So the finding stays — the runtime dependency is real — and the **remedy is kind-specific and names the consequence**: _"Change to `export type { X } from '…'`, which erases the dependency; check no consumer imports `X` as a value. If one does, re-export it from a module this rule permits, or stop re-exporting it here."_ Item 11 verifies that remedy remediates.

That distinction is the rule ADR-008 rule 2 actually states: a remedy must remediate, and one whose consequence the reader must check is still a remedy — one with no available action is not.

**`notHaveAliasedImports` needs no replacement function.** It reads `getImportDeclarations()`, each `getNamedImports()` specifier's `getName()`/`getAliasNode()`, and the declaration node for `importViolation`'s code frame — so a separate `importStatements(sf)` would be `getImportDeclarations()` under a new name, one caller, buying only a label the docstring carries free. It is not an edge condition: it inspects `import` **statement syntax**. The decisive reason not to widen it is the arbitrary boundary — `export { x as y } from './impl.js'` would be flagged and `export { x as y }` would not, decided by whether a specifier happens to be present.

**Per-site kind filtering must be exhaustive, not an allowlist.** "Each site filters to the kinds it handles" is **fail-open for kind #6**: a kind added in 0.29 is silently excluded everywhere, which is the same false green this plan closes. Make it a typecheck at each site:

```ts
const handled: Record<ModuleEdgeKind, boolean> = {
  import: true,
  reexport: true,
  dynamic: true,
  'type-expression': true,
  require: false,
}
```

Adding a union member then breaks the build. ADR-005-clean, no `as`. **The same applies to §4's verb table** — see below.

**`require`: classified, consumed by nothing, and not announced.** The kind exists so a 4-way branch cannot mark a CJS runtime dependency as erased. It is unconsumed because **CJS enforcement is a different upgrade story** — its reds land in interop and generated `.d.ts` where the remedy is usually "nothing you can do", and it would hit `allowJs` projects that have not asked.

**State the trade honestly, because the kind is never _more_ protective.** For `import x = require('./banned.js')` under `notImportFrom`:

|                                 | default options      | `ignoreTypeImports: true` |
| ------------------------------- | -------------------- | ------------------------- |
| misclassified `type-expression` | reported, wrong verb | silent                    |
| classified `require`, excluded  | **silent**           | silent                    |

So it buys **consistency, not safety**: with no options set, the 4-way branch produces a correct red with a wrong verb, and the fifth kind produces a green. Not a regression against shipped behaviour — `getImportDeclarations()` never returned `ImportEqualsDeclaration` either — so keep it, but write "**we choose a known false negative over a mislabelled true positive**", not "we prevent a misclassification".

**No changelog entry** — announcing an unconsumed kind sells coverage that does not exist. Instead the two places that make a positive claim about which forms are seen, `docs/standard-rules.md:268` and `docs/modules.md:161`, must say **there is no way, sanctioned or otherwise, to catch `import x = require('./banned.js')` after 0.28.0**. The sanctioned alternative `modules(p).should().notContain(call('require'))` cannot express a path glob **and does not match `import x = require('s')`** at all, which is an `ExternalModuleReference`, not a `CallExpression`. Workaround and classifier are asymmetric in opposite directions, so the hole is total for that one form. That is a false green in the enforcement — bug 0022's own category — and it earns those words on the doc pages, not just "no dependency condition enforces `require`".

And name **item 16 plus item 16b as the kind's only consumers, in the source comment**, or 0.29 deletes an unused union member in good faith.

## §4 The new findings must name their kind

`hashViolation` is `rule::element::message`, and the message carries only basename + resolved target. So a re-export of a module the file also imports produces **byte-identical text**, is absorbed by the existing baseline entry, and is never reported as new — which breaks the migration's core promise.

Each kind a condition can report gets its own verb: `re-exports`, `dynamically imports`, `references the type from`. **`kind === 'import'` messages stay byte-identical**, so every existing baseline survives.

**The verb table must be an exhaustive `switch` on `ModuleEdgeKind`, not a `Record` lookup.** Measured: with the `require` filter removed and no `require` verb, `notImportFrom` emits the literal string `undefined` into a message — `cjs-consumer.js undefined "…/picomatch/index.d.ts" which matches forbidden […]` — and that text gets hashed into a baseline. A missing verb must be a compile error.

**Free only in 0.28.0.** Doing it later invalidates every baseline written at 0.28.

**Not to be confused with [bug 0028](../bugs/0028-two-findings-in-one-file-can-share-a-baseline-identity.md).** Measured on the _current_ build, 8 of 47 findings already collide — every pair `import`/`import`. On a full `strictBoundaries` run the rate is **362 findings / 329 distinct identities / 33 collided groups / 66 findings in collisions — 18%**. Per-kind verbs do **not** fix those. Pre-existing, filed separately, and its preferred fix (producer-set `identity`) changes no printed text, so it needs no sequencing against this plan.

**But §4 creates exactly one _new_ within-kind collision, and it is worth the number.** Measured over this repo: 102 runtime re-export edges, of which exactly **one** importer has two to the same target — `src/graphql/index.ts → src/graphql/resolver-rule-builder.ts`, twice. So one new finding will be absorbed by another's baseline hash, and item 13's "the new-kind findings are reported as new" is false for that one pair. Volume-wise §4 still needs no sequencing; put the number in so nobody rediscovers it as a bug.

## Guards

**The parity test 0022 asks for is a tautology** once both halves call `moduleEdges` — `expect(forward).toEqual(reverse)` compares a value to itself, and `0 === 0` is green. Keep it as a **labelled** re-divergence pin, scoped to edges resolving to a project source file (the bare-target policies are deliberately opposed).

**Runtime independence: re-export only, and it must run under vitest.** Settled by measurement — two earlier reviewers disagreed because they measured different runtimes:

```
inside vitest:  await import('…/barrel.js')  ->  keys = ["MARKER","STAR"]
bare node:      await import('…/barrel.js')  ->  ERR_MODULE_NOT_FOUND
```

No `tsc` step is needed. But say what it compares: **vite's resolver against the TS compiler** — two independent implementations of TS-aware resolution, a real cross-check on the resolution _algorithm_, and **not** a module-system oracle. It cannot catch anything both tools get wrong alike. Use a `.js` specifier in the fixture, which exercises vite's `.js`→`.ts` mapping.

### The independence guard as draft 3 specified it was green with bug 0022 restored

Two reviewers built item 7 to the letter and ran sabotage matrices derived from §1's field list. Draft 3's spec was "named edges by `names` → target; **star edges by target only**". Results:

| sabotage                                               | draft 3's item 7 |
| ------------------------------------------------------ | ---------------- |
| **all `reexport` edges dropped (= bug 0022 restored)** | **PASS**         |
| `names = []` for every re-export                       | **PASS**         |
| star edge `resolvedPath` → **wrong file**              | **PASS**         |
| **two star edges' `resolvedPath` swapped**             | **PASS**         |
| star edge `resolvedPath` → `undefined`                 | FAIL             |

Two root causes, and they compound. First, the runtime side of a star yields **names** while the static side yields a **target**: those are not comparable quantities, so "star edges compare by target" had nothing to compare against, and the only star property checkable without resolving the target is `resolvedPath !== undefined`, which `edges.length > 0` already covered. Second, `names.length === 0` was the discriminator between star and named — so emptying `names` **reclassified every edge as a star**, leaving the named half iterating nothing.

**Three assertions replace it. Each was built and verified to fail under the sabotage it targets.** Let `barrelKeys = Object.keys(await import(barrel))`, `localExports` = the barrel's own declared exports, `namedNames` = the union of `names` over edges with `names.length > 0`, and `starKeys` = the union of `Object.keys(await import(t))` over the star edges' targets.

1. **Per-name → target**, for named edges: each name in `names` exists in its edge target's runtime namespace. Catches a wrong target on a named edge, and the named/star swap.
2. **The name set**: `namedNames` set-equals `barrelKeys − localExports − (starKeys ∩ barrelKeys)`. **This is what catches `names = []`** — the field's only consumer must notice the field being empty.
3. **The star residual**: `barrelKeys − localExports − namedNames` **⊆** `starKeys`. Catches a mis-resolved star target — the release's flagship finding (`export * from './banned.js'` under `notImportFrom`).

**`⊆`, not `=`, and that is the answer for circular pairs.** On a circular re-export pair, equality **fails** correctly-implemented: `starKeys` contains names the source re-exported _into_ the star target. Measured:

```
barrel                     leftover=["STAR","STAR2"]  ⊆ starKeys=["STAR","STAR2"]   PASS
barrel, star target wrong  leftover=["STAR","STAR2"]  ⊄ ["IMPL_B"]                  FAIL ✓
cycle-a                    leftover=["B_OWN"]         ⊆ ["A_OWN","B_OWN"]           PASS
cycle-a, star wrong        leftover=["B_OWN"]         ⊄ ["IMPL_B","MARKER"]         FAIL ✓
```

**And the fixture must carry `export { INNER as OUTER } from`.** Under the local-name reading of `names` the guard fails on a **correct** implementation — the runtime key is `OUTER`, the target publishes `INNER`, and assertion 1 resolves to nothing. That is why §1 now pins `names` to the outward name for `reexport`, and why the alias form belongs in item 7's fixture rather than only item 4's table.

### Reinstate the path-join derivation — it is the cheapest item in the inventory

Draft 3 cut the dynamic half of the independence guard and observed, correctly, that "residual scope is relative specifiers, where both sides reduce to a path join." Then it cut the residual too. **Reinstate it**: for every edge with a relative specifier, of **every kind**, assert `resolvedPath` equals `resolve(dirname(importer), specifier.replace(/\.js$/, '.ts'))`, with `checked > 0`.

Built and verified: pristine passes; the **star/star swap fails**; `resolvedPath` always-`undefined` fails. Ten lines, no runtime import, covers every kind rather than re-exports only, and it is the only thing that guards a star edge's target independently of the runtime namespace. Highest coverage-per-line item here.

**Everything else:** explicit expected edge lists with the deliberate absences _in_ the list; identity as `relpath:line`, **never basenames** (`dependency.ts` appears 5× in the affected corpus); `edges.length > 0` per fixture; `checked > N` on every corpus loop. **And where `relpath:line` cannot discriminate, say so:** `import('./t.js')` and ``import(`./t.js`)`` on the same line produce two `ModuleEdge` values identical in every field, because `getLiteralText()` normalises both — so item 4 must put them on **separate lines** or the row the plan singles out as the type hazard is asserted by an identity that cannot see it.

## Test inventory

**0.27.0 — instruments**

1. `--changed` discloses what it filtered: count and file count reach stderr, and `summary.reason` is non-null in `--format json`. Asserted with findings present **and** absent.
2. `baseline` prints the delta it accepted (`41 → 78 entries (+37, −0)`), including the first-run case with no prior file.
3. `docs/upgrading.md` exists and its table covers every released version — **derived from `CHANGELOG.md`'s headings**, so a new release without a row fails. (Confirmed constructible: 29 headings in a uniform `## [X.Y.Z] - DATE` form.)

**0.28.0 — the widening**

4. §1's 20-form table as an edge list, all five non-edge rows provably absent, **including the `NoSubstitutionTemplateLiteral` row and ``require(`s`)`` in `.js`** — with the two dynamic forms on **separate lines**.
5. §2's per-kind matrix — `import` via `isTypeOnlyImport` **including `import React, { type FC }` as runtime**, both `reexport` trap rows, the three constants. **This is now the only guard on `isTypeOnlyImport`'s default/namespace formula** (item 15 cannot be — see 15).
6. Uniform `lit.getSymbol()` per kind: `paths` aliases, bare packages, `type A = import('./barrel.js').Deep` → **barrel, not impl**, and **a module-augmentation fixture** where the symbol has two declarations and only the `SourceFile` one is correct.
7. **Runtime independence, re-export only, under vitest — the three assertions above**, over a barrel holding `export { MARKER } from`, `export * from`, `export { INNER as OUTER } from`, plus a circular pair. Fixture uses `.js` specifiers.
8. Per kind × per family by `relpath:line`, with absences, **and a multi-line row for every kind** — measured, statement and literal lines differ for `import` (1 vs 3), `reexport` (4 vs 6) and `dynamic` (8 vs 9), so without them `line = lit.getStartLineNumber()` passes everything.
9. `notHaveAliasedImports` as an explicit expected list over a fixture holding both `import { x as y } from` and `export { x as y } from` — exactly one violation. **Not a "no-change pin"**: draft 3 claimed it must red if anyone routes the condition through the widened walk, but `ModuleEdge` carries no `aliases` field, so that routing is unrepresentable. Keep the fixture test; drop the claim.
10. **`dependOn`, stated so it fails today.** Draft 3's three clauses — a type-only re-export does not satisfy it, a plain `import type` still does, a runtime edge does — **all pass with the widening entirely absent**, because today every re-export and dynamic import leaves `dependOn` unsatisfied. Measured. The reversal must be named in the words that reverse: **a runtime re-export and a runtime dynamic import SATISFY `dependOn`**, plus the type-only re-export that must not.
11. **Each new kind's remedy remediates.** Apply the stated fix to a re-export, a dynamic import, a type-expression finding **and `onlyHaveTypeImportsFrom`'s new per-kind re-export remedy**; assert each clears. **Mechanism: `project.createSourceFile()` in memory**, not editing a committed fixture in place, which is order-dependent under parallel runs. Distinctness is not honesty — a re-exported type alias currently gets _"invert the dependency … pass it in as a parameter"_.
12. Per-kind messages: `import` byte-identical to 0.27.0; each new kind distinct — asserted on identities **in addition to item 8's `relpath:line` multiset, over one fixture**. Identities alone are blind to losing one of two colliding findings (measured: 11 findings, 10 identities on the kinds fixture — two re-exports of one banned module collide). Counts alone are blind to absorption. Both halves, one fixture.
13. A frozen 0.27.0 baseline (committed fixture) replays: every pre-existing static finding matches, and the new-kind findings are reported as new. **Verified end to end by a reviewer**: 2 static findings frozen, widened, replayed → total 6, new 4, the two absorbed byte-for-byte, and a file that both imports and re-exports one banned module reports `imports` at :1 and `re-exports` at :2 with the re-export **new solely because of §4's verb**.
14. **The `notImportFrom` predicate loses a subject.** A fixture where a file re-exports from a banned path drops out of `.that().notImportFrom(…)` — the anti-monotone direction, asserted as full-set equality including a retained file that has permitted edges of both kinds.
15. Corpus-wide per-edge equivalence on **one build**: `moduleEdges` filtered to `kind === 'import'` sequence-equal to `getImportDeclarations().map(…)` over **`{line, candidates}` only**, `checked > 500` (measured: 1797). **`typeOnly` is removed from its scope**: both sides call the same `isTypeOnlyImport`, so the comparison is `f(x) === f(x)` — verified, it survives that function losing its `getDefaultImport()` guard, the exact defect §2 calls load-bearing. It does catch `line`-from-literal, `resolvedPath` undefined, `resolvedPath` = importer, and reversed edge order. State that after the widening this test is `importCandidates`' only consumer, or 0.29 deletes it in good faith.
16. `require` **classification**: `import x = require('s')` in `.ts` and `require('s')` in `.js` under `allowJs`, both **runtime**, not `type-expression`.
    **16b. `require` _exclusion_, which item 16 structurally cannot cover.** `notImportFrom` over the same fixture reports **zero** findings from those two files. Measured: removing the filter from both widened conditions leaves all 2479 existing tests green, and `src/` has **0** `require` instances so the "0 changed" measurement cannot see it either.
17. A bare dynamic import under `onlyImportFrom`, in both option states — **`import('node:path')`, which measures `resolvedPath: undefined`**. Draft 3 said `import('picomatch')` → `undefined`; measured, it **resolves** to `@types/picomatch/index.d.ts` because it is a direct dependency with types installed, so `candidates` is `[resolvedPath, 'picomatch']`. That is bug 0014's documented shape (`import-candidates.ts:12-19`) and the worst possible choice of example — as written an implementer "fixes" the code to match the plan.
18. `arch-rules.test.ts` positive control over `inProjectSrc()` — **per-kind count floors plus named structural edges**, not a `relpath:line` list. Draft 3's list, derived after the widening over `src/`, is a snapshot pin (ADR-008), and it churns on any import moving, whose cheapest resolution is to regenerate it. Use `reexport > 100` (measured: 102) and a handful of edges that are structural, e.g. `src/index.ts` re-exports `src/core/project.ts`.
19. `layered/type-imports-only` gains an edge-identity assertion — pinned by `.some(v => v.ruleId === …)` at four sites, and nothing pins _which_ import is exempt.
    **19b. `onlyHaveTypeImportsFrom` × `dynamic` reports nothing.** One fixture line: a dynamic import from a path the rule's glob matches, asserting no finding. Measured — adding `dynamic` to the kind filter leaves all 2479 tests green, so §3's most-reasoned exclusion is the one nothing pins.
20. Reverse graph dedups on `(importer, target)` — measured today, one importer with two static imports of one target yields two byte-identical violations at the same `file:line`. (Confirmed in source: `reverse-dependency.ts:81` passes `deduplicate: false` while `:90` and `:112` pass `true`.)
21. **The `importFrom` predicate gains a subject.** A file whose only matching edge is a re-export now matches `.that().importFrom(…)`, asserted as full-set equality — the monotone-increasing predicate direction, which no other item covers.
22. **The path-join derivation** (Guards): every relative specifier of every kind, `checked > 0`.

**On `type-expression`:** measured **0 instances** anywhere the tsconfig reaches, including `node_modules`. Classifying every literal across 471 files: `ImportDeclaration` 1756, `ExportDeclaration` 155, `CallExpression`/`StringLiteral` 6, `CallExpression`/`NoSubstitutionTemplateLiteral` 2, and **zero** `LiteralType`, `ExternalModuleReference` or `require()`-in-`.js`. So items 6, 8, **and 16/16b** all need dedicated fixtures — draft 3 named only 6 and 8. One fixture covers the forms (a reviewer built it: 18 edges from 22 candidate lines, with `declare module './t.js'`, `declare module 'virtual-thing'` and `import('./' + n)` correctly absent).

## What 0.27.0's implementation found that draft 4 did not predict

Recorded here because the same two shapes will recur in 0.28.0.

1. **`writeReport`'s `reason` parameter is per-violation, not run-level.** `format.ts` renders it as each violation's `Why:` line (`v.because ?? reason`), so routing a run-level notice through it duplicates the line **and** attributes it to an unrelated finding. `summary.reason` in JSON is genuinely run-level; the terminal path has no run-level slot at all. 0.28.0's per-kind messages touch the same renderer — do not assume `reason` is a report header.
2. **A guarded helper with an unguarded call site is an unguarded feature.** The `activeNotice` tests called the function directly, so replacing its `writeStderr` call in `execute-rule.ts` with a no-op stayed green across the whole suite. Every wiring point needs its own assertion through the real terminal, which is what item 7's three assertions are for on the 0.28.0 side.
3. **`docs/upgrading.md` had to be read out of `CHANGELOG.md`, not reconstructed.** Writing it from memory got 0.6.0 wrong: it looks additive (`expression()` dedup) and the entry says findings drop from 189 to 13 and to update baselines. Three other releases (0.7.2, 0.8.0, 0.10.0) change enforcement in ways the version number does not hint at.

## Migration

**0.27.0 ships the instruments and the page.** `docs/upgrading.md`: one table (version → changes enforcement? → action required? → the action), one ordered recipe for coming from ≤0.22, and a sidebar entry in `docs/.vitepress/config.ts`.

This is not tidiness. **Followed in sequence, the existing per-release notes produce the false green this project exists to prevent:** 0.23.0 says regenerate the baseline, 0.24.0 says regenerate when convenient, 0.28.0 will say regenerate **before upgrading**. An adopter on 0.21.0 reading them in order regenerates _last_ — after the widening — and silently accepts every finding the release adds. Six releases dated within days, and the actions interact.

**`--changed` disclosure is a design problem, not a five-line fix.** `filterToChanged` is called at four sites — `core/check-all.ts:28`, `core/execute-rule.ts:229` and `:269`, `cli/commands/check.ts:66` — and the two in `execute-rule` are **per rule**. Putting the message in `DiffFilter.filterToChanged` makes a diff-aware vitest suite with 79 rules print 79 stderr lines, on the channel 0.26.0 made unconditionally visible. There is no per-run aggregation point on the in-test path. Resolve that in 0.27.0; it is the second-best reason for the split.

**`baseline` prints the delta; it does not refuse.** An earlier draft proposed refusing to overwrite without `--force`. That breaks the recipe printed beside it — `init` scaffolds `arch:baseline` as bare `ts-archunit baseline`, documented as a _refresh_ in `docs/getting-started.md:41`, `docs/setup-best-practices.md:11` and `:49`, `docs/troubleshooting.md:10`, `docs/cli.md:39`, so every second-and-later run would fail. A refusal also does not address the real hazard, since the adopter passes `--force` and accepts the findings anyway. Printing `41 → 78 entries (+37, −0)` does.

**0.28.0's recipe:**

```bash
# BEFORE upgrading, on 0.27.x — the delta line tells you what you just accepted
npm run arch:baseline && git commit -am 'chore: refresh arch baseline'
# upgrade, then CI's normal invocation reports only what 0.28.0 added
```

Note what does **not** work, emphatically: a separately-installed `ts-archunit@0.27.0` binary **prints `0.27.0` and reports the new findings**, because `loadRuleFiles` imports the rule file from the user's project and its `import … from '@nielspeter/ts-archunit'` resolves against the project's `node_modules`. A team bisecting "which version did this?" pins the old CLI, sees identical output, and rules out the upgrade. The CLI should print one line when the two versions differ.

**The honest middle**, because regenerating auto-accepts the release's best finding and triaging 300 findings across 40 barrels is not a sprint:

```ts
...strictBoundaries(p, { … }).map((b) => b.asSeverity('warn')),
```

Measured: 9 findings → 4 errors, 5 warnings, CI green — and 0.26.0 is the release that made warn output actually appear, so a warn prints on every run and cannot be silently forgotten, where a regenerated baseline makes the finding invisible forever. Ratchet down, then drop the `.asSeverity('warn')`.

Name the move a team finds on its own: `.excluding('index.ts')` silences **every barrel in the project at once**, including their legitimate static imports, because `element` is the basename. Do-not-reach-for list, beside `--changed`.

**Four reversals, `dependOn` leading**, because it is the only _guarantee_ reversal and the only red→green one: its JSDoc says dynamic imports are not checked, and after 0.28.0 a runtime re-export or dynamic import satisfies it. Then: **barrels become dependency-bearing** (`src/index.ts` 0 → 114 dependencies — the sentence that lets a reader predict their own diff); the reverse half gains kinds, so **`noDeadModules()`** reports fewer orphans (that is the name in the docs and the rule teams run) — and note that shrinks baselines for a reason no output explains; and `docs/modules.md:161`'s "use `beImported()` or `noDeadModules()`" workaround pointer becomes wrong advice.

**Doc surfaces:** `docs/standard-rules.md:268`, `docs/slices.md:22-45` (teaches import-glob semantics on the page documenting the still-static slice graph), `docs/api-reference.md:98` vs `:223` (predicate and condition tables twenty lines apart, reading identically — and `:98` is now the second performance shape too), `docs/what-to-check.md:666` (the barrel recipe — after 0.28.0 the barrel is the likeliest violator), and **consumer-side copies**: `explain --format agent` output is pasted into `CLAUDE.md` by a documented workflow, so preset `imperative` strings mean something wider with no refresh mechanism. Tell people to re-run it. (`docs/.vitepress/dist/` is **not** committed — it is gitignored — so it is not a surface.)

## Out of scope

- **The slice graph** (`slice-graph.ts:48,105`) — `beFreeOfCycles()`, `notDependOn()`, `respectLayerOrder()` stay static-only. Barrel re-export is _the_ classic cycle shape, so this is valuable, but a cycle finding is the hardest class to remedy and it is a different upgrade story. **The disclosure must be louder than a changelog line:** one sentence in `beFreeOfCycles()`'s JSDoc and in `layered/no-cycles` / `boundaries/no-cycles` metadata, because `strictBoundaries` will red on a barrel from one rule and stay silent on it from its sibling **in the same run**. Rule metadata is read on every failure; a changelog is read once. The retrofit is cheap (both sites are resolved-file-only); the reds are not.
- **Bug 0015** — option 1 refuted; evidence and option 2 in that file.
- **Bug 0028** — the pre-existing within-kind collision (§4), plus the one new pair §4 creates.
- **`declare module './rel.js'`**, and **an `import type` inside `declare module 'pkg' { … }` in a `.d.ts`** — both are compile-time references the binder routes to `moduleAugmentations`, so `getImportStringLiterals()` structurally cannot see them. The second is weaker: TS will not resolve a relative specifier inside an ambient body anyway. Holes, stated.
- **Enforcing `require`** — §3, with the total hole for `import x = require(…)` written on the two doc pages.
- **Making `dependOn` require runtime for `kind === 'import'`** — `{ ignoreTypeImports: true }` already expresses it; a docs gap, not a behaviour gap.
- **An `ImportOptions` overload for `onlyHaveTypeImportsFrom`** — §2.
- **`type-expression` in `onlyHaveTypeImportsFrom`'s kind filter** — dead either way, since it is always erased and can never violate a type-imports-only rule. The exhaustive `Record` must still list it; the row should say it is unreachable.
- **An `includeReExports` option** — it reinstates two user-selectable definitions of "an import", and 0069 settled the principle: "an opt-out is the first thing an agent adds on the first red."
- **Exporting `ModuleEdge`** — deferred, with the cost recorded: `defineCondition()` is public, documented and taught, so every custom dependency condition in the wild keeps calling `getImportDeclarations()` and reproduces bug 0022 outside the package, where no fix of ours reaches. §2's trap table is the evidence they will get it wrong. Revisit in 0.29, not never.

## Notes for whoever implements

- **`onlyBeImportedVia` double-reports today.** `addToGraph`'s `deduplicate` flag is `false` for static imports: one target, one importer, two static imports → **two byte-identical violations at the same `file:line`**, hence two identical baseline hashes. Dedup on `(importerPath, targetPath)`.
- **The reverse graph hardcodes `line: 1`**, so parity can only key on `(importer, imported)`.
- **The reverse graph's cache is keyed on `Project` alone** and computed from the file list of the first call, which is never part of the key — stale-forever if the file set changes. Nothing in `src/` mutates a `Project` after handing it out, so it is a consumer hazard; say so in the header.
- **`ImportTypeNode.getStartLineNumber()`** is the type node's line, not the statement's.
- **`discoverIdentityRoot` already handles a worktree's `.git`-as-file**, so item 13's frozen baseline is portable and the whole review can run from a worktree. Verified.
- **Re-run the blindness sabotage after the fix and put the number in the changelog.** If it is still ~38, the change added visibility without coverage.
- **Enumerate the sabotage matrix from the diff**, read exit codes, never the reporter text. Draft 3's item 7 is what happens when a guard is reasoned about instead of sabotaged: it survived four reverts including the total restoration of the bug this plan closes.
- **Do not filter probe output with `grep -E '^MARKER'`** — vitest prefixes a test's first `console.log` with ANSI codes, so an anchored pattern drops that line. It briefly looked like `getImportStringLiterals()` was missing a plain static import.
- **`plans/0069-appendix-vacuous-tests.md` has a hole**: it enumerated tests failing under an empty _selector_, so `tests/conditions/dependency.test.ts:43` ("passes for a module with no imports (vacuously true)") is not in it. That test stays green — bug 0015's failing tier is refuted — but the appendix should say why.
