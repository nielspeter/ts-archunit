# Plan 0071 — Forward dependency conditions see every module edge

**Status:** DRAFT 3 — implementation-ready. Drafts 1 and 2 each had claims measured wrong; that history is in this branch's commit messages and in the two bug files, not here.
**Priority:** High. [Bug 0022](../bugs/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md) is a false green in the enforcement itself: `export { x } from '…'` and `import('…')` cross every banned edge unflagged.
**Closes:** bug 0022. [Bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md) is **out of scope** — its option 1 is refuted and the evidence lives in that file.

**Two releases, deliberately:**

|                           |                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **0.27.0 — instruments**  | `--changed` discloses what it filtered; `baseline` prints the delta it accepted; `docs/upgrading.md`               |
| **0.28.0 — the widening** | `moduleEdges`, the four forward conditions, the negative predicate, the reverse-graph consumers, per-kind messages |

Instruments first, because an adopter's **pre-upgrade** measurement must be trustworthy before the thing it measures changes. Same shape as 0.22.0 → 0.23.0. Cost: one extra bump, and the fix slips a release — cheap against shipping a migration path that cannot be relied on.

## Problem

`src/conditions/dependency.ts` collects edges from `sf.getImportDeclarations()` at five sites — static `import` statements and nothing else. The reverse graph indexes static imports, re-exports **and** dynamic imports, so `onlyBeImportedVia('…')` sees a re-export as an import and `notImportFrom('…')` does not.

### The bar

Blinding `onlyImportFrom` + `notImportFrom` to collect no edges — ADR-008's "completely broken" floor. Reproduced in three isolated worktrees:

|                                                                |                                |
| -------------------------------------------------------------- | ------------------------------ |
| Baseline                                                       | 2479 passed / 176 files        |
| Both conditions collecting nothing                             | **38 failed**, 12 files        |
| `tests/archunit/arch-rules.test.ts` (18 of the affected sites) | **39/39 passed — zero caught** |
| Widening to all edge kinds                                     | **2479 passed — zero changed** |

Widening was verified non-trivial first: **647 static declarations → 803 edges over `src/`** (+24%), `src/index.ts` 0 → **114**.

So 1.5% of the suite distinguishes "collects static imports" from "collects nothing", and **0 of 2479** distinguishes it from "collects everything". The suite pins that the loop runs, never what it collects. **The test surface is most of the work.**

## §1 One walk, `src/core/module-edges.ts`

`SourceFile.getImportStringLiterals()` returns one literal per module specifier across every edge-carrying form. Measured, 19 forms:

| Form                                                                                                                        | literal? | parent kind                   |                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- | --------------------------------------------------------------------- |
| `import { x } from 's'`, `import type { X }`, `import { type X as X2 }`                                                     | 1        | `ImportDeclaration`           |                                                                       |
| `import 's'` (side-effect), `import {} from 's'`                                                                            | 1        | `ImportDeclaration`           | runtime, 0 named specifiers                                           |
| `import * as NS from 's'`, `import D from 's'`                                                                              | 1        | `ImportDeclaration`           | runtime binding                                                       |
| `export { x } from 's'`, `export { x as y } from 's'`, `export * from 's'`, `export * as NS from 's'`, `export {} from 's'` | 1        | `ExportDeclaration`           | runtime                                                               |
| `export type { X } from 's'`, `export { type X } from 's'`, `export type * from 's'`                                        | 1        | `ExportDeclaration`           | type-only — §2                                                        |
| `import('s')`                                                                                                               | 1        | `CallExpression`              |                                                                       |
| ``import(`s`)``                                                                                                             | 1        | `CallExpression`              | **`NoSubstitutionTemplateLiteral`** — hazard below                    |
| `type A = import('s').X`                                                                                                    | 1        | `LiteralType`                 |                                                                       |
| `import x = require('s')`                                                                                                   | 1        | **`ExternalModuleReference`** | **runtime**                                                           |
| `require('s')` in `.js` under `allowJs`                                                                                     | 1        | `CallExpression`              | **runtime, indistinguishable from `import()` by parent kind**         |
| `require('s')` in `.ts`                                                                                                     | 0        | —                             |                                                                       |
| `declare module 's' {}`                                                                                                     | 0        | —                             | correctly not an edge                                                 |
| `import('./' + n)` (computed)                                                                                               | 0        | —                             | not an edge for **any** family                                        |
| `export { x as y }` (no specifier)                                                                                          | 0        | —                             |                                                                       |
| `declare module './rel.js' { … }`                                                                                           | 0        | —                             | **a hole**, not a correct exclusion — routed to `moduleAugmentations` |

**Two classification traps**, both of which would mark a _runtime_ dependency as erased:

- **`import x = require('s')`** — parent `ExternalModuleReference`, grandparent `ImportEqualsDeclaration`. A 4-way branch ending in `else → 'type-expression'` gives it `typeOnly: true`, exempt under `ignoreTypeImports`. Common in hand-written `.d.ts`.
- **`require()` in `.js`** — the binder collects it into `sourceFile.imports` with parent `CallExpression`. Discriminate with `callExpr.getExpression().getKind() === SyntaxKind.ImportKeyword`, as the reverse graph already does.

**Type hazard:** ``import(`./x.js`)`` yields `NoSubstitutionTemplateLiteral`, for which `Node.isStringLiteral()` is **false**, while `getImportStringLiterals()` is declared `StringLiteral[]`. ADR-005 forbids `as`, so an implementer narrowing defensively drops the edge and typecheck says nothing. Guarded by identity, item 4.

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
   * `decl.getStartLineNumber()` for `kind === 'import'`: 88 of this repo's 1769
   * import declarations (5%) put the specifier on a different line from the
   * keyword, so keying off the literal moves 5% of reported lines. Not a
   * baseline concern — `hashViolation` never sees the line — but it drives the
   * code frame and the GitHub annotation position.
   */
  readonly line: number
  /** Erased at compile time, so no runtime dependency. Per-kind; see §2. */
  readonly typeOnly: boolean
  /**
   * Named bindings crossing the edge, as written. **Empty for `export *`** — the
   * names it contributes are knowable only by resolving the target and reading
   * its exports, which makes the walk recursive and needs an answer for circular
   * pairs. Measured: a barrel's runtime namespace *does* contain them, so the
   * runtime side of the independence guard has names this field deliberately
   * lacks. Star edges compare by target; named edges by `names` → target.
   * Also empty for `dynamic` and `require`.
   */
  readonly names: readonly string[]
}

/** Every module edge leaving each file, in one call (ADR-007 rule 2). */
export function moduleEdges(
  files: readonly SourceFile[],
): ReadonlyMap<string, readonly ModuleEdge[]>
```

**Resolution is uniform: `lit.getSymbol()`.** Measured across all five parent kinds, with `paths` aliases and bare packages, and it returns the **named** module — `type A = import('./barrel.js').Deep` resolves to `barrel.ts`, where following the type symbol instead lands on `impl.ts` and would make `notImportFrom('**/impl.ts')` fire on a file that never names `impl`. One mechanism, no per-kind branch, no `getType()` call.

**No `candidates` field** — it is `candidatesFor(specifier, resolvedPath)`, so storing it beside its two inputs is two representations of one fact. Expose the function.

**No cache.** Measured on a real preset run: one full walk+resolve pass is 6.7ms over 472 files, and the 79 rules `strictBoundaries` generates have subject sets summing to **1665 file-visits — ~23ms, ~17%** against a 137ms preset baseline. The worst case (527ms, 4.8×) needs rules whose selector spans the whole project — `modules(p).should().notImportFrom(…)` with no `.that()`, which is legal and appears in the docs' own examples. **Name that shape in the changelog** so a consumer reporting a multiple-slowdown can self-diagnose; the fix there is a cache of _resolution_, not of the walk.

**Location:** `src/core/`, not `src/core/engine/`. 60 files under `src/` import ts-morph, so a one-module boundary is cosmetic. The ts-morph-free **return type** is the genuine ADR-007 rule 2 down-payment, and the bulk signature is what makes it one crossing rather than N.

## §2 The `typeOnly` contract

`import type` is a full edge today; the only exemption is `{ ignoreTypeImports: true }`. **That is preserved for `kind === 'import'`.**

| Kind              | Rule                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import`          | **Reuse `isTypeOnlyImport` unchanged.** Its `getDefaultImport()`/`getNamespaceImport()` guards are load-bearing: `import React, { type FC } from 'react'` is a **runtime** edge, and a formula without them classifies it type-only and skips it under `ignoreTypeImports` — a lost existing finding                          |
| `reexport`        | New `isTypeOnlyReExport`: `decl.isTypeOnly() \|\| (namedExports.length > 0 && namedExports.every(isTypeOnly))`. **Both halves needed** — `export type { X as XT } from` has decl `true`/specifiers `false`; `export { type X as XI } from` has decl `false`/specifiers `true`. No default/namespace analogue exists, verified |
| `dynamic`         | Always runtime                                                                                                                                                                                                                                                                                                                |
| `type-expression` | Always erased                                                                                                                                                                                                                                                                                                                 |
| `require`         | Always runtime                                                                                                                                                                                                                                                                                                                |

`onlyHaveTypeImportsFrom` (`:227`) has **no `ImportOptions` overload**, unlike its three siblings. **Pin the asymmetry, do not fix it here:** adding an overload in the release that also widens the condition changes one signature's meaning twice, and `ignoreTypeImports: true` on a type-imports-only condition is near-contradictory. Say that in the JSDoc.

## §3 Per-site disposition

| Site                                                      | Disposition                                                                                       | Direction                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------- |
| `onlyImportFrom` (:57)                                    | all edge kinds; `typeOnly` exempt only under `ignoreTypeImports`                                  | green→red, monotone           |
| `notImportFrom` **condition** (:105)                      | same                                                                                              | green→red, monotone           |
| `notImportFrom` **predicate** (`predicates/module.ts:18`) | same edge set as the condition                                                                    | **subjects LOST** — see below |
| `dependOn` (:155)                                         | **new kinds require runtime; `kind === 'import'` unchanged** — see below                          | red→green, new kinds only     |
| `onlyHaveTypeImportsFrom` (:235)                          | `import` + `reexport` only; **excludes `dynamic`** — see below                                    | green→red, monotone           |
| `notHaveAliasedImports` (:196)                            | **not routed through `moduleEdges`.** Keeps `sf.getImportDeclarations()`, reason in its docstring | none                          |
| `require` kind — every site                               | **excluded.** Each site filters to the kinds it handles                                           | none                          |
| `reverse-dependency.ts` (:77-100)                         | replace all three collectors; delete `resolveDynamicImport`; dedup on `(importer, target)`        | mixed                         |

Measured on this repo: `no-cross-boundary` 289 → **292**, `shared-isolation` 80 → **94**, `innermost-isolation` 20 → **21**, **0 findings lost**, 0 messages or lines changed for pre-existing findings.

**But that measurement cannot see the predicate, and the predicate runs the other way.** The dual-role method is **`notImportFrom`** (and `notImportFromWithOptions`) at `src/builders/module-rule-builder.ts:122`, dispatching to `notImportFromPredicate` before `.should()` and `notImportFromCondition` after — one identifier, two definitions, chosen by chain position. That is this plan's Problem statement inside one method name, so the predicate is **in scope**. Widening it is **anti-monotone**: a file with a matching re-export now fails the predicate and drops out of the selection, so rules select fewer subjects and report **fewer** findings. This repo's dogfood rules use `notImportFrom` in condition position 16 times and predicate position **zero**, and no preset uses the predicate — so "0 findings lost" was measured on a corpus that structurally cannot show the loss. **Monotonicity is a condition-layer property only.** Item 14 asserts a deliberately lost subject, because losing findings is the one direction this release claims cannot happen.

**`dependOn`: only the new kinds require runtime.** Measured — today an `import type` of the target **satisfies** `dependOn`, and `{ ignoreTypeImports: true }` already makes it fail:

```
dependOn('**/src/security/**')  with only an import type    ->  0 violations (satisfied)
dependOn([...], { ignoreTypeImports: true })  same fixture  ->  1 violation
```

So requiring runtime for `kind === 'import'` would be a green→red change to an existing contract **that already has an opt-in** — a docs gap, not a behaviour gap. What this release must not do is _create_ a new false green: `export type { SecurityConfig } from './security-middleware.js'` satisfying `dependOn('**/security/**')` while the server installs nothing. Measured against `docs/modules.md`'s own teaching example, a naive widening turns a real violation into a pass — and on the baseline side that reads as "the violation was fixed", which 0.24.0's table calls success.

So: `reexport`, `dynamic` and `type-expression` count only when runtime; `import` behaves exactly as today. `typeOnly` therefore means something per-kind on this one condition — say it in the JSDoc, which is **rewritten, not deleted**, since it is the only place a reader learns what a `dependOn` green means. Note `dependOn` is not a builder method: it is reached via `.satisfy(dependOn(…))`.

**`onlyHaveTypeImportsFrom` excludes `dynamic`, on ADR-008 rule 2.** Its shipped preset says _"Use `import type { X }` so the dependency is erased"_ — an instruction that cannot be followed for `await import(…)`, and which for a re-export (`export type`) would delete the runtime re-export and change what the module publishes.

**`notHaveAliasedImports` needs no replacement function.** It reads `getImportDeclarations()`, each `getNamedImports()` specifier's `getName()`/`getAliasNode()`, and the declaration node for `importViolation`'s code frame — so a separate `importStatements(sf)` would be `getImportDeclarations()` under a new name, one caller, buying only a label the docstring carries free. It is not an edge condition: it inspects `import` **statement syntax**. The decisive reason not to widen it is the arbitrary boundary — `export { x as y } from './impl.js'` would be flagged and `export { x as y }` would not, decided by whether a specifier happens to be present.

**`require`: classified, consumed by nothing, and not announced.** The kind exists so a 4-way branch cannot mark a CJS runtime dependency as erased. It is unconsumed because **CJS enforcement is a different upgrade story** — its reds land in interop and generated `.d.ts` where the remedy is usually "nothing you can do", and it would hit `allowJs` projects that have not asked. (The file-type asymmetry is a reason to _document_ the hole, not to withhold enforcement; this project ships honest holes elsewhere.) **No changelog entry** — announcing an unconsumed kind sells coverage that does not exist, and a reader would infer "0.28 understands CJS", which is false. Instead, the two places that make a positive claim about which forms are seen — `docs/standard-rules.md:268` and `docs/modules.md:161` — must say no dependency condition enforces `require`, and name the sanctioned alternative: `modules(p).should().notContain(call('require'))`. State its two limits: it cannot express a path glob, and it does **not** match `import x = require('s')`, which is an `ExternalModuleReference`, not a `CallExpression`. Workaround and classifier are asymmetric in opposite directions. And name **item 16 as the kind's only consumer, in the source comment** — ADR-008 rule 5's question answers "pass" here, acceptable because preventing a misclassification is the whole purpose, but say so or 0.29 deletes an unused union member in good faith.

## §4 The new findings must name their kind

`hashViolation` is `rule::element::message`, and the message carries only basename + resolved target. So a re-export of a module the file also imports produces **byte-identical text**, is absorbed by the existing baseline entry, and is never reported as new — which breaks the migration's core promise.

Each kind a condition can report gets its own verb: `re-exports`, `dynamically imports`, `references the type from`. **`kind === 'import'` messages stay byte-identical**, so every existing baseline survives. `require` needs none — nothing consumes it.

**Free only in 0.28.0.** Doing it later invalidates every baseline written at 0.28.

**Not to be confused with [bug 0028](../bugs/0028-two-findings-in-one-file-can-share-a-baseline-identity.md).** Measured on the _current_ build, 8 of 47 findings already collide — every pair `import`/`import`, a type-only and a runtime import of one module in one file. Per-kind verbs do **not** fix those. That is pre-existing, filed separately, and its preferred fix (producer-set `identity`) changes no printed text, so it needs no sequencing against this plan. One real interaction: at 17% collisions, **item 12 must assert on identities, not counts**, or a collision absorbs the finding it checks for.

## Guards

**The parity test 0022 asks for is a tautology** once both halves call `moduleEdges` — `expect(forward).toEqual(reverse)` compares a value to itself, and `0 === 0` is green. Keep it as a **labelled** re-divergence pin, scoped to edges resolving to a project source file (the bare-target policies are deliberately opposed).

**Runtime independence: re-export only, and it must run under vitest.** Settled by measurement — two earlier reviewers disagreed because they measured different runtimes:

```
inside vitest:  await import('…/barrel.js')  ->  keys = ["MARKER","STAR"]
bare node:      await import('…/barrel.js')  ->  ERR_MODULE_NOT_FOUND
```

No `tsc` step is needed. But say what it compares: **vite's resolver against the TS compiler** — two independent implementations of TS-aware resolution, a real cross-check on the resolution _algorithm_, and **not** a module-system oracle. It cannot catch anything both tools get wrong alike.

**The dynamic half is cut.** Reverting `resolvedPath` to `undefined` for non-relative dynamic specifiers — `reverse-dependency.ts:49`'s actual defect — exits **0, uncaught**, because Node has no tsconfig `paths` support: aliases raise `ERR_MODULE_NOT_FOUND` rather than disagreeing, and bare specifiers diverge by design under bug 0014. Residual scope is relative specifiers, where both sides reduce to a path join. (If wanted later: Node subpath imports — `"imports": { "#internal/*": … }` — are honoured by both resolvers, and a disagreement there is a real signal.)

**Everything else:** explicit expected edge lists with the deliberate absences _in_ the list; identity as `relpath:line`, **never basenames** (`dependency.ts` appears 5× in the affected corpus, so a multiset survives losing a re-export and gaining a duplicate); `edges.length > 0` per fixture; `checked > N` on every corpus loop.

## Test inventory

**0.27.0 — instruments**

1. `--changed` discloses what it filtered: count and file count reach stderr, and `summary.reason` is non-null in `--format json`. Asserted with findings present **and** absent.
2. `baseline` prints the delta it accepted (`41 → 78 entries (+37, −0)`), including the first-run case with no prior file.
3. `docs/upgrading.md` exists and its table covers every released version — **derived from `CHANGELOG.md`'s headings**, so a new release without a row fails.

**0.28.0 — the widening**

4. §1's 19-form table as an edge list, all five non-edge rows provably absent, **including the `NoSubstitutionTemplateLiteral` row**.
5. §2's per-kind matrix — `import` via `isTypeOnlyImport` (incl. `import React, { type FC }` as **runtime**), both `reexport` trap rows, the three constants.
6. Uniform `lit.getSymbol()` per kind: `paths` aliases, bare packages, and `type A = import('./barrel.js').Deep` → **barrel, not impl**.
7. Runtime independence, re-export only, under vitest. Named edges by `names` → target; **star edges by target only**.
8. Per kind × per family by `relpath:line`, with absences.
9. `notHaveAliasedImports` as an explicit expected list over a fixture holding both `import { x as y } from` and `export { x as y } from` — exactly one violation. A **no-change pin**: it must red if anyone routes this condition through the widened walk.
10. `dependOn`: a type-only **re-export** does not satisfy it; a plain `import type` still does (unchanged); a runtime edge does.
11. **Each new kind's remedy remediates.** Apply the stated fix to a re-export, a dynamic import and a type-expression finding; assert each clears. Distinctness is not honesty — a re-exported type alias currently gets _"invert the dependency … pass it in as a parameter"_.
12. Per-kind messages: `import` byte-identical to 0.27.0; each new kind distinct — **asserted on identities, not counts** (§4).
13. A frozen 0.27.0 baseline (committed fixture) replays: every pre-existing static finding matches, and the new-kind findings are reported as new.
14. **The predicate loses a subject.** A fixture where a file re-exports from a banned path drops out of `.that().notImportFrom(…)` — the anti-monotone direction, asserted by identity.
15. Corpus-wide per-edge equivalence on **one build**: `moduleEdges` filtered to `kind === 'import'` sequence-equal to `getImportDeclarations().map(…)` over `{line, candidates, typeOnly}`, `checked > 500`. Keep `importCandidates` and `isTypeOnlyImport` exported and used _by this test_.
16. `require` kinds: `import x = require('s')` in `.ts` and `require('s')` in `.js` under `allowJs`, both classified **runtime**, not `type-expression`. **The only consumer of the kind.**
17. A bare dynamic import (`import('picomatch')` → `resolvedPath: undefined`, `candidates: ['picomatch']`) under `onlyImportFrom`, in both option states.
18. `arch-rules.test.ts` positive control: the conditions see this repo's real edges, by `relpath:line`, derived **after** the widening, using `inProjectSrc()` rather than a raw folder glob.
19. `layered/type-imports-only` gains an edge-identity assertion — pinned by `.some(v => v.ruleId === …)` at four sites, and nothing pins _which_ import is exempt.
20. Reverse graph dedups on `(importer, target)` — measured today, one importer with two static imports of one target yields two byte-identical violations at the same `file:line`.

**On `type-expression`:** measured **0 instances** anywhere the tsconfig reaches, including `node_modules`. Items 6 and 8 need a dedicated fixture, or the changelog's "the reverse half gains `type-expression`" claim is asserted by nothing.

## Migration

**0.27.0 ships the instruments and the page.** `docs/upgrading.md`: one table (version → changes enforcement? → action required? → the action), one ordered recipe for coming from ≤0.22, and a sidebar entry in `docs/.vitepress/config.ts`.

This is not tidiness. **Followed in sequence, the existing per-release notes produce the false green this project exists to prevent:** 0.23.0 says regenerate the baseline, 0.24.0 says regenerate when convenient, 0.28.0 will say regenerate **before upgrading**. An adopter on 0.21.0 reading them in order regenerates _last_ — after the widening — and silently accepts every finding the release adds. Five releases dated one day, and the actions interact.

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

**Doc surfaces:** `docs/standard-rules.md:268`, `docs/slices.md:22-45` (teaches import-glob semantics on the page documenting the still-static slice graph), `docs/api-reference.md:98` vs `:223` (predicate and condition tables twenty lines apart, reading identically), `docs/what-to-check.md:666` (the barrel recipe — after 0.28.0 the barrel is the likeliest violator), and **consumer-side copies**: `explain --format agent` output is pasted into `CLAUDE.md` by a documented workflow, so preset `imperative` strings mean something wider with no refresh mechanism. Tell people to re-run it. (`docs/.vitepress/dist/` is **not** committed — it is gitignored — so it is not a surface.)

## Out of scope

- **The slice graph** (`slice-graph.ts:48,105`) — `beFreeOfCycles()`, `notDependOn()`, `respectLayerOrder()` stay static-only. Barrel re-export is _the_ classic cycle shape, so this is valuable, but a cycle finding is the hardest class to remedy and it is a different upgrade story. **The disclosure must be louder than a changelog line:** one sentence in `beFreeOfCycles()`'s JSDoc and in `layered/no-cycles` / `boundaries/no-cycles` metadata, because `strictBoundaries` will red on a barrel from one rule and stay silent on it from its sibling **in the same run**. Rule metadata is read on every failure; a changelog is read once. The retrofit is cheap (both sites are resolved-file-only); the reds are not.
- **Bug 0015** — option 1 refuted; evidence and option 2 in that file.
- **Bug 0028** — the pre-existing within-kind collision (§4).
- **`declare module './rel.js'`** — a real compile-time reference the binder routes to `moduleAugmentations`, so `getImportStringLiterals()` structurally cannot see it. A hole, stated.
- **Enforcing `require`** — §3.
- **Making `dependOn` require runtime for `kind === 'import'`** — `{ ignoreTypeImports: true }` already expresses it; a docs gap, not a behaviour gap.
- **An `includeReExports` option** — it reinstates two user-selectable definitions of "an import", and 0069 settled the principle: "an opt-out is the first thing an agent adds on the first red."
- **Exporting `ModuleEdge`** — deferred, with the cost recorded: `defineCondition()` is public, documented and taught, so every custom dependency condition in the wild keeps calling `getImportDeclarations()` and reproduces bug 0022 outside the package, where no fix of ours reaches. §2's trap table is the evidence they will get it wrong. Revisit in 0.29, not never.

## Notes for whoever implements

- **`onlyBeImportedVia` double-reports today.** `addToGraph`'s `deduplicate` flag is `false` for static imports: one target, one importer, two static imports → **two byte-identical violations at the same `file:line`**, hence two identical baseline hashes. Dedup on `(importerPath, targetPath)`.
- **The reverse graph hardcodes `line: 1`**, so parity can only key on `(importer, imported)`.
- **The reverse graph's cache is keyed on `Project` alone** and computed from the file list of the first call, which is never part of the key — stale-forever if the file set changes. Nothing in `src/` mutates a `Project` after handing it out, so it is a consumer hazard; say so in the header.
- **`ImportTypeNode.getStartLineNumber()`** is the type node's line, not the statement's.
- **Re-run the blindness sabotage after the fix and put the number in the changelog.** If it is still ~38, the change added visibility without coverage.
- **Enumerate the sabotage matrix from the diff**, read exit codes, never the reporter text.
- **Do not filter probe output with `grep -E '^MARKER'`** — vitest prefixes a test's first `console.log` with ANSI codes, so an anchored pattern drops that line. It briefly looked like `getImportStringLiterals()` was missing a plain static import.
- **`plans/0069-appendix-vacuous-tests.md` has a hole**: it enumerated tests failing under an empty _selector_, so `tests/conditions/dependency.test.ts:43` ("passes for a module with no imports (vacuously true)") is not in it. That test stays green — bug 0015's failing tier is refuted — but the appendix should say why.
