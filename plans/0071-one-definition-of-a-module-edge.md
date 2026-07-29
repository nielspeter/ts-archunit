# Plan 0071 — One definition of a module edge, and a rule that tested none

**Status:** READY — designed from a three-persona review of the two bugs (architect, testing, product), every claim below re-measured on `main` @ v0.26.0.
**Priority:** High. [Bug 0022](../bugs/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md) is a false green in the enforcement itself: `export { x } from '…'` and `import('…')` cross every banned edge unflagged, and the library's two halves disagree about what "imports" means. [Bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md) is the vacuity half.
**Effort:** ~2 days. One shared walk, six site dispositions, one policy decision, and a test surface built from scratch — because 98.5% of the existing one cannot see either defect.
**Closes:** bugs 0022 and 0015.
**Both bugs' suggested fixes are withdrawn.** See "Two withdrawn premises". They were measured wrong, not merely improvable.

## Problem

`src/conditions/dependency.ts` collects edges from `sf.getImportDeclarations()` at five sites. That walk sees static `import` statements and nothing else. The reverse graph (`reverse-dependency.ts`) indexes static imports, re-exports **and** dynamic imports — so `onlyBeImportedVia('…')` sees a re-export as an import and `notImportFrom('…')` does not. A rule pair that reads as two views of one graph checks two different graphs.

Separately, an allowlist constrains **edges**, not subjects: a subject with zero edges has nothing to violate and passes, however broken the allowlist.

### The measurement that sets the bar

Blinding `onlyImportFrom` and `notImportFrom` to collect **no edges at all** — the "completely broken" floor ADR-008 asks about:

|                                                       |                                       |
| ----------------------------------------------------- | ------------------------------------- |
| Baseline                                              | 2478 passed / 176 files               |
| Both conditions collecting nothing                    | **38 failed** / 2440 passed, 12 files |
| `tests/archunit/arch-rules.test.ts` (18 of the sites) | **39/39 passed — zero caught**        |
| Widening the walk to all four edge kinds              | **2478 passed — zero changed**        |

Reproduced three times independently (two reviewers, plus a clean `git worktree` run). Two numbers matter and they point the same way:

- **1.5% of the suite** distinguishes "collects static imports" from "collects nothing".
- **0 of 2478** distinguishes "collects static imports" from "collects everything".

So the existing 125 test sites pin **that the loop runs**, never **what it collects**. The dogfood rules in `arch-rules.test.ts` are the largest block and contribute nothing, because every one of them asserts _zero_ violations — and zero edges yields zero violations. This plan's test surface is therefore not a formality; it is most of the work.

## Two withdrawn premises

Recording these because both reports read as authoritative and both are wrong on a load-bearing point.

### 0022: "extract the reverse graph's three collectors and point the five forward sites at them"

**The reverse graph is the weaker half.** `resolveDynamicImport` (`reverse-dependency.ts:49`) returns `undefined` for every non-relative specifier by construction, and its relative branch is a hand-rolled candidate guess. Measured over 7 non-static edges in a project with `paths: { "@/*": ["src/*"] }`, it loses **4 of 7** — every `@/`-aliased and every bare specifier.

The forward side deliberately matches the **raw specifier** for non-relative imports (`src/core/import-candidates.ts`). That is bug 0014's fix: `notImportFrom('fastify')` compared against `node_modules/@types/fastify/index.d.ts` never matched. Porting the reverse definition forward would reintroduce bug 0014 **inside the new edge kinds** — `notImportFrom('picomatch')` would still miss `await import('picomatch')`, which is the single most common real evasion of a package ban.

**The extraction runs forward-out.** Generalize `importCandidates` into a kind-independent walk; the reverse graph becomes a consumer that filters to resolved project files.

### 0015: "an edgeless subject should fail" (and the opt-in alternative)

For the `only*` family, **zero edges is maximal compliance, not absent evidence.** `onlyImportFrom('**/domain/**')` over an import-free `domain/entity.ts` certifies that the file imports nothing outside `domain` — which it does, perfectly.

Measured on this repo: 14 of 138 `src/` files have zero static imports, and 10 are pure leaf modules — `tarjan.ts`, `ansi.ts`, `code-frame.ts`, `stderr.ts`, `shallow-clone.ts` and friends. `tarjan.ts` is a dependency-free algorithm, the ideal innermost-layer citizen, and 0015-as-filed fails it under `layered/innermost-isolation` at error severity. Ask ADR-008 rule 2 for the remedy and the candidates are: add an import (actively harmful, and what an agent will do), exclude a working rule, narrow the selector, or delete the rule. **None remediate anything, because nothing is wrong with the code.**

The opt-in alternative is also dead, and this repo has already paid for that lesson twice — `terminal-builder.ts` records it in one line: _"`.expectNonEmpty()`, which is the opt-in this whole plan exists because nobody uses."_

**0015's real fault is rule-level**, and its own reproduction hides it: `subjects selected 1` makes subject-level and rule-level coincide. With 20 subjects, 19-with-edges and 1-without is a rule doing its job.

## Design

### §1 One walk, `src/core/module-edges.ts`, built on one compiler call

`SourceFile.getImportStringLiterals()` returns one string literal per module specifier across every edge-carrying form, and none of the non-edges. **Measured** — 13 statements, 9 literals:

| Source form                                  | literal? | parent kind         |
| -------------------------------------------- | -------- | ------------------- |
| `import { x } from 's'`                      | 1        | `ImportDeclaration` |
| `import type { X } from 's'`                 | 1        | `ImportDeclaration` |
| `import { type X as X2 } from 's'`           | 1        | `ImportDeclaration` |
| `export { x as renamed } from 's'`           | 1        | `ExportDeclaration` |
| `export * from 's'`                          | 1        | `ExportDeclaration` |
| `export type { X as XT } from 's'`           | 1        | `ExportDeclaration` |
| `export { type X as XI } from 's'`           | 1        | `ExportDeclaration` |
| `import('s')`                                | 1        | `CallExpression`    |
| `type A = import('s').X`                     | 1        | `LiteralType`       |
| `declare module 's' {}`                      | **0**    | —                   |
| `require('s')`                               | **0**    | —                   |
| `import('./' + n + '.js')` (computed)        | **0**    | —                   |
| `export { x as localRename }` (no specifier) | **0**    | —                   |

One call, compiler-classified, correct exclusions — no `getDescendantsOfKind(CallExpression)` scan and no three hand-rolled collectors.

**Cost, measured over 484 files:** `getImportDeclarations` 0.6ms → the new walk **8.1ms**, with no warm-up benefit (the descendant walk repeats). 13×. End-to-end on `strictBoundaries` over this repo it was noise (643ms → 660ms), but 37 rules × per-subject calls is the shape that bites at scale. **Cache per `(Project, SourceFile)` in a `WeakMap`**, exactly as `getReverseImportGraph` already does — and once the reverse graph consumes the same walk, the two caches become one.

```ts
// src/core/module-edges.ts — the return type is ts-morph-free by construction.
export type ModuleEdgeKind = 'import' | 'reexport' | 'dynamic' | 'type-expression'

/** A named binding carried across an edge under a different name. */
export interface AliasedBinding {
  readonly name: string
  readonly alias: string
}

export interface ModuleEdge {
  readonly kind: ModuleEdgeKind
  /** The specifier as written. */
  readonly specifier: string
  /** Resolved absolute path, when the compiler resolved it. */
  readonly resolvedPath: string | undefined
  /** Every string a glob may match, primary first — bug 0014's contract, unchanged. */
  readonly candidates: ImportCandidates
  /**
   * 1-based line of the statement carrying the edge. MUST equal the old
   * `decl.getStartLineNumber()` for `kind === 'import'` — `hashViolation` hashes
   * the message and the message carries the line, so every baselined dependency
   * violation depends on this.
   */
  readonly line: number
  /** Erased at compile time, so no runtime dependency. Per-kind; see §2. */
  readonly typeOnly: boolean
  /** Renamed named bindings. Empty for `dynamic` and `type-expression`. */
  readonly aliases: readonly AliasedBinding[]
}

/** Every module edge leaving this file. Batch-first (ADR-007 rule 2), cached. */
export function moduleEdges(sf: SourceFile): readonly ModuleEdge[]
```

This is **not** a lowest-common-denominator: `candidates` serves the three glob conditions, `typeOnly` serves `onlyHaveTypeImportsFrom` and `ignoreTypeImports`, `aliases` serves `notHaveAliasedImports`, `line` serves message stability, and `kind` lets any site opt out of kinds it should not see. Every field has exactly one consumer family and nothing is left over.

**Resolution, per kind** (all four measured working, including `paths` aliases): `getModuleSpecifierSourceFile()` for `import`/`reexport`; the type-argument walk (`call.getType().getTypeArguments()[0]` → symbol → declaring `SourceFile`) for `dynamic`; the `ImportTypeNode`'s type symbol for `type-expression`. `candidatesFor(specifier, resolvedPath)` covers the unresolved case, which is what makes bare-package bans work on the new kinds.

**Not `src/core/engine/`.** That directory does not exist and 60 files under `src/` import ts-morph; a one-module "engine" that 2 of 60 respect is the cosmetic boundary ADR-007's own Alternative 4 rejects. The honest move is `src/core/` with a ts-morph-free **return type** — `moduleEdges(filePath): readonly ModuleEdge[]` is already ADR-007 rule 2's shape, and the file header should say it is a deliberate down-payment on that boundary rather than an accident.

### §2 The `typeOnly` contract, and the trap

Today, in all five sites, **`import type` is a full edge**; the only exemption is the opt-in `{ ignoreTypeImports: true }`. That default is preserved.

Type-only-ness exists for the new kinds and one form is a trap. **Measured:**

| Form                                         | `decl.isTypeOnly()` | all named specifiers type-only | correct answer     |
| -------------------------------------------- | ------------------- | ------------------------------ | ------------------ |
| `import type { X } from 's'`                 | true                | —                              | type-only          |
| `import { type X as X2 } from 's'`           | **false**           | true                           | type-only          |
| `export type { X as XT } from 's'`           | **true**            | **false**                      | type-only          |
| `export { type X as XI } from 's'`           | **false**           | **true**                       | type-only          |
| `export * from 's'`, `export { x } from 's'` | false               | false                          | runtime            |
| `import('s')` (call)                         | —                   | —                              | **always runtime** |
| `type A = import('s').X`                     | —                   | —                              | **always erased**  |

**Neither predicate alone is correct for either declaration kind.** The rule is `decl.isTypeOnly() || (specifiers.length > 0 && specifiers.every(isTypeOnly))`, mirroring `isTypeOnlyImport` onto `ExportDeclaration`. Rows 3 and 4 are the ones a from-memory implementation gets wrong — the review's own prototype misclassified row 4 as a runtime edge, which would make `layered/type-imports-only` flag a type-only re-export.

### §3 Per-site disposition

| Site                              | Disposition                                                                                | Direction                      |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| `onlyImportFrom` (:57)            | all 4 kinds; `typeOnly` exempt only under `ignoreTypeImports`                              | green→red, monotone            |
| `notImportFrom` (:105)            | all 4 kinds; same exemption                                                                | green→red, monotone            |
| `dependOn` (:155)                 | all 4 kinds; same exemption. **Delete its "static only" JSDoc**                            | **red→green**, monotone        |
| `notHaveAliasedImports` (:196)    | consume the walk **filtered to `kind === 'import'`** — byte-identical to today             | **none**                       |
| `onlyHaveTypeImportsFrom` (:235)  | all 4 kinds; `typeOnly` per §2                                                             | green→red, monotone            |
| `reverse-dependency.ts` (:77-100) | replace all three collectors; delete `resolveDynamicImport`; dedup on `(importer, target)` | mixed; gains `type-expression` |

**0022's hedge about direction is wrong and this is derivable, not empirical.** Four sites push one violation per matching/non-matching edge, so adding edges is monotonically green→red. Only `dependOn` uses `.some()`, so it is monotonically red→green. Measured on this repo's own source: `no-cross-boundary` 289 → **292**, `shared-isolation` 80 → **94**, `innermost-isolation` 20 → **21**, and **0** findings disappeared. The new ones are barrel re-export lines and `tests/fixtures/reverse-deps/src/public/index.ts:2,3` — a public barrel re-exporting `internal/`, which is 0022's motivating case sitting in our own corpus.

**`notHaveAliasedImports` is excluded on purpose, and this is where 0022's five-site list is wrong.** Measured: `export { secret as s2 } from '../banned/secret.js'` → 1 violation under the shared walk, 0 today. Three reasons to refuse it: the rule's stated rationale is about **consumption** ("aliases hide API design problems — use the real export name") while a re-export rename is a deliberate **publication** decision, the canonical thing a barrel does; the line it draws is arbitrary (`export { x as y } from './impl.js'` flagged, `export { x as y }` not, decided by whether a specifier happens to be present); and its sanctioned remedy — "import the symbol by its original name" — is nonsense for a re-export line, which is ADR-008 rule 2. If renaming-on-re-export deserves a rule, it is a different rule with a different rationale.

### §4 Bug 0015: rule-level, default-fail, three tiers, no new mechanism

The unit is the **rule**. After conditions run, over the materialized subject set:

1. **Total edges tested across all subjects == 0 → FAIL.** Default, `bypassFilters: true`, unsuppressible — the same shape and voice as `collectWithAssertionGuard`. The remedy is not optional and it is real: the author named a population and an edge constraint, and the population has no edges, so either the selector or the condition is wrong for these subjects. The finding states **both counts** (`N subjects, 0 edges`) and must not inherit the author's `suggestion` (bug 0021). Count edges **after** the `ignoreTypeImports` filter, or a subject set whose only edges are type-only reports "edges tested" while testing none.
2. **An individual subject with 0 edges → nothing.** It is compliance. `reverse-dependency.ts:146`'s vacuous pass stays, and its comment gains the reason plus a pointer to tier 1 — 0015 is right that recording a mechanism without its consequence reads as a shrug.
3. **Edges exist, but allowlist glob G matched none → `diagnose()` / `doctor`, not a build failure.** An over-provisioned allowlist is legitimate, so the remedy needs the reader's judgement, which is ADR-008 rule 1's discriminator for the warn/diagnostic tier. New `DiagnosticFinding.kind: 'unexercised-glob'`. **This is where 0015's actual typo case (`onlyImportFrom('**/nowhere/**')`) gets caught** — and it is a different fault from plan 0069's dead glob: the glob is satisfiable against the project and still exercised by nothing.

`dependOn` is excluded from tier 1 — it already fails on an edgeless subject, correctly. `.expectNonEmpty()` is untouched: it asserts the selector matched subjects, a different claim, and keeping them separate is what stops a third mechanism appearing.

This answers 0015's "wait until 0069's reporting surface exists": it exists (`diagnose`, `DiagnosticFinding`, `assertDiscovered`, `collectWithAssertionGuard`), it already has both a default-fail tier and a diagnostic tier, and this needs no new mechanism — only the right tier for each of two distinguishable faults.

### §5 Sequencing — forced, and measured

**One change; within it the widening lands before or with the edge count.** Files in this repo with zero static imports but ≥1 real edge: **6**.

```
src/index.ts               static=0  edges=114  (reexport)
src/core/index.ts          static=0  edges=13
src/presets/index.ts       static=0  edges=12
src/predicates/index.ts    static=0  edges=3
tests/fixtures/dynamic-imports/src/template-consumer.ts   static=0  edges=2  (dynamic)
tests/fixtures/reverse-deps/src/public/index.ts           static=0  edges=2  (reexport)
```

Ship §4 on the narrow walk and the library's own public API surface reports _"this rule tested 0 edges"_ while carrying **114**. 0022 alone is safe (pure widening, no policy). **0015 alone is not.** Derive the count from the widened walk in the same commit so it is never computed from the narrow set.

## Guards

### The parity test 0022 asks for becomes a tautology — do not ship it as the guard

0022 asks for "the forward walk and the reverse graph derive the same edge set from one fixture". The moment both call `moduleEdges`, `expect(forward).toEqual(reverse)` compares a value to itself: green with the walk arbitrarily broken, and `0 === 0` green when it collects nothing. Both reviewers caught this independently. Keep it as a cheap re-divergence pin; **label it as not the rule-5 guard.**

### What replaces it

- **An explicit expected edge list in the test file**, with both halves asserted against _it_ rather than against each other. ADR-008 rule 4's note applies verbatim: replace snapshots with explicit lists, not with counts. **The deliberate absences are part of the list** — `export { type X } from` and the computed dynamic must be _provably_ absent, since an omitted row is indistinguishable from a missed edge.
- **Genuine independence from the module system, for the two kinds where the static answer is a guess.** Re-exports: build a fixture package, `await import()` its barrel, and assert the runtime namespace's keys equal the names the static walk says cross the edge. Dynamic: `await import(specifier)` from the fixture's own directory and compare the loaded marker export against `edge.resolvedPath`. Node's resolver and ts-morph cannot fail the same way — and this is the guard that would have caught `resolveDynamicImport` losing `@/`-aliased specifiers, because Node and TS resolve aliases by different rules and the disagreement _is_ the signal. ADR-008 rule 5 blesses this shape explicitly.
- **Per edge kind × per condition family, by element identity** — `file:line` sets, never counts, so "found the re-export" cannot be confused with "found the static import three times".
- **The §2 type-only matrix in both directions**, ~14 rows, including the two trap rows.
- **Corpus-wide message/line equivalence** for every pre-existing static-import finding, old build vs new. The pattern already exists — `bare-package-imports.test.ts:262` does exactly this for bug 0014's change, with `expect(checked).toBeGreaterThan(500)` guarding the guard.
- **A vacuity assertion on every one of the above** (`edges.length > 0` per fixture).

### The gap this plan must close in `arch-rules.test.ts`

18 of the 80 affected test cases live there and **0** catch blindness; every one asserts zero violations, which zero edges satisfies. That file already carries two exemplary rule-5 pairs for _selector_ non-vacuity (ts-morph vs a filesystem walk at :72; "no glob written in this file can ever match" at :97). It has none for _condition_ non-vacuity. One positive control, by identity:

```ts
it("NON-VACUITY: the dependency conditions see this repo's real edges", () => {
  // Every ban in this file asserts ZERO violations, so nothing here proves an
  // edge was ever collected — measured: all 18 pass with the walk returning [].
  const found = modules(p)
    .that()
    .resideInFolder('**/src/conditions/**')
    .should()
    .notImportFromCondition('**/src/core/**')
    .violations()
  expect(found.map((v) => path.basename(v.file)).sort()).toEqual([
    /* explicit list */
  ])
})
```

An explicit list, not `.length > 0`: a count survives the walk losing re-exports and gaining a duplicate.

### Fixtures

- **`tests/fixtures/module-edges/`** (new) — the per-kind × per-family matrix and the parity pin. Needs forms no boundary fixture would carry: `import type`, `export type`, `export { type X } from`, `export *`, bare dynamic, computed dynamic, `type A = import('x').Y`.
- **`tests/fixtures/edgeless/`** (new, 3 files) — `edgeless.ts` (no edges), `has-edges.ts` (edges, all allowlisted), `allowed/target.ts`. Tier 1 needs a **satisfiable** allowlist plus a compliant sibling; no existing root offers that without also offering violations.
- **`boundaries-folder-level/`** — add exactly one file, `via-reexport.ts`, as proof the fix reaches the shipped preset. Budget it honestly: it changes the expected edge set in ~4 places in that test file, and those are precisely the reds an agent "fixes" by bumping a number. Update them **by identity**.
- **Reuse what exists:** `tests/fixtures/reverse-deps/src/internal/reexport-only.ts` and `tests/fixtures/dynamic-imports/src/` already contain both missing kinds and are referenced only by reverse/dynamic tests. Pointing the forward conditions at them is cheaper than 0022 implies.
- **Do not touch `tests/fixtures/presets/boundaries/`.** `boundaries.test.ts:32` asserts `errors(...).toEqual([])` for the happy path, so any new cross-boundary edge there reds an unrelated test. (The constraint recorded in 0017's guard — `duplicateBodies` running pairwise — is narrower than written: it needs `noCopyPaste: true` and function bodies ≥5 lines, so re-export one-liners cannot trip it. Correct that note in passing.)

## Test inventory

1. `module-edges.test.ts` — the 13-form × 9-literal table of §1, asserted as an edge list with the four exclusions provably absent.
2. `module-edges.test.ts` — the §2 type-only matrix, ~14 rows, both directions, both trap rows.
3. `module-edges.test.ts` — resolution per kind incl. `paths` aliases and bare specifiers; `candidates` primary-first.
4. `module-edges-independence.test.ts` — runtime `await import()` vs the static walk, for re-export and dynamic kinds.
5. `dependency-edge-kinds.test.ts` — per kind × per family (5 families), by `file:line` identity, with the absences.
6. `dependency-edge-kinds.test.ts` — `notHaveAliasedImports` byte-identical to today (the `kind === 'import'` filter).
7. `dependency-edge-kinds.test.ts` — `dependOn`'s red→green direction, explicitly.
8. `edge-parity.test.ts` — forward vs reverse, **labelled a re-divergence pin, not the guard**, scoped to edges resolving to a project source file (the bare-target policies are deliberately opposed).
9. `rule-tested-no-edges.test.ts` — tier 1: fires when all subjects are edgeless; silent with one edge-bearing sibling; asserted by identity so a fire-on-everything stub reds.
10. `rule-tested-no-edges.test.ts` — tier 1 is `bypassFilters` + `error`, and does **not** carry `expectNonEmpty`'s empty-selector remedy (bug 0021's shape).
11. `rule-tested-no-edges.test.ts` — the remedy remediates: apply the stated fix, assert the finding clears.
12. `rule-tested-no-edges.test.ts` — cause discrimination: an empty selector and an edgeless rule produce distinguishable findings.
13. `unexercised-glob.test.ts` — tier 3 reaches `diagnose()`/`doctor` and does **not** fail a build.
14. `arch-rules.test.ts` — the positive control above.
15. `layered.test.ts` — `type-imports-only` gains an **edge-identity** assertion. It is currently pinned by `.some(v => v.ruleId === …)` at four sites and nothing anywhere pins _which_ import is exempt.
16. Corpus-wide `{file, line, message}` equivalence for pre-existing static-import findings.
17. `baseline-compat` — an old-text baseline replays against the new build with **0** new findings for unchanged static-import violations.

## Migration

The new findings are **ordinary** violations (`bypassFilters: false`), so a consumer on a baseline gets unbaselined errors on files their PR never touched, and a consumer on `--changed` sees **nothing** — the barrel did not change. Both are wrong to leave implicit.

**The recipe, and it must be run before it is published.** Note what does _not_ work: `npx ts-archunit@0.26.0 check` does **not** reproduce the old behaviour, because `loadRuleFiles` imports the rule file from the user's project and its `import … from '@nielspeter/ts-archunit'` resolves against the project's `node_modules` — old CLI, new conditions.

```bash
# BEFORE upgrading — the only moment the old behaviour exists
npx ts-archunit baseline arch.rules.ts --output pre-0.27.json
# upgrade, then: everything reported here is new in 0.27.0
npx ts-archunit check arch.rules.ts --baseline pre-0.27.json
```

Two release constraints follow, not suggestions:

- **No condition `description` string and no existing violation message may change.** `hashViolation` is `rule::element::message` and `rule` is built from condition descriptions; appending "(including re-exports)" to `onlyImportFrom`'s description reports 100% of findings as new and silently breaks every committed baseline. Inventory item 17 is the pin.
- The `--format json` variant needs `|| true`, because `check` exits non-zero and would abort a `set -e` script.

**"Regenerate your baseline" is the wrong headline advice**: it auto-accepts, unreviewed, the highest-value finding in the release — 0022 itself argues the re-export is the _worse_ case because it re-publishes another boundary's internals. Ratchet the **delta**: baseline on 0.26.0, upgrade, triage what the delta reports, and only then regenerate with the diff reviewed. Size it honestly rather than promising it is small — 122 `export … from` and 7 `import(` in `src/` here, nearly all within-package barrels, so the cross-boundary delta is near zero for most codebases and large for one shape: a codebase whose primary cross-module access pattern is barrel re-export. Step 1 is how a reader finds out which they are.

**Tell adopters not to reach for `--changed`.** It is the first thing anyone under CI pressure tries, and the new findings are by definition in untouched files, so it hides 100% of them and yields a permanently green build that enforces nothing on legacy re-exports.

**And the release must name three reversals, not one:**

- `docs/modules.md:161` states the current behaviour as a **contract** — "All three check static `import` declarations only". So is `dependOn`'s JSDoc. This is a documented-contract reversal, the same category as 0.23.0's two "pinned by a test" rows, and both texts change in the same commit.
- **Barrels become dependency-bearing files.** `src/index.ts` goes from 0 dependencies to 114. That single sentence is what lets a reader predict their own diff.
- The reverse half changes too: it gains `type-expression`, so `beImported()` reports **fewer** orphans and `onlyBeImportedVia` **more** importers — a second red→green surface.

## Out of scope

- **The slice graph.** `src/helpers/slice-graph.ts:48,105` powers `beFreeOfCycles()`, `notDependOn()` and `respectLayerOrder()` — i.e. `layered/layer-order`, `layered/no-cycles`, `boundaries/no-cycles` — and is blind to re-exports too. Barrel re-export is _the_ classic cycle shape, so this is genuinely valuable, but a cycle finding is the hardest kind to remedy, it roughly doubles the blast radius, and it is a different upgrade story. **File it as a follow-up and disclose the limitation in the changelog** — what is not acceptable is shipping without saying which side of the line it is on.
- **The `importFrom` predicate** (`src/predicates/module.ts:18`) — same upgrade story and same remedy, so it _should_ ride along if it fits the day; if not, it is the first follow-up, because `.that().importFrom('**/legacy/**')` and `.should().notImportFrom('**/legacy/**')` are taught side by side in `docs/what-to-check.md` and would otherwise disagree.
- **`require()`** stays blind everywhere. Already documented as such in the reverse half; state it rather than paper over it.
- **Widening `notHaveAliasedImports`** — §3.
- **An `includeReExports` option.** It would reinstate two user-selectable definitions of "an import" — the exact defect this plan removes, with a config surface — and plan 0069 already settled the principle: "an opt-out is the first thing an agent adds on the first red." "An import is an import" is the honest default; `.excluding()` and the baseline are the visible escape hatches. A _dynamic_-import knob has real semantic content (deliberate deferral) and can arrive later on a demand signal, named for what it means — not preemptively in the breaking release, where it reads as the sanctioned way to get green.

## Notes for whoever implements

- **`onlyBeImportedVia` double-reports today**, and unifying the walk forces the decision. `addToGraph` (`reverse-dependency.ts:26`) takes a `deduplicate` flag: `false` for static imports, `true` for the others. Measured: one target, one importer, two static imports of it → **two byte-identical violations at the same `file:line`**, hence two identical baseline hashes. Dedup on `(importerPath, targetPath)` — the reverse graph's value is a set of files and per-edge multiplicity is meaningless at that granularity.
- **The reverse graph hardcodes `line: 1`** while the forward walk reports real lines, so parity can only be keyed on `(importer, imported)` pairs.
- `isTypeOnlyImport` and `importCandidates` become unused in `dependency.ts` after the change. ESLint flagging them is the signal that the per-declaration logic genuinely moved rather than being duplicated.
- **Unresolvable dynamic specifiers need opposite answers per family.** `import(\`./locales/${lang}.js\`)`cannot resolve: under`notImportFrom`nothing matches → no violation (silent under-enforcement, disclose it); under`onlyImportFrom` nothing matches the allowlist → **violation**, which reds every i18n loader, lazy route table and plugin loader at error severity. Recommendation: an edge whose specifier is not a static string is **not an edge** for the allowlist family, and tier 3 reports the count so the gap is visible rather than silent.
- **Re-run the blindness sabotage after the fix and put the number in the changelog.** If the caught count is still ~38/2478, the change added _visibility_ without adding _coverage_, and the 60-odd survivors are now survivors over a larger surface.
- **Enumerate the sabotage matrix from the diff**, not from this plan. A list written from memory honestly reports "nothing passes". Read the **exit code** of `npx vitest run`, never the reporter text — ANSI codes have already defeated a grep-based verdict in this project once. Expect ~8 reverts to be caught by nothing on the first round; every one will be a case neither bug report enumerated.
- **`plans/0069-appendix-vacuous-tests.md` has a hole this plan should fill**: it enumerated tests failing under an empty _selector_, and an edgeless _subject_ is a non-empty selector — so `tests/conditions/dependency.test.ts:43` ("passes for a module with no imports (vacuously true)") is not in it. Under §4 that test stays green and gains a sibling for tier 1; the appendix needs a sibling number derived the same mechanical way.
