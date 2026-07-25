# Plan 0069 — No rule may certify nothing

**Status:** DRAFT 4 — after `/review-proposal` round 3. **R-any, R1 and R2 are approved** (architect: R2 conditional on the data model below being settled first; product: R2 with three write-ins, all incorporated). **R3 is not approved** — five items, all specification.
**Priority:** Highest open item. The defect the tool exists to prevent, committed by the tool.
**Supersedes:** part C of [plan 0067](./0067-empty-selector-safety.md); absorbs [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md); closes [bug 0011](../bugs/0011-dogfood-rules-select-nothing.md).
**Prerequisites:** [bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md) ships first, alone. The single-root refactor (`spike/0014-rule-census`, +456/−165) is **unmerged** and lands as its own commit with its own test pass.

## Corrections carried into draft 4

Round 3 found four more hand-typed claims wrong. Recording them because the pattern matters more than any one of them:

| Claimed                                                                                                  | Derived 2026-07-25                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Three of the four shipped meta-findings set no severity"                                                | **Six** `bypassFilters` producers; **five** set none. The one that is safe is safe by _shape_ — `presets/shared.ts:66` returns a bare object with no `.asSeverity()` to reach |
| `docs/config-rules.md:66` recommends per-package `project()`, so option (a) contradicts shipped guidance | It recommends it **for `tsconfig()`**, which takes no globs and can never trip this guard. The contradiction does not exist                                                   |
| `layeredArchitecture`'s restricted-packages rule is "dead twice over"                                    | The `not()` half makes it **over-broad**, not dead — `not(unsatisfiable)` matches everything. Only bug 0014 kills it                                                          |
| Spike 2 shows the monorepo exposure is "confined to one usage shape"                                     | A two-package fixture I wrote demonstrates the _mechanism_; it cannot establish confinement. Softened                                                                         |

Standing rule for this plan: **no count appears in it that was not derived on the stated date.** Three drafts running, hand-typed numbers have been the defect.

---

## Problem

A rule that cannot match anything passes. Measured:

| Where                 | What                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| This repo             | 13 dogfood rules select nothing outside a checkout named `ts-archunit`; 1 selects nothing everywhere and hides a live violation               |
| This repo's own suite | 8 tests assert on rules that select nothing — one **encodes the false green as expected behaviour** (`tests/smells/smell-builder.test.ts:78`) |
| An adopting codebase  | 7 rule sites, **2 of them security rules** — JWT verification and internal-route auth, both guarding nothing                                  |

`.expectNonEmpty()` exists for this and is opt-in. The adopting team calls it **eight times**, in the same files as their seven vacuous rules. Opt-in does not work.

---

## Mechanism

> **Can this glob match anything in this project?** — a question about the _project_, answerable without running the rule.

### The data model carries groups, because the quantifier needs them

Draft 3 said `globs()` unions everything into a flat array **and** that a glob set faults only when no glob in it resolves. Union destroys the grouping `every` refers to, so `notImportFrom('**/legacy/**', '**/old/**')` with only `legacy/` present would red — the 0.18.1 withdrawal, re-landed. The model therefore carries the group:

```ts
interface GlobSite {
  readonly glob: string
  readonly kind: 'file' | 'folder' | 'import-target' | 'specifier' | 'literal'
  readonly polarity: 'positive' | 'negative'
  readonly base: 'absolute' | 'tsconfig-relative' | 'normalized'
  readonly origin: string
}
interface GlobGroup {
  readonly op: 'any' | 'all'
  readonly sites: readonly GlobSite[]
}
```

**One rule covers every case:** a group faults when **every** site in it is unsatisfiable. That handles variadic predicates (`importFrom(...globs)` is `matchers.some` — `src/predicates/module.ts:41`), `or()`, and preset option lists identically, instead of special-casing presets in prose. `and()` produces one group per input.

`position` is **derived, not declared** — it is `this._phase` at record time (`src/builders/module-rule-builder.ts:82,93`), so removing it from the hand-classified set removes a whole axis of hand-typed risk.

### Where the groups come from

```ts
interface Predicate<T> { …; globs?: readonly GlobGroup[] }
interface Condition<T> { …; globs?: readonly GlobGroup[] }
```

`globs(): GlobGroup[]` on the root is **concrete with a `[]` default**, not abstract — adding an abstract member to `RuleBuilder`/`TerminalBuilder` (both public exports, `src/index.ts:21-22`) is a compile break for subclassers, and R2 is the release people install in order to measure. The vacuity risk that motivated `abstract` is already covered by the set-identity test below, which fails a `return []` stub. Non-breaking _and_ guarded.

Combinators (`src/core/combinators.ts`): `and()`/`or()` concatenate their inputs' groups; **`not()` flips `polarity` across its subtree.**

### Polarity, and what `not()` means

`not(unsatisfiable)` selects **everything** — over-selection, not vacuity. It is structurally identical to `.that().notImportFrom('**/legacy/**')` matching everything once `legacy/` is gone, which this plan exempts by name. So:

| position    | polarity | Unsatisfiable ⇒                                                         |
| ----------- | -------- | ----------------------------------------------------------------------- |
| `selector`  | positive | **fault** — the rule can never have subjects                            |
| `selector`  | negative | **no fault** — over-selects; includes `satisfy(not(…))`                 |
| `discovery` | —        | **fault** — shipped already (0067-D)                                    |
| `condition` | positive | **no fault** — but see the `only*` exposure                             |
| `condition` | negative | **no fault** — indistinguishable from an armed tripwire                 |
| `exclusion` | —        | **never** — proposal 006: an exclusion matching zero is remedy-optional |

Consequence draft 3 got wrong: the flagship combinator test cannot be a _satisfiability_ fault. `satisfy(not(resideInFolder(typo)))` must be caught by **anchoring or dot-segment**, which survive polarity because they are syntactic.

Measured:

```
notImportFrom('**/src/gone/**')   (negative)  ->  0 violations   silent green
onlyImportFrom('**/src/gone/**')  (positive)  ->  1 violation    loud red
```

**Known exposure:** the `only*` family is not reliably loud — `onlyImportFrom` iterates import declarations, so a subject with zero imports passes vacuously (`src/conditions/reverse-dependency.ts:146` documents this for `onlyBeImportedVia`). Filed as its own numbered bug rather than living only here, and R3's changelog claim is scoped to **path globs** accordingly.

### `kind` gates which universe applies

Measured 2026-07-25: `getSourceFiles()` returns 430 files here, **0 under `node_modules/`**. So an import-target glob like `**/node_modules/typescript/**` — which our own arch rules use correctly — is unsatisfiable against the path universe **by construction**, and checking it would fail every correct dependency rule in existence. Only `file` and `folder` are checked against paths.

### `PathUniverse`

Free function, `WeakMap<ArchProject, …>`, plain strings — not a method on `ArchProject`, whose bare-object test doubles are real (`tests/builders/slice-rule-builder.test.ts:383`). Lives in `src/core/`, consumes `ArchProject`, imports no ts-morph: ADR-007's batch-first shape by construction. One entry holds **all four** materialized views — absolute file paths, absolute ancestor directories, their tsconfig-relative forms, and the disk set below — computed once, never per glob.

Directories are **all ancestors**. Measured: 430 files, 81 immediate parents, 122 ancestors. Spike 1 narrowed the practical impact — only 3 directories hold solely subdirectories, and the common `**/x/**` spelling matched identically against either set — but all-ancestors remains correct for exact-directory globs with no trailing `/**`. The universe over-approximates, so the guard is **fail-open** on that axis, which is the right direction for a breaking change.

### `outside-project`, specified

Not an independent trigger. It is a **classification of an already-firing unsatisfiability fault** — which is what makes it safe on in-memory projects.

- **Disk root:** reuse `discoverIdentityRoot` (`src/helpers/identity-root.ts`), which already answers "where is the root" nearest-first with a written rationale. Do not invent a second answer.
- **Guard:** require `path.isAbsolute()` on the derived root, else the disk set is empty. Two test doubles use `tsConfigPath: 'in-memory'` (`tests/builders/correspondence-builder.test.ts:24`, `function-rule-builder-object-literal.test.ts:11`), and `path.dirname('in-memory') === '.'` would otherwise walk **the real CWD**, making the fault depend on where the suite was run. Named test.
- **Pruning is mandatory, and is policy:** measured on this repo, a recursive walk is 1846 dirs / 127ms unpruned, 199 dirs / 4ms with `node_modules` and `.git` pruned.
- **The message states the fact and asserts no remedy.** "Exists on disk, absent from the project's file set" is verifiable and useful. Every candidate remedy is not: "add it to your tsconfig `include`" is wrong for `dist/`, `coverage/`, codegen output, for `bin/` and `skills/` (spike 1), and absurd for a Rust crate (gate run 2). `outside-project` therefore contributes the fact and defers to the `no-match` cause list — it is not a remedy branch.

### `glob-diagnosis`, promoted

`diagnoseGlob` + `FAULT_ADVICE` (`src/builders/slice-rule-builder.ts:40-76`) moves to `src/core/glob-diagnosis.ts`. Faults: `dot-segment`, `unanchored` (both verifiable transformations, both exempt for `specifier`/`import-target`/`literal` — after R1, `notImportFrom('fastify')` is a **working rule** and `isAnchored('fastify')` is `false`), `file-not-folder` (verifiable), `outside-project` (fact verifiable, remedy branched), `no-match` (lists causes, asserts none).

`base: 'normalized'` for `slices().matching()`, whose `parseMatchingGlob` (`src/models/slice.ts:73`) already strips and re-adds `**/`.

### Globs that escape the contract

`resolvers(p, glob)` filters eagerly in the entry function and hands the builder only `SourceFile[]` — **the glob string is discarded** (`src/graphql/index.ts:82-88`), so no `globs()` can ever report `resolvers(p, 'src/reslvers/**')`. Same for `loadSchemaFromGlob` (`src/graphql/schema-loader.ts:104`). Both are `tsconfig-relative`.

**Decision:** thread the glob into the builder in R2. It is a constructor widening on two public exports, so it belongs in R2's release note. `crossLayer().layer()` needs no restructuring — `Layer.pattern` already reaches `PairFinalBuilder`; its own JSDoc example (`cross-layer-builder.ts:54`, `'src/routes/**'`) is unsatisfiable and is a good first catch for the R2 docs sweep.

Checked and clear: `TypeMatcher` (regex, no path globs), smell builders (builder-recorded), `TsconfigBuilder` (no globs), `correspondence()` (takes selections).

---

## Decisions

**Semantic emptiness does not flip**, so **no `.allowEmpty()` is added** and the `CorrespondenceBuilder.allowEmpty(sideName)` collision dissolves.

**Monorepo shared rule file → option (a)**, chosen by both reviewers. `workspace()` is the supported path for glob-bearing rules; per-package `project()` with a shared rule file gets a false red. The obstacle draft 3 claimed does not exist: the per-package recommendation in `docs/config-rules.md:66` and `setup-best-practices.md:83` is scoped to `tsconfig()`, which takes no globs. Option (b) needs cross-`check()` state and would make a rule's colour depend on which other rules ran; option (c) reopens `.allowEmpty()`, which ADR-008 rule 3's corollary bars — an opt-out is the first thing an agent adds on the first red, including the real typo.

Condition: the selector-empty message carries the shape as a **cause, not an asserted remedy** — _"if this rule file is shared across packages loaded separately, use `workspace([...])` so the path universe is the union."_ No cross-project state; a single `check()` knows its own root and file set. And the adopting team must confirm which shape they use **before** R3 ships.

**Meta-findings are floored at `error`.** Six producers, five setting no severity (derived above). `rule-builder.ts:200` and `terminal-builder.ts:102` overwrite unconditionally; `execute-rule.ts:137` is already `?? severity` and safe.

**The `.warn()` contract, stated:** `.warn()` continues not to throw for ordinary violations. A `bypassFilters` meta-finding is **partitioned out** of the warn path — reported at `error` severity and counted by the CLI exit code, so `checkAll(..., { format })` exits non-zero. `.warn()` itself still does not throw. This is a public contract change with its own Upgrading paragraph.

**`emptyIsPass`** lands in R3 (it exists only on `spike/0067c`), with `.some()` → `.every()`, and never covers a path fault.

---

## Releases

**R-any — a commit, not a release.** Our 14 rules, rescoped by construction. Includes moving `havePathMatching` from `src/predicates/module.ts:97` to `src/predicates/identity.ts`: the dogfood rule is scoped `'**/src/predicates/module**'` and its own comment already carves out identity predicates, so moving the function makes the scope glob the enforcement — exclusion by construction, no public API change (`src/index.ts:62` re-exports). Do **not** make it variadic unless the group model lands first.

**R1 — bug 0014, alone.** Match import globs against the resolved path **and** non-relative specifiers. Breaks in **two** directions: green→red for bans that now work, and **red→green for the allowlist family** (`onlyImportFrom`/`onlyBeImportedVia` violate when no matcher matches, so extra candidates can only reduce violations). Both go in the note, with a guard test that an allowlist reddening today on an installed package flips deliberately.

**R2 — groundwork. Non-breaking.** Single root (own commit); `GlobGroup`/`GlobSite` + combinator propagation; `PathUniverse`; `glob-diagnosis`; the graphql glob threading; `doctor`; the docs sweep.

- `doctor` reports, never fails, and **exits non-zero on findings** (an explicitly-invoked diagnostic, not a build gate). Shipped **experimental/hidden**, because removing a documented command later is its own breaking change.
- It must also cover **rules written inside vitest** — a co-equal documented path (`docs/running-in-tests.md`). An exported in-process reporting entry point, so that audience can pre-measure too. Without it R2 fails at its one job for half the users.
- It reports **identities, never totals** — including the set of predicate descriptions that declared no globs, not a count of them.
- **The docs invariant is syntactic, not satisfiability.** Doc examples legitimately reference paths that do not exist here. The scanner can enforce _anchored_ and _no `./` segment_; it cannot enforce satisfiability. It also needs **code-fence awareness and per-API classification** — `tests/docs/scan-markdown.ts` is 95 lines of per-line regex over symbol names, and without fence parsing it reds three legitimate patterns: the deliberate counter-example at `docs/troubleshooting.md:36`, the `base: 'normalized'` cases at `docs/slices.md:71,112,202,217`, and every bare specifier. Size this as real work.

**R3 — every flip together.** The glob guard, proposal 019, the severity floor + `.warn()` partition, `emptyIsPass`. One Upgrading section. Ships with the 8 vacuous-test fixes in the same commit.

**R3 does not ship until** the adopting codebase has run R2's pre-flight and its findings have been classified by remedy. Otherwise R2 is a version number between two commits.

### Gate run 2 — the amended rule, on an unseen codegen monorepo

Population: `dotansimha/graphql-code-generator`, chosen sight-unseen as "an OSS TypeScript monorepo with codegen", loaded from its **root** tsconfig (`include: ["packages"]`). Run 2026-07-25.

```
.ts files on disk under packages/ (pruned)   215
files in the project                         109
directories on disk                           91
directories absent from the project           47   ->  44 under tests/, 3 other
```

**Nearly half the TypeScript on disk is outside the project**, almost all of it tests, excluded deliberately (`exclude: ["**/tests/**/*.ts", "**/*.spec.ts", …]`). That is the ordinary shape of a real monorepo, not a defect.

The three non-test directories are the finding. `packages/presets/swc-plugin/src` contains **`lib.rs` and `tests.rs`** — a **Rust crate inside a TypeScript monorepo.**

Applying the registered decision rule — _does any finding's message assert a cause that is wrong for that input?_

| Absent directory            | Is "add it to your tsconfig `include`" right?                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `**/tests/**` (44)          | Plausible — if you intend to lint tests. So is "narrow the rule." Both branches genuinely apply |
| `swc-plugin/src` (Rust) (3) | **No.** It is not TypeScript. Adding it to `include` is nonsense                                |

**So the two-branch message from draft 4 is still not enough**, and the fix is to stop treating `outside-project` as a remedy at all:

> `outside-project` contributes a **verifiable fact** — "this path exists on disk but is not in the TypeScript project" — and then defers to the `no-match` cause list. It is not a separate remedy branch.

That keeps the useful half (the filesystem-vs-compiler derivation, which genuinely distinguishes "your glob is wrong" from "your project does not contain this") and drops the half the data refutes. It is also the position `slice-rule-builder.ts:57-64` already argues for, reached independently a third time.

**Gate verdict: pass, with that amendment.** No finding's message asserts a wrong cause once the remedy branch is removed. The `tests/` volume is the number to carry into the R3 changelog — on a real monorepo, roughly half the source may sit outside the project, so a rule scoped at test files is the most likely first red.

### The R3 gate, re-registered

Draft 3 pre-registered a gate, ran it, saw "STOP", and amended the rule to "unless the guard names the right remedy." The amendment is an improvement and both reviewers accepted it in principle — but an amendment made after seeing the result has to be re-registered and re-run, or the pre-registration bought nothing.

- **Population:** a real OSS TypeScript **monorepo with codegen**, exercised as a monorepo, not one package of one. Not yet looked at.
- **Decision rule (amended, registered before the run):** classify every finding by its correct remedy. A finding is acceptable if the guard's message states a **verifiable fact** and its remedy branches cover the real cause. If any finding's message asserts a cause that is wrong for that input, **R3 does not flip.**
- **Report shape:** identity — glob, origin, fault, resolved category. Never a total.
- Spike 1 showed the run costs a clone plus picomatch; `doctor` is not a prerequisite.

---

## Test inventory

| Test                                                                                      | Proves                                                          |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `notImportFrom('fastify')` and `layeredArchitecture({ restrictedPackages })` → **zero**   | R1 does not break R3 — written **first**                        |
| `notImportFrom('**/legacy/**', '**/old/**')` with only `legacy/` present → **no fault**   | the group `every` quantifier                                    |
| `satisfy(not(resideInFolder(typo)))` reports an **anchoring** fault, not unsatisfiability | polarity flip through `not()`                                   |
| `satisfy(dependOn(typo))` reports                                                         | the `Condition` half of the contract                            |
| per builder: construct with a known glob, assert **that exact string** in `globs()`       | set identity — a `return []` default must fail                  |
| for every `file`/`folder` site: a real path yields ≥1 subject, nonsense yields 0          | `kind` is behaviourally correct, not just declared              |
| **every unsatisfiable-glob fixture contains ≥2 candidate paths**                          | mechanically catches `.some(matcher)` — the trap needs index ≥1 |
| `outside-project` message asserts no cause; both branches present                         | ADR-008 rule 2                                                  |
| in-memory and `tsConfigPath: 'in-memory'` projects produce no disk-derived fault          | the absolute-root guard                                         |
| `ignorePaths('**/nonexistent/**')` no finding; `inFolder('**/nonexistent/**')` fires      | exclusion vs selector on one builder                            |
| `slices().matching('src/features/*')` not reported unanchored                             | `base: 'normalized'`                                            |
| `.asSeverity('warn')` cannot downgrade any of the six meta-findings                       | the derived producer set                                        |
| the arch suite is green from a differently-named checkout                                 | bug 0011 fixed by construction                                  |

Each verified by sabotage: revert the fix, watch it go red.

---

## Known exposures, stated not hidden

- The `only*` family passes vacuously on subjects with no edges — **filed as its own bug**; R3's changelog claim is scoped to path globs.
- A hand-written `{ description, test }` predicate declares no globs; `doctor` reports their descriptions.
- `PathUniverse` over-approximates directories; the guard is fail-open there.
- Per-package `project()` with a shared glob-bearing rule file gets a false red; `workspace()` is the answer, in the message and the docs.

## Open questions

1. **1.0 gate.** R3 is breaking and path-normalization is a further deferred breaking change, so 1.0 is at minimum R3 → path-norm → two quiet releases.
2. **`doctor`'s life after R3** — keep as a supported command, or retire it? It must be decided before it ships, since users will script it.

## Out of scope

- **Bug 0012** — per-element thresholds, different mechanism.
- **Path normalization** — making `'src/*'` _work_ is the deeper fix and is separable.
- **`docs/standard-rules.md:270`** links to a `#monorepo-setup` anchor that does not exist in `getting-started.md`. Unrelated, but on the path users will follow once `workspace()` becomes a correctness requirement.
