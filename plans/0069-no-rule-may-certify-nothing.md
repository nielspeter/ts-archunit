# Plan 0069 — No rule may certify nothing

**Status:** DRAFT 3 — rewritten after `/review-proposal` round 2. Not yet re-reviewed.
**Priority:** Highest open item. The defect the tool exists to prevent, committed by the tool.
**Supersedes:** part C of [plan 0067](./0067-empty-selector-safety.md); absorbs [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md); closes [bug 0011](../bugs/0011-dogfood-rules-select-nothing.md).
**Prerequisite:** [bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md) ships first, alone.

## What changed in draft 3

Round 2 verdicts: architect _"not ready to implement"_; product _"approve R1 and R-any now, R2 needs restructuring, R3 not approvable."_ Five substantive corrections:

| Round-2 finding                                                                                                    | Draft 3                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `globs()` on the builder cannot see `satisfy(not(resideInFolder(x)))` — the marker problem, moved                  | The contract is **three-part**: a field on `Predicate` **and** `Condition`, unioned by combinators |
| After R1, the `unanchored` fault fires on `notImportFrom('fastify')` — a rule **our own preset writes**            | Anchoring consults `kind`; specifiers and import-targets are exempt, with a named test             |
| "Only R3 is breaking" was false — R2 carried 019, the severity floor, and an abstract member on two public exports | R2 is **zero behaviour change**. Every flip moved into R3                                          |
| The `doctor` gate could not falsify anything — same two codebases already enumerated as broken                     | Gate **pre-registered**: outside population, decision rule on _remedy category_, stated stop       |
| "every builder contributes `globs()`" passes if every builder returns `[]`                                         | Replaced with a **set-identity** test against an independent derivation                            |

And four numbers I had hand-typed were wrong (`~20` sites → 27; "37 unsilenceable findings" → today it is **one**; "15 JSDoc examples" → 20+; "`mapping()` discards its globs" → it does not). Every count below is derived at the stated date, or derived by `doctor`.

---

## Problem

A rule that cannot match anything passes. Measured:

| Where                 | What                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| This repo             | 13 dogfood rules select nothing outside a checkout named `ts-archunit`; 1 selects nothing everywhere and hides a live violation               |
| This repo's own suite | 8 tests assert on rules that select nothing — one **encodes the false green as expected behaviour** (`tests/smells/smell-builder.test.ts:78`) |
| An adopting codebase  | 7 rule sites, **2 of them security rules** — JWT verification and internal-route auth, both guarding nothing                                  |
| Our shipped presets   | `layeredArchitecture`'s restricted-packages rule is dead twice over — `not(resideInFolder(...))` plus a bare package name                     |

`.expectNonEmpty()` exists for this and is opt-in. The adopting team calls it **eight times**, in the same files as their seven vacuous rules. Opt-in does not work.

---

## Mechanism

> **Can this glob match anything in this project?** — a question about the _project_, answerable without running the rule.

### The contract is three-part, and it is a marker

Round 2 was right: `globs()` on the builder cannot see a glob composed by `satisfy(not(...))`, and `dependOn` has no builder method at all — its only spelling is `.should().satisfy(dependOn(glob))`. So:

```ts
interface Predicate<T> { description: string; test(e: T): boolean; globs?: readonly GlobSite[] }
interface Condition<T> { description: string; evaluate(...): ArchViolation[]; globs?: readonly GlobSite[] }
```

- `not()` / `and()` / `or()` **union** the `globs` of their inputs (`src/core/combinators.ts:23,60,88`).
- `abstract globs(): GlobSite[]` on the single root returns builder-recorded ∪ predicate ∪ condition.
- `definePredicate` / `defineCondition` gain a symmetric options parameter so third-party path predicates can participate.

This _is_ `pathScope` with the propagation round 1 found missing. Draft 2 dismissed the marker and then depended on it; stating it plainly is the correction.

The hole that remains: a user can hand-write `{ description, test }` with no `globs`. `doctor` reports how many predicates declared none, so the coverage claim is **bounded rather than implicitly total** (ADR-008: state the gap).

### `GlobSite` — four axes, because the decision needs all four

```ts
interface GlobSite {
  readonly glob: string
  readonly kind: 'file' | 'folder' | 'import-target' | 'specifier' | 'literal'
  readonly position: 'selector' | 'discovery' | 'condition' | 'exclusion'
  readonly polarity: 'positive' | 'negative'
  readonly base: 'absolute' | 'tsconfig-relative' | 'normalized'
  readonly origin: string
}
```

`kind` decides **what universe** the glob is matched against, and it is load-bearing. Measured 2026-07-25: `getSourceFiles()` returns 430 files here and **0 of them are under `node_modules/`**. So an import-target glob like `**/node_modules/typescript/**` — which our own arch rules use, correctly — is unsatisfiable against the path universe **by construction**. Checking it would fail every correct dependency rule in existence. Likewise `withStringArg(0, '/api/users/**')` (`src/predicates/call.ts:102`) matches an argument _value_ and must never see a path set.

`position` and `polarity` cannot be inferred: `ModuleRuleBuilder.resideInFolder` (`src/builders/module-rule-builder.ts:93`) dispatches on `this._phase` — same method, same glob, predicate before `.should()` and condition after. Both are knowable at the site and must be declared.

### When is unsatisfiability a fault?

Only for `kind ∈ {file, folder}`, and then:

| position    | polarity | Unsatisfiable ⇒                                                                                            |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `selector`  | positive | **fault** — the rule can never have subjects                                                               |
| `selector`  | negative | **no fault** — `.that().notImportFrom('**/legacy/**')` correctly matches everything once `legacy/` is gone |
| `discovery` | —        | **fault** — shipped already (0067-D)                                                                       |
| `condition` | positive | **no fault** — but see the `only*` exposure below                                                          |
| `condition` | negative | **no fault** — indistinguishable from an armed tripwire                                                    |
| `exclusion` | —        | **never** — proposal 006 settled that an exclusion matching zero is remedy-optional                        |

Measured, for the negative-condition row:

```
notImportFrom('**/src/gone/**')   (negative)  ->  0 violations   silent green
onlyImportFrom('**/src/gone/**')  (positive)  ->  1 violation    loud red
```

**Correction to draft 2:** the `only*` family is **not** reliably loud. `onlyImportFrom` iterates import declarations, so a subject with zero imports passes vacuously however broken the allowlist is; `onlyBeImportedVia` documents this at `src/conditions/reverse-dependency.ts:146` (_"Modules with zero importers pass vacuously"_). In a layered architecture the innermost layer — where an allowlist matters most — characteristically has no outbound imports. Recorded as a **known exposure**, not covered.

### Anchoring is the only check that survives polarity — and it exempts specifiers

A `./` segment, or a missing `**/` on an absolute-base glob, can never match. That transformation is verifiable, so it applies at every position. But after R1 lands bug 0014, `notImportFrom('fastify')` is a **working rule**, and `isAnchored('fastify')` is `false` (`src/builders/slice-rule-builder.ts:33`). Emitting _"prefix these with `**/`"_ would break it — against a call **our own `layeredArchitecture` preset generates** (`src/presets/layered.ts:101`).

So anchoring consults `kind` and exempts `specifier`, `import-target` and `literal`. Named test, written before the guard: `notImportFrom('fastify')` and `layeredArchitecture({ restrictedPackages })` produce **zero** findings.

### `PathUniverse`

A free function with a `WeakMap<ArchProject, PathUniverse>` cache, returning plain strings — not a method on `ArchProject`, because that interface deliberately supports bare-object test doubles (`src/core/project.ts:18`), and a `WeakMap` is invalidated for free by `resetProjectCache()`.

Directories must be **all ancestors**, not immediate parents. Measured here: 430 files, **81** immediate parents, **122** ancestors. A folder glob targeting a directory that contains only subdirectories would false-fire on the smaller set. The universe therefore over-approximates what `resideInFolder` can actually match — the guard is fail-open on that axis, which is the correct direction for a breaking change, and is stated rather than left implicit.

Short-circuit: if the project loaded zero source files, blame the project, not the glob — `src/builders/slice-rule-builder.ts:284` already does this and the logic is reused.

### `glob-diagnosis`, promoted and extended by two faults

`diagnoseGlob` + `FAULT_ADVICE` (`src/builders/slice-rule-builder.ts:40-76`) already has the right discipline, including the comment explaining why `no-match` lists causes **without asserting one**. Promote to `src/core/glob-diagnosis.ts`; add:

| Fault                 | Condition                                            | May name a cause?                                                                                       |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **`file-not-folder`** | `kind: 'folder'`, matches ≥1 file, **0 directories** | yes — verifiable                                                                                        |
| **`outside-project`** | exists on disk, absent from the project's file set   | yes — verifiable, and it is the _filesystem vs compiler_ independent derivation ADR-008 rule 5 asks for |
| `no-match`            | anything else                                        | **no** — lists causes                                                                                   |

`outside-project` converts a wrong-remedy `no-match` ("fix the glob") into the right one ("add it to your tsconfig `include`") for generated dirs, excluded tests and codegen output.

`base: 'normalized'` exists for `slices().matching()`, whose `parseMatchingGlob` (`src/models/slice.ts:73`) already strips and re-adds `**/` — so a project-relative spelling works today and must not be reported as unanchored. Today's code is careful about this; the generic version must stay careful.

---

## Decisions

**Semantic emptiness does not flip**, and therefore **no `.allowEmpty()` is added** — the collision with `CorrespondenceBuilder.allowEmpty(sideName)` dissolves rather than being renamed around. Proposal 014's _"Why not 'empty always fails'"_ stands; every measured bug is a path glob.

**Preset input-guarding uses `every`, not `some`.** A glob set is faulted only when **no** glob in it resolves — the quantifier 0067-D already uses. Per-glob faulting would re-land the guard withdrawn in 0.18.1 (_"a layer not created yet"_, no opt-out) three days after withdrawing it. The guarded option list is derived from the 0.18.1 anchoring checklist — `folders`, `layers`, `shared`, `src`, `include`, `repositories`, `typeImportsAllowed`, and the **keys** of `restrictedPackages` (values are specifiers) — with a test asserting the guarded set equals the exempt set, derived not hand-listed.

**Meta-findings become severity-proof, and this is a flip, not groundwork.** Measured: `.asSeverity('warn')` downgrades a `bypassFilters` finding, because `rule-builder.ts:200` and `terminal-builder.ts:102` overwrite unconditionally (`execute-rule.ts:137` is already `?? severity` and safe). Three of the four shipped meta-findings set no severity at all. `.warn()` currently never throws (`terminal-builder.ts:130`), so flooring severity alone changes nothing there — `executeWarn` must **partition**, escalating `bypassFilters` findings out of the warn path. That is a public contract change to `.warn()` and it ships in R3 with its own Upgrading paragraph.

**`emptyIsPass` does not exist on `main`** — it is on `spike/0067c` only. It lands in R3 with its `.some()` → `.every()` fix, and never covers a path fault, or bug 0011 reopens for every absence rule.

---

## Releases

| Release   | Contents                                                                                                                                                                                       | Breaking?                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **R-any** | Our own 14 rules, rescoped by construction. No product change. Land first.                                                                                                                     | no                               |
| **R1**    | [Bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md) alone — match import globs against the resolved path **and** non-relative specifiers                                       | green→red for bans that now work |
| **R2**    | Single root; `GlobSite` fields + combinator propagation; `PathUniverse`; `glob-diagnosis`; `doctor`; **the whole docs/JSDoc/template sweep**. Reports, never fails. **Zero behaviour change.** | no                               |
| **R3**    | Every flip together: the glob guard, proposal 019, the severity floor + `.warn()` partition, `emptyIsPass`. One Upgrading section. Ships with the 8 vacuous-test fixes in the same commit.     | **yes**                          |

The docs sweep moves to **R2**: 014 called it a ship-blocker, and shipping it a release _earlier_ satisfies that strictly better while keeping R3's diff reviewable. It becomes an enforced invariant rather than a one-time count, by extending the existing JSDoc/markdown scanner (`tests/docs/scan-markdown.ts`) — _no shipped example contains an unsatisfiable path glob_.

`doctor` exits **non-zero** on findings from day one (it is an explicitly-invoked diagnostic, not a build gate) and supports `--format json`. It is a measurement instrument with a scheduled end at R3, not the permanent answer.

### Spike: the gate run early, on a codebase we did not write

Run 2026-07-25 against `trpc/trpc` (shallow clone, `packages/server`, `include: ["src"]`, 107 files) — chosen because the gate's whole point is a population we did not author.

**Finding 1 — `outside-project` is necessary, not speculative.** **18 of 41** directories that exist on disk are absent from the project's file set: `bin/`, `skills/`, and 16 more. A plausible `resideInFolder('**/skills/**')` is therefore _unsatisfiable against the path universe_ while the path plainly exists on disk.

This is the pre-registered decision rule firing on its first outside run: a finding whose correct remedy is **"add it to your tsconfig `include`"**, not "fix the glob". Under the rule as written that would stop R3 — **unless the guard can name the right remedy**, which is exactly what the `outside-project` fault does. The spike therefore _validates_ the fault rather than blocking the release, and R3's gate is met on this population only because the fault exists. Remove it and R3 does not ship.

**Finding 2 — draft 3 overstated the all-ancestors case.** Measured on the same package: 21 immediate parents, 24 ancestors, **3** directories holding only subdirectories (`src/@trpc`, `src/vendor/cookie-es`, the package root). And both plausible folder globs matched **identically** against either set:

```
**/adapters/**                       ancestors: 6   parents: 6   files: 25
**/unstable-core-do-not-import/**    ancestors: 7   parents: 7   files: 53
```

All-ancestors is still the right choice, but the false-fire it prevents is **narrow**: it only bites an _exact-directory_ glob with no trailing `/**` (`resideInFolder('**/vendor/cookie-es')`). The common `**/x/**` spelling is unaffected, because globstar matches zero segments. Corrected here rather than left as an overclaim.

**Finding 3 — the gate is runnable before `doctor` exists.** Everything above came from ts-morph plus picomatch against a cloned repo. The R2 `doctor` makes it repeatable and user-facing; it is not a prerequisite for measuring. The remaining unmeasured population is a monorepo where a _shared_ rule file spans packages — open question 2.

### Spike 2: the shared rule file across a monorepo (open question 2)

Fixture: two packages, `a` with `src/domain/` and `src/api/`, `b` with only `src/api/`. One shared rule scoped `resideInFolder('**/src/domain/**')`.

```
SHAPE 1 — one project() per package
   package a: satisfiable=true   subjects=1
   package b: satisfiable=false  subjects=0    <- GUARD FIRES, false red

SHAPE 2 — workspace() union (documented at docs/core-concepts.md:71)
   satisfiable=true   subjects=1               <- no fault
```

**The exposure is real but confined to one usage shape**, and it is not the shape the docs recommend. `workspace()` unifies the tsconfigs into one project, so the path universe is the union and a layer present in _any_ package satisfies the glob. Open question 2 therefore has an answer that needs no new API:

- **`workspace()` is the supported monorepo path**, and R3's Upgrading note must say so explicitly — this is the first time that choice has a _correctness_ consequence rather than only an import-graph one.
- **Per-package `project()` with a shared rule file is the exposed shape.** It is legitimate (it is how you get per-package strictness — `docs/config-rules.md:66` recommends exactly that for `tsconfig()`), so R3 cannot simply declare it unsupported.

Options, none free, for review to settle: accept the false red and document `workspace()` as the fix; scope the fault to globs unsatisfiable in **every** loaded project (mirrors the `every`-not-`some` preset quantifier, but needs cross-project state a single `check()` does not have); or admit this is the one place an opt-out is unavoidable, which reopens the `.allowEmpty()` decision this draft closed.

**A trap the implementation must avoid, found while measuring.** The first run of this spike reported `satisfiable=true` for package `b`, which has no `src/domain/` at all. Cause: `files.some(matcher)` passes the **array index** as picomatch's second parameter, which switches it into `returnObject` mode — it then returns a truthy result object whose `isMatch` is `false`.

```
['/x/a','/x/b'].some(m)        -> true    (wrong)
['/x/a','/x/b'].some(s => m(s)) -> false   (correct)
```

Production code is clean — every call site already wraps in an arrow — but `PathUniverse` satisfiability is set-matching by nature and is precisely where this would be written. It is a silent true, in the guard against silent trues.

### The R3 gate, pre-registered

- **Population:** both known codebases **plus at least one we did not write** — highest-yield shape is an OSS TypeScript monorepo with codegen.
- **Decision rule:** classify every finding by its **correct remedy**, not by count. If any finding's correct remedy is anything other than _"fix the glob"_ — "the path is real but excluded from tsconfig", "generated by a build step", "this package legitimately lacks that layer" — **R3 does not flip without an opt-out.**
- **Report shape:** identity (glob + origin + resolved category), never a total.

---

## Test inventory

| Test                                                                                             | Proves                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `notImportFrom('fastify')` and `layeredArchitecture({ restrictedPackages })` → **zero** findings | R1 does not break R3 — written **first**                   |
| `satisfy(not(resideInFolder(typo)))` reports                                                     | combinator propagation                                     |
| `satisfy(dependOn(typo))` reports                                                                | the `Condition` half of the contract                       |
| per builder: construct with a known glob, assert **that exact string** in `globs()`              | set identity — a `return []` stub must fail                |
| the `globs()` origin set equals the runtime-recorded compile set                                 | declaration vs behaviour, two derivations                  |
| `withStringArg(0, '/api/**')` and `**/node_modules/x/**` produce **no** finding                  | `kind` gating; measured 0 project files under node_modules |
| `ignorePaths('**/nonexistent/**')` produces no finding; `inFolder('**/nonexistent/**')` does     | exclusion vs selector on the same builder                  |
| `slices().matching('src/features/*')` is not reported unanchored                                 | `base: 'normalized'`                                       |
| `resideInFolder` over a directory of only subdirectories does not fire                           | all-ancestors universe                                     |
| a layer glob for a not-yet-created layer does not fire                                           | the `every` quantifier; the 0.18.1 withdrawal not repeated |
| `.asSeverity('warn')` cannot downgrade a meta-finding; `.warn()` does not swallow one            | the shipped hole                                           |
| the arch suite is green from a differently-named checkout                                        | bug 0011 fixed by construction                             |

Each verified by sabotage: revert the fix, watch it go red.

---

## Known exposures, stated not hidden

- The `only*` condition family passes vacuously on subjects with no edges; its globs are not guarded.
- A hand-written `{ description, test }` predicate declares no globs; `doctor` reports the count.
- `PathUniverse` over-approximates directories, so the guard is fail-open there.
- `doctor` is built on rule-file loading, so users who write rules inside vitest (`docs/running-in-tests.md`) get no pre-flight. R3's Upgrading note must say so.

## Open questions

1. **`api/no-single-glob-predicates`** (R-any) surfaces a live `havePathMatching` violation at `src/predicates/module.ts:97`. Make it variadic — a public API change — or record it as a legitimate single-glob identity predicate? Decide before R-any.
2. **The monorepo shared-rule-file case** — now measured (spike 2). `workspace()` dissolves it; per-package `project()` with a shared rule file produces a false red. Three options listed there; review to pick one. This is the last thing between the plan and an approvable R3.
3. **1.0 gate.** R3 is breaking and path-normalization is a further deferred breaking change, so 1.0 is at minimum R3 → path-norm → two quiet releases.

## Out of scope

- **Bug 0012** — per-element thresholds, different mechanism.
- **Path normalization** — making `'src/*'` _work_ is the deeper fix and is separable; two breaking changes in one release is the 0.18.1 mistake.
- **The two 0.18.1 deferred slice guards** — unchanged by this plan; they still await executable remedies and an opt-out.
