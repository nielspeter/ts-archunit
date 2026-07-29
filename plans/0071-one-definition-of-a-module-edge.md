# Plan 0071 — Forward dependency conditions see every module edge

**Status:** DRAFT 2 — reviewed by five personas against a working prototype; **nine claims in draft 1 were measured wrong and are corrected below.**
**Priority:** High. [Bug 0022](../bugs/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md) is a false green in the enforcement itself: `export { x } from '…'` and `import('…')` cross every banned edge unflagged.
**Effort:** ~2 days for 0022. [Bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md) is **descoped to a diagnostic** and moves to its own release.
**Closes:** bug 0022. **Advances** bug 0015 (diagnostic only; the failing tier is withdrawn — see §5).
**Release:** 0.27.0, minor. Ships 0022 alone.

Draft 1 was titled "One definition of a module edge, and a rule that tested none". Both halves of that title were wrong: the slice graph and the `importFrom` predicate keep their own definition unless explicitly included (§3), and the "rule that tested none" tier fails correct code (§5). The title now claims only what the release does.

## What draft 1 got wrong

Recorded because draft 1 read as authoritative and was measured against a prototype. Each row was independently confirmed.

| Draft 1 claimed                                                                                                                                          | Measured                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New walk 8.1ms vs 0.6ms — **13×**, "no warm-up benefit (the descendant walk repeats)"                                                                    | **~1.4× like-for-like, and warm the walk is ~2.5× _cheaper_ than `getImportDeclarations`.** `getImportStringLiterals()` reads the binder's cached `compilerNode.imports`; it is not a descendant walk. The 8.1ms amortised a one-time `_ensureBound()` already paid by every `getType()` call |
| `typeOnly = decl.isTypeOnly() \|\| all-specifiers-type-only`, "mirroring `isTypeOnlyImport`"                                                             | **Wrong for `ImportDeclaration`** — it drops `isTypeOnlyImport`'s `getDefaultImport()`/`getNamespaceImport()` guards, so `import React, { type FC } from 'react'` would be classified type-only and **skipped under `ignoreTypeImports`: a lost existing finding**                            |
| `type-expression` resolves via the `ImportTypeNode`'s type symbol                                                                                        | **Resolves the wrong file.** `type A = import('./barrel.js').Deep` → `/impl.ts`, not `/barrel.ts`, because the symbol walk follows the declaration. `notImportFrom('**/impl.ts')` would fire on a file that never names `impl`                                                                |
| `line` must equal `decl.getStartLineNumber()` "because `hashViolation` hashes the message and the message carries the line"                              | **No dependency-condition message interpolates a line**, and `baseline.ts` says line numbers are "NOT used for matching". The invariant is still worth keeping — code frames, annotation position, reader trust — for a different reason                                                      |
| Tier 1 (fail when a rule tested zero edges) is "the same shape and voice as `collectWithAssertionGuard`" and "needs no new mechanism"                    | **Fails correct code, and needs a new mechanism.** Measured three ways in §5. `collectWithAssertionGuard` is element-type-agnostic and cannot count edges; `Condition<T>` is a public exported type, so extending it is a public API change                                                   |
| Tier 3 catches "0015's actual typo case, `onlyImportFrom('**/nowhere/**')`"                                                                              | That case produces **96 violations** — maximally loud. The silent case is a **denylist** glob that matches nothing                                                                                                                                                                            |
| Unresolvable dynamic specifiers: ``import(`./locales/${lang}.js`)`` reds every i18n loader                                                               | **A template with a substitution yields no literal at all** — not an edge for any family. The real case is a _literal_ specifier that fails to resolve                                                                                                                                        |
| The independence guard "would have caught `resolveDynamicImport` losing `@/`-aliased specifiers, because Node and TS resolve aliases by different rules" | **Backwards.** Node has no tsconfig `paths` support, so aliases _throw_ rather than disagree, and bare specifiers diverge by design (bug 0014). Reverting that exact defect exits **0 — uncaught**. The dynamic half is cut (§Guards)                                                         |
| `bare-package-imports.test.ts:262` is precedent for an "old build vs new build" corpus test                                                              | It re-derives the old answer **inline, on one build**, in two lines. Two live builds would also be wrong: `project()`'s cache is module-scoped, so two copies mean two full program loads                                                                                                     |

What survived: the bar (§Problem), the forcing order (§4), the central mechanism, monotonicity, and four refusals — the parity tautology, `includeReExports`, `notHaveAliasedImports`, and "regenerate your baseline" as headline advice.

## Problem

`src/conditions/dependency.ts` collects edges from `sf.getImportDeclarations()` at five sites. That walk sees static `import` statements and nothing else. The reverse graph indexes static imports, re-exports **and** dynamic imports — so `onlyBeImportedVia('…')` sees a re-export as an import and `notImportFrom('…')` does not.

### The bar

Blinding `onlyImportFrom` and `notImportFrom` to collect no edges — ADR-008's "completely broken" floor. Reproduced in **three** isolated worktrees:

|                                                                |                                |
| -------------------------------------------------------------- | ------------------------------ |
| Baseline                                                       | 2478 passed / 176 files        |
| Both conditions collecting nothing                             | **38 failed**, 12 files        |
| `tests/archunit/arch-rules.test.ts` (18 of the affected sites) | **39/39 passed — zero caught** |
| Widening to all four edge kinds                                | **2478 passed — zero changed** |

Widening was verified non-trivial before trusting "0 changed": **647 static declarations → 803 edges over `src/`** (+24%), and `src/index.ts` 0 → **114**.

So 1.5% of the suite distinguishes "collects static imports" from "collects nothing", and **0 of 2478** distinguishes it from "collects everything". The suite pins that the loop runs, never what it collects. The test surface is most of the work.

## Two withdrawn premises (from the bugs)

### 0022: "extract the reverse graph's three collectors"

The reverse graph is the **weaker** half. `resolveDynamicImport` returns `undefined` for every non-relative specifier by construction; measured against 7 non-static edges in a `paths`-aliased project it loses **4 of 7**. The forward side deliberately matches the raw specifier for non-relative imports — bug 0014's fix. Porting the reverse definition forward would reintroduce bug 0014 inside the new edge kinds: `notImportFrom('picomatch')` would still miss `await import('picomatch')`.

**The extraction runs forward-out.** Generalize `importCandidates`; the reverse graph becomes a consumer.

### 0015: "an edgeless subject should fail"

For the `only*` family, zero edges is **maximal compliance**. 10 of this repo's 14 zero-import `src/` files are pure leaf modules; `tarjan.ts` is a dependency-free algorithm and would fail `layered/innermost-isolation` at error severity with no remedy that improves anything. See §5 for why the rule-level version fails too.

## Design

### §1 One walk, `src/core/module-edges.ts`

`SourceFile.getImportStringLiterals()` returns one literal per module specifier across every edge-carrying form. **Measured, 19 forms:**

| Form                                                                                                  | literal? | parent kind                   | notes                                                                 |
| ----------------------------------------------------------------------------------------------------- | -------- | ----------------------------- | --------------------------------------------------------------------- |
| `import { x } from 's'`, `import type { X }`, `import { type X as X2 }`                               | 1        | `ImportDeclaration`           |                                                                       |
| `import 's'` (side-effect only)                                                                       | 1        | `ImportDeclaration`           | 0 named specifiers — runtime                                          |
| `import {} from 's'`                                                                                  | 1        | `ImportDeclaration`           | runtime                                                               |
| `import * as NS from 's'`, `import D from 's'`                                                        | 1        | `ImportDeclaration`           | runtime binding                                                       |
| `export { x } from 's'`, `export { x as y } from 's'`, `export * from 's'`, `export * as NS from 's'` | 1        | `ExportDeclaration`           | runtime                                                               |
| `export type { X } from 's'`, `export { type X } from 's'`, `export type * from 's'`                  | 1        | `ExportDeclaration`           | type-only — see §2                                                    |
| `export {} from 's'`                                                                                  | 1        | `ExportDeclaration`           | runtime                                                               |
| `import('s')`                                                                                         | 1        | `CallExpression`              |                                                                       |
| ``import(`s`)`` (no substitution)                                                                     | 1        | `CallExpression`              | **`NoSubstitutionTemplateLiteral`** — see the hazard below            |
| `type A = import('s').X`                                                                              | 1        | `LiteralType`                 |                                                                       |
| `import x = require('s')`                                                                             | 1        | **`ExternalModuleReference`** | **runtime** — draft 1 had no row                                      |
| `require('s')` in a `.js` file under `allowJs`                                                        | 1        | `CallExpression`              | **runtime, indistinguishable from `import()` by parent kind**         |
| `require('s')` in a `.ts` file                                                                        | 0        | —                             |                                                                       |
| `declare module 's' {}`                                                                               | 0        | —                             | correctly not an edge                                                 |
| `import('./' + n)` (computed)                                                                         | 0        | —                             | not an edge for **any** family                                        |
| `export { x as y }` (no specifier)                                                                    | 0        | —                             |                                                                       |
| `declare module './rel.js' { … }`                                                                     | 0        | —                             | **a hole**, not a correct exclusion — routed to `moduleAugmentations` |

Two traps that draft 1's 4-way branch would have hit, both misclassifying a **runtime** dependency as an erased one:

- **`import x = require('s')`** — parent `ExternalModuleReference`, grandparent `ImportEqualsDeclaration`. A branch ending in `else → 'type-expression'` gives it `typeOnly: true`, exempt under `ignoreTypeImports`. Common in hand-written `.d.ts`. ts-morph's own `SourceFileReferencingNodes` union names it.
- **`require()` in `.js` under `allowJs`** — the binder collects it into `sourceFile.imports` with parent `CallExpression`. The discriminator is `callExpr.getExpression().getKind() === SyntaxKind.ImportKeyword`, which the reverse graph already has.

**Type hazard, measured:** ``import(`./x.js`)`` yields a node whose kind is `NoSubstitutionTemplateLiteral`, for which `Node.isStringLiteral()` is **false** — while `getImportStringLiterals()` is declared `StringLiteral[]`. ADR-005 forbids `as`, so an implementer narrowing defensively drops this edge and typecheck says nothing. It must be a row in the guard, asserted by identity.

```ts
// src/core/module-edges.ts — the return type is ts-morph-free by construction, so a
// cached value can never hand back a forgotten node.
// `require` exists so the classifier CANNOT silently mislabel a CJS runtime
// dependency as an erased one — that misclassification is the bug §1 found. No
// condition consumes it in 0.27: every site filters to the kinds it handles, so
// behaviour toward `require` is unchanged. Enforcing it is a separate decision
// (see Out of scope) because its visibility is asymmetric by file type.
export type ModuleEdgeKind = 'import' | 'reexport' | 'dynamic' | 'type-expression' | 'require'

export interface ModuleEdge {
  readonly kind: ModuleEdgeKind
  /** The specifier as written. */
  readonly specifier: string
  /** Resolved absolute path, when the compiler resolved it. */
  readonly resolvedPath: string | undefined
  /**
   * 1-based line of the statement carrying the edge. Equals
   * `decl.getStartLineNumber()` for `kind === 'import'`: 88 of this repo's 1769
   * import declarations (5%) have the specifier on a different line from the
   * keyword, so keying off the literal would move 5% of every consumer's
   * reported lines. Not a baseline-matching concern — `hashViolation` never sees
   * the line — but it drives the code frame and the GitHub annotation position.
   */
  readonly line: number
  /** Erased at compile time, so no runtime dependency. Per-kind; see §2. */
  readonly typeOnly: boolean
  /**
   * Named bindings crossing the edge, as written. **Empty for `export *`** — the
   * names it contributes are only knowable by resolving the target and reading
   * its exports, which would make this walk recursive and needs an answer for
   * circular pairs. Measured: the runtime namespace of a barrel with
   * `export * from './other.js'` contains `other`'s exports, so the runtime side
   * of the independence guard has names this field deliberately does not. Star
   * edges are compared by target; named edges by `names` → target.
   * Also empty for `dynamic` and `require`.
   */
  readonly names: readonly string[]
}

/** Every module edge leaving each file, in one call (ADR-007 rule 2). */
export function moduleEdges(
  files: readonly SourceFile[],
): ReadonlyMap<string, readonly ModuleEdge[]>
```

**Resolution is uniform: `lit.getSymbol()` on the string literal.** Measured across all five kinds, including `paths` aliases and bare packages, and it is what ts-morph uses internally for its own reference container. This replaces draft 1's three per-kind paths, fixes the `type-expression` wrong-file bug, and removes a `getType()` type-checker call (measured 3.2–3.9ms/pass per-kind vs 2.2–2.8ms uniform).

**No `candidates` field.** Draft 1 stored `candidatesFor(specifier, resolvedPath)`'s output alongside its two inputs — two representations of one fact that can disagree, and its consumers are four families, not one. Keep `specifier` + `resolvedPath`; expose `candidatesFor(edge)`.

**No cache — measured across a real preset run, not inferred from a single pass.** Draft 1 justified a cache with a wrong per-pass number (13×). Correcting that number is not by itself an argument against a cache, because the cost is per-rule × passes, not per pass. So it was measured properly:

|                                                               |                                            |
| ------------------------------------------------------------- | ------------------------------------------ |
| One full walk + resolve pass (472 files, 1708 resolved edges) | **6.7ms**                                  |
| Rules `strictBoundaries` generates over this repo             | **79**                                     |
| Worst case, if every rule spanned every file                  | 527ms — against a 137ms baseline, **4.8×** |
| **Realistic: summed subject sets across those 79 rules**      | **1665 file-visits → ~23ms, ~17%**         |

Subject sets are narrow: they sum to about **3.5×** the file count, not 79×. So no cache, and the number to quote in the changelog is ~17% on a preset run, not "free".

**The condition that would reverse this**, named so nobody has to rediscover it: rules whose selector spans the whole project. `modules(p).should().notImportFrom(…)` with no `.that()` is legal, and a preset over a flat project approaches the worst-case row. If a consumer reports a preset run slowing by multiples, that is the shape to look for, and a per-`(Project, filePath)` cache of **resolution** — not of the walk, which is already cheap — is the fix.

Warm, the walk itself is cheaper than today's. A bulk signature also makes ADR-007 rule 2 true rather than asserted — one crossing returning a bulk result, instead of N per-file crossings needing a `WeakMap` to be affordable. Draft 1's ADR-007 argument also cited the wrong alternative: ADR-007's Alternative 4 is Rule 1 without Rule 2; this is Rule 2 without Rule 1, which ADR-007 calls the load-bearing half. The conclusion stands, the citation was wrong.

**Net win draft 1 did not claim:** deleting `resolveDynamicImport`/`indexDynamicImports` removes a `getDescendantsOfKind(CallExpression)` scan over ~30k nodes costing 60–100ms per graph rebuild.

### §2 The `typeOnly` contract

Today, in all five sites, `import type` is a full edge; the only exemption is `{ ignoreTypeImports: true }`. **That default is preserved.**

Per kind, measured:

| Kind              | Rule                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import`          | **Reuse `isTypeOnlyImport` unchanged.** Its `getDefaultImport()`/`getNamespaceImport()` guards are load-bearing: `import React, { type FC } from 'react'` is a runtime edge                                                                                                                                                     |
| `reexport`        | New `isTypeOnlyReExport`: `decl.isTypeOnly() \|\| (namedExports.length > 0 && namedExports.every(isTypeOnly))`. **Both halves needed** — `export type { X as XT } from` has decl `true`/specifiers `false`; `export { type X as XI } from` has decl `false`/specifiers `true`. There is no default/namespace analogue, verified |
| `dynamic`         | **Always runtime**                                                                                                                                                                                                                                                                                                              |
| `type-expression` | **Always erased**                                                                                                                                                                                                                                                                                                               |
| `require`         | **Always runtime**                                                                                                                                                                                                                                                                                                              |

`onlyHaveTypeImportsFrom` has no `ImportOptions` overload, asymmetric with its three siblings. Pin the asymmetry or fix it; a test must state which.

### §3 Per-site disposition

| Site                                                       | Disposition                                                                                                               | Direction           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `onlyImportFrom` (:57)                                     | all edge kinds; `typeOnly` exempt only under `ignoreTypeImports`                                                          | green→red, monotone |
| `notImportFrom` (:105)                                     | same                                                                                                                      | green→red, monotone |
| `dependOn` (:155)                                          | **runtime kinds only — never `typeOnly`.** See below                                                                      | red→green, monotone |
| `notHaveAliasedImports` (:196)                             | **not routed through `moduleEdges` at all.** Keeps calling `sf.getImportDeclarations()`, with the reason in its docstring | none                |
| `onlyHaveTypeImportsFrom` (:235)                           | `import` + `reexport` only. **Excludes `dynamic`** — see below                                                            | green→red, monotone |
| `importFrom` **predicate** (`src/predicates/module.ts:18`) | **in scope, not optional.** See below                                                                                     | green→red           |
| `reverse-dependency.ts` (:77-100)                          | replace all three collectors; delete `resolveDynamicImport`; dedup on `(importer, target)`                                | mixed               |
| **`require` kind — every site**                            | **excluded in 0.27.** Each site filters to the kinds it handles, so behaviour toward `require` is unchanged               | none                |

Measured on this repo: `no-cross-boundary` 289 → **292**, `shared-isolation` 80 → **94**, `innermost-isolation` 20 → **21**, **0 findings lost**, 0 messages or lines changed for pre-existing findings. Monotonicity is derivable, not empirical: four sites push one violation per edge, so more edges is monotonically green→red; only `dependOn` uses `.some()`.

**`dependOn` must not count erased edges — draft 1 created a false green here.** Measured against `docs/modules.md`'s own teaching example ("server must depend on security middleware"), with the only reference being `export type { SecurityConfig } from './security-middleware.js'`:

```
0.26.0:      1 violation — "does not import from any path matching […]"
draft 1:     0 violations
```

The server installs nothing; the line is erased; the rule certifies the runtime guarantee holds. Ask ADR-008's question and the answer is **pass**. On the baseline side it reads as "the violation was fixed", which 0.24.0's own table calls success. `dependOn` asserts a runtime dependency exists, so it must count runtime edges only. Its "static only" JSDoc is **rewritten, not deleted** — it is the only place a reader learns what a `dependOn` green means, and it must now say `import type` does not satisfy it.

**`onlyHaveTypeImportsFrom` excludes `dynamic`, on ADR-008 rule 2.** Its shipped preset says _"Use `import type { X }` so the dependency is erased"_. Applied to `await import('../other/x.js')` that instruction cannot be followed. §3 in draft 1 ran exactly this test on `notHaveAliasedImports` and refused to widen it — and failed to run it on the row above.

**`notHaveAliasedImports` leaves the shared walk entirely — and needs no replacement function.** Draft 2 first specified a separate `importStatements(sf)` "so the distinction is structural rather than a filter". Measured what the condition actually reads: `sf.getImportDeclarations()`, each `getNamedImports()` specifier's `getName()`/`getAliasNode()`, and the declaration node itself for `importViolation`'s code frame. So `importStatements` would be `sf.getImportDeclarations()` under a new name — an indirection with one caller that buys only the label, which the docstring can carry for free.

**Consequence: `aliases` and `AliasedBinding` come out of `ModuleEdge` entirely.** That field existed solely to serve this condition, so with the condition off the walk it has **no consumer** — one fewer field, one fewer exported type, and one fewer thing to specify, guard and sabotage. This also retires draft 1's "every field has exactly one consumer family" claim, which was wrong about `candidates`; the interface is now small enough not to need the argument.

The honest framing: **it is not an edge condition — it inspects `import` statement syntax**, and the docstring says so. And the decisive reason to refuse the widening is not consumption-vs-publication, it is the arbitrary boundary: `export { x as y } from './impl.js'` would be flagged and `export { x as y }` would not, decided by whether a specifier happens to be present — a coverage line invisible to the reader.

**The `importFrom` predicate is in scope.** `src/builders/module-rule-builder.ts:122` makes `.notImportFrom()` **one method** that dispatches to the predicate before `.should()` and the condition after. Ship to one half and a single identifier carries two definitions of "an import", chosen by chain position — this plan's Problem statement reproduced inside one method name.

### §4 The new findings must name their kind

**Not cosmetic — it is a baseline-correctness requirement, and it is free only in this release.**

`hashViolation` is `rule::element::message`, and the message carries only basename + resolved target — no line, no kind, no imported names.

**Two distinct faults here, and draft 1's review conflated them. Only one is this release's to fix.**

Measured on the _current_ build (`notImportFrom('**/src/core/**')` over `src/conditions/**`): 47 findings, **39 distinct hashes, 8 colliding pairs (17%)**. Every pair is **import/import** — a type-only and a runtime import of the same module in one file:

```
dependency.ts:5  import { isTypeOnlyImport } from '../core/import-options.js'
dependency.ts:9  import type { ImportOptions } from '../core/import-options.js'
```

That is **pre-existing, within-kind, and per-kind verbs do not touch it** — both are `kind === 'import'`. It is filed separately (see Out of scope); do not let §4 claim to fix it.

What §4 _does_ fix is the **new** kinds needing distinct identities from the `import` finding they would otherwise share a message with: a re-export of a module the file also imports produces byte-identical text today, so it would be absorbed by the existing baseline entry and never reported as new. Replaying a frozen 0.26.0 baseline against the widened build: 49 findings, 1 unbaselined — and **the re-export was absorbed by a pre-existing entry**, so it was never reported as new.

That breaks the migration's core promise. It also gives every new finding a remedy that does not fit its line: measured on this repo, `src/core/index.ts:1` is `export type { Predicate } from './predicate.js'` and is reported as _"index.ts **imports** …/predicate.ts"_ with _"Invert the dependency … pass it in as a parameter"_ — nonsense for a re-exported type alias.

So each kind a condition can report gets its own verb: `re-exports`, `dynamically imports`, `references the type from`. (`require` needs none in 0.27 — no site consumes it.) **`kind === 'import'` messages stay byte-identical**, so every existing baseline survives; the new kinds get distinct identities _and_ fitting remedies. Doing this in 0.28 instead invalidates every baseline written at 0.27.

### §5 Bug 0015 is descoped to a diagnostic

**The failing tier is withdrawn.** Three independent measurements:

- **This repo's own presets.** Six boundaries, one dependency-free `shared/constants.ts`: `strictBoundaries` generates 13 rules, **12** of which have subjects and zero edges. `applySharedIsolation` emits one rule per (sharedGlob × boundaryFolder), so one legitimate file produces one finding per boundary.
- **A real layered demo.** A pure-entity innermost layer: 2 subjects, 0 edges → unsuppressible error under `layered/innermost-isolation`. An i18n loader: 3 subjects, 0 edges.
- **The `ignoreTypeImports` inversion.** Draft 1 required counting edges _after_ the filter. So a layer whose only dependency is `import type` — the outcome the docs recommend `ignoreTypeImports` for — counts zero and fires on the **best possible** result.

The remedy for all of these is "delete the rule" or "delete the preset". Draft 1 refuted subject-level failure for exactly this reason and then reinstated it one level up; summing zero over twenty subjects does not turn maximal compliance into absent evidence. And the ROADMAP already records the precedent: the slice discovery guards were **built and withdrawn from 0.18.1 because they fire on legitimate projects with no opt-out**, returning only once an opt-out exists.

It also could not have shipped as specified: `collectWithAssertionGuard` is element-type-agnostic and cannot count edges, and `Condition<T>` is a public exported type backing `defineCondition()`.

**What ships instead, in a later release:** a diagnostic for a glob that was never exercised, aimed at the case that is actually silent. Draft 1 aimed it at `onlyImportFrom('**/nowhere/**')`, which produces **96 violations** — maximally loud. The silent case is a **denylist** glob matching nothing: `notImportFrom('**/legcay/**')` reports zero forever. `diagnose()`'s existing skip is the precedent and must not be "fixed" — _"a positive condition glob is indistinguishable from an armed tripwire that has not fired"_.

Two prerequisites, both stated so the follow-up is not surprised: `diagnose()` currently promises to report "without running any of them", and a glob-exercise tally requires running; and `doctor` cannot load a rule file that imports vitest, so the authoring shape 0015 is about is the one the channel cannot reach.

## Sequencing and release shape

**0.27.0 ships 0022 alone.** 0015's diagnostic follows. Draft 1 bundled them; the reviews were unanimous against it:

- **Attributability.** One undifferentiated delta cannot distinguish a widening red (a real barrel crossing a boundary, remedy: remove the coupling) from a vacuity red (remedy: fix the rule). Opposite remedies.
- **Opposite suppressibility.** 0022's findings are ordinary violations — baselineable, ratchetable. A `bypassFilters` finding is not, and `baseline` exits non-zero on one, so bundling removes the adopter's only staging tool for the half that has one.
- 0015's blast radius is **unmeasurable** until 0022 ships: four of this repo's six zero-static-import files are barrels that stop being edgeless under the widening.

The forced-ordering argument from draft 1 is satisfied by construction, since 0022 goes first.

## Guards

### The dynamic independence guard is cut

Draft 1's load-bearing new idea was `await import()` versus the static walk. **The re-export half works, and it must run inside vitest.** Two draft-1 reviewers reached opposite conclusions here; both were right, because they measured different runtimes. Settled:

```
inside vitest:  await import('…/barrel.js')  ->  keys = ["MARKER","STAR"]
bare node:      await import('…/barrel.js')  ->  ERR_MODULE_NOT_FOUND
```

So **no `tsc` step is needed** — vitest resolves `.js` → `.ts` and transforms the fixture, and bug 0024's problem does not recur. But say plainly what the guard then compares, because "runtime" overstates it: the other side of the comparison is **vite's resolver**, not the Node module system. Vite and ts-morph are two independent implementations of TS-aware resolution, so the guard is a real cross-check on the resolution _algorithm_ — it is not the module-system oracle draft 1 implied, and it cannot catch anything both tools get wrong the same way.

**A consequence for `names`, measured in the same run.** The namespace above contains `STAR`, which arrives through `export * from './other.js'`. The static walk cannot know that name without resolving the target and reading its exports — so `names` for a star edge must be **empty**, and the runtime side has names with no static counterpart. The guard therefore cannot do a naive per-edge `names` comparison whenever a star edge is present. Either `names` is derived by resolving (which makes `moduleEdges` recursive, and needs an answer for circular pairs), or — preferred — **star edges are asserted by target only, and named edges by `names` → target**, with the split stated. Five of six sabotages were caught by four different assertions; the sixth is what `names` exists for.

**The dynamic half exits 0 on the exact defect it was invented for.** Reverting `resolvedPath` to `undefined` for non-relative dynamic specifiers — `reverse-dependency.ts:49`'s defect — is **uncaught**, because Node has no tsconfig `paths` support: aliases raise `ERR_MODULE_NOT_FOUND` rather than disagreeing, and bare specifiers diverge by design under bug 0014. Residual scope is relative specifiers, where both sides reduce to a path join and cannot fail differently. **Cut it and state the gap.** (If the alias case is wanted later, Node subpath imports — `"imports": { "#internal/*": … }` — are honoured by both resolvers and a disagreement there is a real signal.)

The sixth sabotage the re-export half missed: swapping two edges' resolved targets. That is why `ModuleEdge` carries `names` — the guard must compare edge→target pairs, not sets of names.

### The parity test stays a non-guard

`expect(forward).toEqual(reverse)` is a tautology once both call `moduleEdges`, and `0 === 0` is green. Keep it as a re-divergence pin, **labelled**, scoped to edges resolving to a project source file — the bare-target policies are deliberately opposed.

### Everything else

- **Explicit expected edge lists**, with the deliberate absences part of the list. An omitted row is indistinguishable from a missed edge.
- **By identity, `relpath:line`, never basenames** — draft 1's item 14 used basenames and `dependency.ts` appears 5× in that list, so a multiset survives losing a re-export and gaining a duplicate inside one file.
- **A vacuity assertion on every fixture** (`edges.length > 0`), and `checked > N` on every corpus loop.

## Test inventory

1. §1's 19-form table as an edge list, with all five non-edge rows provably absent, **including the `NoSubstitutionTemplateLiteral` row**.
2. §2's per-kind matrix — `import` via `isTypeOnlyImport` (incl. `import React, { type FC }` as runtime), both `reexport` trap rows, dynamic/type-expression/require constants.
3. Uniform `lit.getSymbol()` resolution per kind, incl. `paths` aliases, bare packages, and the `type A = import('./barrel.js').Deep` → **barrel, not impl** case.
4. Runtime independence, **re-export kind only, and it must run under vitest** (bare Node cannot import a `.ts` fixture through `.js` specifiers — measured, `ERR_MODULE_NOT_FOUND`). Named edges compared `names` → target; **star edges by target only**, because the runtime namespace flattens them and the static walk deliberately does not. The dynamic half is cut, with both gaps stated in the file header: what it compares is vite's resolver against the TS compiler — two implementations, not the module system.
5. Per kind × per family by `relpath:line` identity, with absences.
6. `notHaveAliasedImports` pinned as an **explicit expected list** over a fixture holding both `import { x as y } from` and `export { x as y } from` — exactly one violation, named. It stays on `getImportDeclarations()`, so this is a no-change pin: it must red if anyone routes it through the widened walk. Not "byte-identical to today", which has no _today_ inside the new build.
7. `dependOn`: a type-only re-export does **not** satisfy it (the false green in §3), and a runtime edge does.
8. Parity, labelled a non-guard, scoped to resolved project files.
9. §4's per-kind messages: `import` byte-identical to 0.26.0; each new kind distinct. **Plus the collision pin** — a file that both imports and re-exports the same module yields two distinct `hashViolation` values.
10. A frozen 0.26.0 baseline (committed fixture) replays against the new build: every pre-existing static finding matches, and the new-kind findings are reported as new.
11. Corpus-wide per-edge equivalence on **one build**: `moduleEdges` filtered to `kind === 'import'` is sequence-equal to `getImportDeclarations().map(…)` over `{line, candidates, typeOnly}`, with `checked > 500`. Message equality follows, because the template is a pure function of those fields. **`importCandidates` and `isTypeOnlyImport` stay exported and used by this test** — draft 1's note that ESLint flagging them unused is a good signal is incompatible with having this guard.
12. `arch-rules.test.ts` positive control: the conditions see this repo's real edges, by `relpath:line`, derived **after** the widening, using `inProjectSrc()` rather than a raw folder glob.
13. `layered/type-imports-only` gains an edge-identity assertion — it is pinned by `.some(v => v.ruleId === …)` at four sites and nothing pins _which_ import is exempt.
14. The `importFrom` predicate and `notImportFrom` condition agree on one fixture — the two-definitions-in-one-identifier case.
15. A bare dynamic import (`import('picomatch')`, `resolvedPath: undefined`, `candidates: ['picomatch']`) under `onlyImportFrom` in **both** option states — the real unresolvable case, not the template one.
16. `require` kinds: `import x = require('s')` in `.ts`, `require('s')` in `.js` under `allowJs`, both classified **runtime**, not `type-expression`.
17. Reverse graph: dedup on `(importer, target)` — measured today, one importer with two static imports of one target yields **two byte-identical violations at the same `file:line`**, hence two identical baseline hashes.

**On `type-expression`:** measured **0 instances** across every file the tsconfig reaches, including `node_modules`. So items 3 and 5 need a dedicated fixture or the changelog's "the reverse half gains `type-expression`" claim is asserted by nothing. Add the fixture or drop the claim.

## Migration

**The recipe, verified by running it.** Note first what does **not** work, and it is worse than draft 1 said: a separately-installed `ts-archunit@0.26.0` binary **prints `0.26.0` and reports the new findings**, because `loadRuleFiles` imports the rule file from the user's project and its `import … from '@nielspeter/ts-archunit'` resolves against the project's `node_modules`. A team bisecting "which version did this?" pins @0.26.0, sees identical output, and concludes the upgrade was not the cause. This needs to be a boxed warning, and the CLI should print one line when the two versions differ.

```bash
# BEFORE upgrading — refresh the baseline you already have, in place, and commit it.
npm run arch:baseline        # or: ts-archunit baseline <rules> --output arch-baseline.json
# upgrade, then CI's normal invocation reports only what 0.27.0 added.
```

Refreshing **in place** is better than draft 1's `pre-0.27.json`: measured, a config-file `baseline: 'arch-baseline.json'` means plain `check` keeps using the old file while the recipe's artifact sits unused. And `baseline` has no clobber guard, so an adopter reaching for `npm run arch:baseline` at the wrong moment overwrites their snapshot — `baseline` should refuse to overwrite without `--force`, like `init` does.

**The honest middle, which draft 1 missed.** Regenerating auto-accepts the release's best finding; triaging 300 findings across 40 barrels is not a sprint. The third option is in the product already:

```ts
...strictBoundaries(p, { … }).map((b) => b.asSeverity('warn')),
```

Measured: 9 findings → 4 errors, 5 warnings, CI green, and **0.26.0 was the release that made warn output actually appear**. A warn prints on every run and cannot be silently forgotten; a regenerated baseline makes the finding invisible forever. Ratchet down, then drop the `.asSeverity('warn')`.

Name the move a team will otherwise find on their own: `.excluding('index.ts')` silences **every barrel in the project at once**, including their legitimate static imports, because `element` is the basename. It belongs on the do-not-reach-for list beside `--changed`.

**`--changed` must be made to speak — five lines, and it is not a migration note.** Measured: 9 error-severity findings, `--changed` reports **zero**, exit 0, and `--format json` emits `"reason": null`. `DiffFilter.size` exists and is **never read anywhere**. Every finding this release adds is by construction in a file nobody touched, so `--changed` hides 100% of them and yields a permanently green build. One stderr line on the channel 0.26.0 built — `[ts-archunit] --changed: 9 violations in unchanged files were not reported (4 files).` — plus `summary.reason` in the JSON. Generic, permanent, and it cannot be un-read like a release note.

**Four reversals, with the emphasis corrected.** Draft 1 led with `docs/modules.md:161`, which is a documented _limitation_ plus a workaround pointer — reversing a limitation only makes rules stricter. The genuine guarantee reversal is the one draft 1 said to delete: **`dependOn`'s JSDoc**, which reverses red→green. Lead with that. Then: barrels become dependency-bearing (`src/index.ts` 0 → 114 dependencies — the sentence that lets a reader predict their own diff); the reverse half gains kinds, so `noDeadModules()` reports fewer orphans (**`noDeadModules` is the name in the docs and the rule teams run** — draft 1 named only `beImported`); and `modules.md:161`'s workaround pointer becomes wrong advice.

**Doc surfaces draft 1 missed:** `docs/standard-rules.md:268` (enumerates which forms resolve), `docs/slices.md:22-45` (teaches import-glob semantics on the page documenting the still-static slice graph), `docs/api-reference.md:98` vs `:223` (predicate and condition tables twenty lines apart, reading identically), `docs/what-to-check.md:666` (the barrel recipe — after 0.27 the barrel is the likeliest violator), `docs/.vitepress/dist/` (committed build output carrying the old contract), and **consumer-side copies**: `explain --format agent` output is pasted into `CLAUDE.md` by a documented workflow, so the preset `imperative` strings now mean something wider with no refresh mechanism. Tell people to re-run it.

## Out of scope

- **The slice graph** (`slice-graph.ts:48,105`) — `beFreeOfCycles()`, `notDependOn()`, `respectLayerOrder()` stay static-only. Barrel re-export is _the_ classic cycle shape, so this is valuable, but a cycle finding is the hardest class to remedy and it is a different upgrade story. **The disclosure must be louder than a changelog line**: one sentence in `beFreeOfCycles()`'s JSDoc and in `layered/no-cycles` / `boundaries/no-cycles` metadata, because `strictBoundaries` will red on a barrel from one rule and stay silent on it from its sibling, in the same run. Rule metadata is read on every failure; a changelog is read once. The retrofit is cheap (both sites are resolved-file-only); the reds are not.
- **`declare module './rel.js'`** — a real compile-time reference the binder routes to `moduleAugmentations`, so `getImportStringLiterals()` structurally cannot see it. State it as a hole, not a correct exclusion.
- **The pre-existing within-kind hash collision** (§4). 17% of findings in the measured sample share a hash with a sibling, because the message carries neither the line nor the imported names. Two consequences, both independent of this release: you cannot accept one of a colliding pair into a baseline without the other, and if one is later fixed the survivor still matches the stale entry — so the baseline silently keeps accepting a violation that is no longer the one it recorded. Filed as its own bug; fixing it changes existing messages, which is exactly what this release's constraint forbids.
- **Enforcing the `require` kind.** The kind is classified so it cannot be mistaken for an erased edge, and consumed by nothing. Enforcing it is a separate decision for two reasons: its visibility is **asymmetric by file type** — `import x = require('s')` is seen in `.ts`, bare `require('s')` only in `.js` under `allowJs` — and a coverage boundary decided by file extension is exactly what §3 refuses for `notHaveAliasedImports`. A project without `allowJs` would get partial CJS enforcement with no way to tell.
- **An `includeReExports` option** — it reinstates two user-selectable definitions of "an import", and 0069 settled the principle: "an opt-out is the first thing an agent adds on the first red."
- **Exporting `ModuleEdge`** — deferred, but note the cost honestly: `defineCondition()` is a public, documented, taught extension point, so every custom dependency condition in the wild will keep calling `getImportDeclarations()` and reproduce bug 0022 outside the package, where no future fix reaches it. §2's four-row trap table is the evidence they will get it wrong. Revisit in 0.28 rather than never.

## Notes for whoever implements

- **`onlyBeImportedVia` double-reports today**, and unifying the walk forces the decision: `addToGraph`'s `deduplicate` flag is `false` for static imports. Dedup on `(importerPath, targetPath)`.
- **The reverse graph hardcodes `line: 1`**, so parity can only key on `(importer, imported)`.
- **The reverse graph's whole-graph cache is keyed on `Project` alone and computed from the file list of the first call**, which is never part of the key — stale-forever if the file set changes. Nothing in `src/` mutates a `Project` after handing it out, so this is a consumer hazard; say so in the header rather than leaving it discovered.
- **`ImportTypeNode.getStartLineNumber()`** is the type node's line, not the statement's; they differ for a multi-line type alias.
- **Re-run the blindness sabotage after the fix and put the number in the changelog.** If it is still ~38/2478, the change added visibility without coverage.
- **Enumerate the sabotage matrix from the diff**, read exit codes, and expect reverts caught by nothing on the first round.
- **Do not filter probe output with `grep -E '^MARKER'`.** vitest prefixes the _first_ `console.log` of a test with ANSI codes, so an anchored pattern silently drops that line — which during this plan's own measurement briefly looked like `getImportStringLiterals()` missing a plain static import. Use an unanchored pattern, and print a count to compare against.
- **`plans/0069-appendix-vacuous-tests.md` has a hole**: it enumerated tests failing under an empty _selector_, so `tests/conditions/dependency.test.ts:43` ("passes for a module with no imports (vacuously true)") is not in it. Under §5 that test stays green — the failing tier is withdrawn — but the appendix should say why.
