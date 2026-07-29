# Plan 0069 — No rule may certify nothing

**Status:** **PARTIALLY SHIPPED in v0.20.0** — R-any, R1, R2a and R3a are released. **R2b** (the fence-aware docs scanner) is unblocked and off the critical path. **R3b** (the glob flip, proposal 019, `emptyIsPass`) is designed — its two open decisions are settled in [the appendix](./0069-appendix-vacuous-tests.md) — and gated on an adopting codebase running R2a's `doctor` pre-flight, which is possible from v0.20.0 onward. [Bug 0016](../bugs/fixed/0016-narrowing-a-named-selection-mutates-it.md) **shipped in v0.21.0**, and its effect on R3b is now measured rather than assumed: re-running the appendix's recipe gives 28 failures at v0.20.0 and 29 at v0.21.0, with zero entries leaving the population and exactly one entering (a guard the fix itself added, now classified in category B). **No classification changed.** Bugs 0019/0020 and proposal 019 have **moved to [plan 0070](./0070-a-rule-must-assert-something.md)** (its 0.22.0 instrument is built and awaiting tag; its 0.23.0 flip closes both bugs), so R3b shrinks to the glob guard and `emptyIsPass` — still gated on the adopting codebase's pre-flight.
**Priority:** Highest open item. The defect the tool exists to prevent, committed by the tool.
**Supersedes:** part C of [plan 0067](./0067-empty-selector-safety.md); ~~absorbs [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md)~~ — **019 moved to [plan 0070](./0070-a-rule-must-assert-something.md)**; closes [bug 0011](../bugs/fixed/0011-dogfood-rules-select-nothing.md).
**Prerequisites:** [bug 0014](../bugs/fixed/0014-bare-package-import-globs-match-nothing.md) ships first, alone. The single-root refactor (`spike/0014-rule-census`, +456/−165) is **unmerged** and lands as its own commit with its own test pass.

## Corrections carried into draft 7

Round 6 again found the largest defect **inside the previous draft's own fix**, for the third draft running — all three in the same six lines of evaluator. That is what motivated `spikes/0069-tree-model-check.mjs`; the algorithm is small enough to check completely, so arguing about it was the mistake.

| Claimed in draft 6                                                   | Derived 2026-07-26                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`and()` may drop globless children; `some(dead)` is monotone"       | Monotone **under a fixed `op`** — and draft 6 made `op` mutable. Model-checked: **2 false reds** over 4088 expressions. Replaced by a retained opaque leaf: **0 false reds, 0 misses**                                                          |
| "exactly **one** selector matches a directory"                       | Three do. The omission that matters is `strictBoundaries({ folders })` (`src/presets/boundaries.ts:117`), `parent-dir` in **`discovery`** position, where unsatisfiable ⇒ fault                                                                 |
| "a preset's option list → `any`"                                     | Both shipped presets **fan out one rule per glob** (`layered.ts:135`, `boundaries.ts:39`). `any` would say "no fault unless every layer is dead" — a false green inside a preset                                                                |
| `GlobSite` carries `position` and `origin`                           | Neither is knowable by the code that mints a site, and the type is exported for users to write. Split into `DeclaredGlob` (author-facing) and `GlobSite` (builder-stamped)                                                                      |
| R3a ships "its **13** doc edits"                                     | The withdrawn number, surviving in the one section anyone executes from. 13 is the dogfood-rule count from the Problem table. **Both reviewers caught this independently**                                                                      |
| The sweep is "the grep plus a read of every `### .warn()` heading"   | There are exactly **3** such headings, covering **1** of the 4 known misses. A procedure needing a hand-list to be complete is the defect this plan is about. Replaced with a bounded superset: **136** `/warn/i` lines in docs+examples+README |
| R2a is non-breaking, and threads a glob into `resolvers()`           | `ResolverRuleBuilder` is exported from the public `./graphql` subpath (`src/graphql/index.ts:93`); its constructor is public API. The parameter must be optional                                                                                |
| the set-identity test reflects over "the exported builder list"      | `src/index.ts` does **not** export `SchemaRuleBuilder`/`ResolverRuleBuilder` — including the one builder R2a modifies. Must reflect over both entry points. 6 `RuleBuilder` + 7 `TerminalBuilder` subclasses, derived                           |
| the `#monorepo-setup` "anchor fix", scheduled in R2b                 | The heading exists, at `docs/modules.md:201`; `standard-rules.md:270` targets `/getting-started`. It is a **retarget**, and R3 makes it load-bearing, so it moves to R3a                                                                        |
| "**36** in-repo" ancestors that are no file's parent                 | 35 strictly below the repo root; 36 counts the root itself. It also collided with an unrelated 36 (transitive-not-direct), which is exact                                                                                                       |
| "an eleventh builder"                                                | Underived ordinal, which this plan bans. There are 13 builder classes: 6 + 7                                                                                                                                                                    |
| proposal 019 ships in R3b, gated on R2a's pre-flight                 | `doctor` reports **glob** findings; 019 fires on condition-less rules. Applying this plan's own question: the gate would pass if 019's blast radius were completely wrong. `doctor` must report condition-less rules too                        |
| `docs/standard-rules.md:460` "is about metric limits, not `.warn()`" | Correct as written — round 6 pushed back claiming it says "use `.warn()` for soft limits". It does not; it says "start with generous limits". The dismissal stands                                                                              |

`docs/standard-rules.md:460` has now been miscited in two consecutive review rounds — first as a `.warn()` promise, then as saying "use `.warn()` for soft limits". It says "Start with generous limits and tighten over time." Reviewer output is evidence, not authority; every row above was re-derived from the source before being written down, and two rows exist only because a reviewer's claim did **not** survive that check.

### Corrections carried into draft 6

Round 5 found three defects **inside draft 5's own fixes**. Every row was re-derived before being written down.

| Claimed in draft 5                                                     | Derived 2026-07-26                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`not()` flips `polarity` across its subtree" is sufficient            | Only for an unnested `not()`. With a `not` already inside the subtree it produces a **false red** one way and a **miss** the other. `not()` must invert `op` as well — full De Morgan push-down                                                     |
| An `any` node may drop children that declare no globs                  | That makes `or()` fail **closed**: `or(havePathMatching(dead), exportSymbolNamed('Foo'))` reds a working rule. Most predicates declare no globs, so this would be commoner than the bug the tree replaced                                           |
| R-any's `havePathMatching` move "makes the scope glob the enforcement" | It does not. The selector is `resideInFolder('**/src/predicates/module**')`, which matches **0 directories and 1 file** — before the move and after it. The census still prints `DEAD …:567` on the commit that claims to close it                  |
| `kind: 'file' \| 'folder'`                                             | Names the intent, not the matched string. `SmellBuilder.inFolder()` matches the **full path** (`src/smells/duplicate-bodies.ts:52`). Renamed to `file-path` / `parent-dir` and derived from the matcher                                             |
| Directories are all ancestors; "only 3 hold solely subdirectories"     | **41** ancestors are no file's immediate parent (**35** strictly below the repo root), and `resideInFolder` tests the immediate parent only (`src/predicates/identity.ts:96`). All-ancestors is a **false green**, not a fail-open. The 3 was wrong |
| `onDisk` derived from `path.dirname` of each disk file                 | Direct-parent containment. **36** directories hold TypeScript transitively but not directly — including `docs/`, which would print "contains no TypeScript" above `docs/.vitepress/config.ts`. A false fact                                         |
| "Four documented promises change with `.warn()`"                       | **18 by grep, across 12 files — and the grep undercounts by at least 4.** No total is asserted; the sweep is specified instead. `.severity('warn')` / `.asSeverity('warn')` are documented aliases the sentence never mentioned                     |
| "8 synthetic doubles across 6 files"                                   | 8 doubles, **7 files**. The 8 and the 2/3/2/1 split are exact                                                                                                                                                                                       |
| gcg's 44 `tests/` + 3 Rust map onto the two categories                 | Inferred, not measured — the script was never run against a gcg checkout with the two-category split. Claim withdrawn; this repo carries it                                                                                                         |
| `loadSchemaFromGlob` needs its glob threaded, "same as `resolvers()`"  | It **throws** on zero matches (`src/graphql/schema-loader.ts:109-112`). Threading buys nothing. Only `resolvers()` needs the R2 widening                                                                                                            |
| "149 directories, 15ms"                                                | 149 verified; 4ms warm. A wall-clock figure is not re-derivable under this plan's own rule. Dropped                                                                                                                                                 |

Standing rule for this plan: **no count appears in it that was not derived on the stated date, and none that a reader cannot re-derive.** Both scripts are committed under `spikes/`; both were themselves wrong this round and are fixed.

> The census has now had **two** `kind` bugs, and each one reported a vacuous rule as satisfiable. First a single flat universe of files + directories; then `inFolder: 'folder'`, which is false for the only `inFolder` that ships. That is the best evidence in this document that `kind` must be derived from **what string the matcher is applied to**, never from what the API is called.

---

## Problem

A rule that cannot match anything passes. Measured:

| Where                              | What                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This repo (2026-07-26)             | 13 dogfood rules select nothing outside a checkout named `ts-archunit`; 1 selects nothing everywhere and hides a live violation                          |
| This repo's own suite (2026-07-26) | **35** tests across 19 files assert on a rule whose selector matches nothing — see below; the earlier figure of 8 was wrong and, worse, not reproducible |
| An adopting codebase (2026-07-25)  | 7 rule sites, **2 of them security rules** — JWT verification and internal-route auth, both guarding nothing                                             |

`.expectNonEmpty()` exists for this and is opt-in. The adopting team calls it eight times (2026-07-25), in the same files as their seven vacuous rules. Opt-in does not work.

Derivation status of each row, because two of the three are not yet reproducible:

- **Row 1** — `node spikes/0069-glob-census.mjs`: 35 path-glob sites, 16 import-target sites exempt, **1 matching nothing** (`arch-rules.test.ts:567`). The 13 is a separate one-line grep (`grep -c "ts-archunit/src" tests/archunit/arch-rules.test.ts` → 13), confirmed by rerunning the universe with the checkout renamed: 14 parent directories match here, **0** renamed.
- **Row 2** — re-derived 2026-07-26, and it was **35, not 8**. Method, reproducible in one edit: set `_requireNonEmpty = true` in `src/core/rule-builder.ts` and run the suite. 35 tests fail across 19 files.

  That is the **blast radius, not the defect count**, and the distinction is the work R3b actually has to do. Most of the 35 are legitimate — `.notExist()` rules where zero subjects is the passing state, and tests whose entire point is an empty selection (`resideInFolder with nonexistent folder matches nothing`). But some are genuine, and one is a clean specimen: `tests/integration/coverage-gaps.test.ts:480` is named `finds interfaces extending Entity` and its body asserts that `extendType('NonExistentBase')` produces no violations. The name and the body disagree, the body asserts on an empty set, and its own comment records the author losing track mid-test.

  **Classified 2026-07-26** in [the appendix](./0069-appendix-vacuous-tests.md), then corrected after review: **22** legitimate, **5** asserting the current default R3b inverts by design, **8** genuine. The first cut said 26/1/6 — it miscounted its own table by one, dropped one of the 35 tests entirely, and filed a **live shipped preset bug** ([0018](../bugs/fixed/0018-data-layer-preset-silently-enforces-nothing-for-a-file-glob.md)) under legitimate.

  The classification changed R3b's design, which the number alone could not have — and then review changed it again. "An empty selector fails **unless the condition is satisfied by emptiness**" turned out to be true of _every_ condition (∀ over ∅ is vacuous) and derivable from none of them. The workable rule is narrower: exempt only a condition that asserts **cardinality**, where zero subjects is the answer rather than the absence of one. `notExist()` is the only shipped condition of that kind, and the flag has to be declared rather than probed.

  One of the six was written during this plan, in the commit that fixed bug 0014 — by someone who had spent a week on this exact failure mode. That is the argument for the mechanism rather than for more care.

- **Row 3** — the adopting codebase, 2026-07-25. Not reproducible here by design.

---

## Mechanism

> **Can this glob match anything in this project?** — a question about the _project_, answerable without running the rule.

### The data model is a tree, and `not()` pushes through it

Draft 3 flattened everything, which destroyed the grouping. Draft 4 specified `or()` as concatenation, which reds `or(dead, live)`. Draft 5's tree fixed that and broke `not()`. Draft 6 fixed `not()` and broke `and()`. **Three consecutive drafts produced a false verdict from the same six lines**, each on a shape the author had not thought to try — so draft 7 stops arguing about it and checks it exhaustively. `spikes/0069-tree-model-check.mjs` enumerates every expression with at most three combinator nodes over `{dead, live, opaque}` and compares the evaluator against plain set semantics:

```
draft 6  or:total-prop, and:drops   expressions 4088   FALSE REDS 2   fail-open misses 2
      false red: not(and(opaque, not(DEAD)))
draft 7  opaque leaf retained       expressions 4088   FALSE REDS 0   fail-open misses 0
```

A fault is sound only if the expression selects ∅ for **every** assignment to the leaves the evaluator cannot see, since it knows only that a `dead` site matches nothing. Draft 7 is exact over the whole space — no false reds, and no missed emptiness either.

The settled model. Two types, because a predicate cannot know what a builder knows:

```ts
/** What a predicate declares. This is the type a rule author writes. */
interface DeclaredGlob {
  readonly glob: string
  readonly kind: 'file-path' | 'parent-dir' | 'import-target' | 'specifier' | 'literal'
  readonly polarity?: 'positive' | 'negative' // default 'positive'
  readonly base?: 'absolute' | 'tsconfig-relative' | 'normalized' // default 'absolute'
}
/** What the builder stamps onto it at record time. */
type GlobSite = DeclaredGlob & {
  readonly position: 'selector' | 'discovery' | 'condition' | 'exclusion'
  /** For the message: `resideInFolder("…") in rule "adr005/no-any"`. */
  readonly origin: string
}
/** A predicate that declares no globs. Never dead, never dropped. */
interface OpaqueLeaf {
  readonly opaque: true
}
interface GlobNode {
  readonly op: 'any' | 'all'
  readonly children: readonly (GlobNode | GlobSite | OpaqueLeaf)[]
}
```

Draft 6 had one type carrying `position` and `origin`, which the code that mints a site — inside `resideInFolder()`, several frames below any builder — cannot know, and which the builder then overwrites. Worse, `GlobSite` is **exported** so users can write predicates, and a user who copy-pastes `position: 'exclusion'` silently and permanently exempts their predicate, since exclusion is never a fault. `DeclaredGlob` is the author-facing type and cannot express that.

```
dead(site)   = site.polarity === 'positive'
            && (site.kind === 'file-path' || site.kind === 'parent-dir')
            && no path in that kind's universe matches site.glob
dead(opaque) = false
dead(node)   = node.op === 'all' ? node.children.some(dead)
                                 : node.children.every(dead)
```

`and(a, b)` → `all`; `or(a, b)` → `any`; a variadic predicate (`importFrom(...globs)` is `matchers.some`, `src/predicates/module.ts:45`) → `any`; repeated `.inFolder()` calls OR together (`folderMatchers.some`) → `any`.

**`not()` inverts `op` as well as `polarity`** — a full negation-normal-form push-down. Draft 5 flipped polarity only, which is right for `not()` over plain leaves and wrong as soon as the subtree already contains a `not()`. Both directions are reachable through public exports, since `and()` returns a `Predicate<T>` and `not()` takes one:

| Expression                  | Truth                                 | Polarity flip alone | With `op` inverted |
| --------------------------- | ------------------------------------- | ------------------- | ------------------ |
| `not(and(live, not(dead)))` | selects the complement of `live` — no | **false red**       | no fault ✓         |
| `not(or(live, not(dead)))`  | selects ∅ — **genuinely dead**        | **missed**          | fault ✓            |

**A predicate declaring no globs contributes an opaque leaf, which is never dead and is never dropped.** Draft 6 said `or()` propagates only when every input declares globs while `and()` may drop the ones that do not — reasoning that dropping is safe under `all` because `some(dead)` is monotone. Monotone _under a fixed `op`_; the very same draft made `op` mutable. `not(and(not(havePathMatching(dead)), exportSymbolNamed('Foo')))` drops the opaque child, inverts to `any[positive dead]`, and reds a rule selecting every module that does not export `Foo`.

Retaining opaque leaves costs nothing — `and(dead, opaque)` is still `some(dead)` and still faults — subsumes the `or()` rule so there is one rule instead of two asymmetric ones, and makes an **empty node unreachable**, which matters because `[].every(dead)` is `true` and would otherwise fault a rule containing no globs at all. Invariant, stated anyway: **an empty node is never dead, and none is ever emitted.**

**A negative site is never dead.** With `op` inverting, that one clause is what makes `not()` correct in all four op/polarity combinations.

**Where a non-flat tree can actually come from.** `that(): this` takes no argument (`src/core/rule-builder.ts:43`) and `.and()` only ANDs, so in selector position a tree deeper than one level arises **only** through `.that().satisfy(combinator)`. That bounds the test surface. It also means the three `@example` blocks at `src/core/combinators.ts:12,45,74` — `functions(p).that(not(areAsync()))` — **do not compile**. Three real doc bugs inside `src/`, invisible to the markdown scanner; they go in the R2b sweep.

### `kind` names the matched string; `position` is stored, not inferred

`kind` is not what the API is called. Derived by grepping **every directory derivation** in `src/` — `lastIndexOf('/')`, `path.dirname`, `replace(/\/[^/]+$/, '')` — rather than every selector, because draft 6 used the narrower reading and missed one:

| Site                                                                                      | Matched against      | `kind`          | position    |
| ----------------------------------------------------------------------------------------- | -------------------- | --------------- | ----------- |
| `resideInFolder` (`src/predicates/identity.ts:96`)                                        | immediate parent dir | `parent-dir`    | `selector`  |
| `resideInFolder` as a Condition (`conditions/structural.ts:43,48`, `function.ts:205,210`) | immediate parent dir | `parent-dir`    | `condition` |
| **`strictBoundaries({ folders })` (`src/presets/boundaries.ts:117`)**                     | immediate parent dir | `parent-dir`    | `discovery` |
| `resideInFile`, `havePathMatching`, `assignedFrom`, `slices().matching()`                 | full absolute path   | `file-path`     | varies      |
| `SmellBuilder.inFolder()` (`src/smells/duplicate-bodies.ts:52`)                           | full absolute path   | `file-path`     | `discovery` |
| `crossLayer().layer()`                                                                    | full absolute path   | `file-path`     | `discovery` |
| `importFrom` and family                                                                   | resolved module path | `import-target` | varies      |

The `strictBoundaries` row is the one that matters: it is `parent-dir` in **`discovery`** position, where the polarity table says unsatisfiable ⇒ **fault**. Under draft 6's stated rule ("everything but `resideInFolder` is `file-path`") an implementer types it `file-path`, and `folders: '**/src/features/*'` then checks satisfiable against matching _file paths_ while matching zero directories — the R-any bug, reproduced inside a preset.

**A preset's fan-out list is not an `any` node.** Draft 6 said "a preset's option list → `any`", which is right for one predicate taking many globs and wrong for a list that becomes one rule per entry — and both shipped presets are the latter: `src/presets/layered.ts:135` iterates `options.layers` and `src/presets/boundaries.ts:39` iterates `sharedGlobs`, each producing its own builder. One dead layer glob is one vacuous rule, and `any` would say "no fault unless every layer is dead" — a false green inside a preset. Each generated builder declares its own root site; the preset declares no combined node. Only `strictBoundaries({ folders })` is a genuine preset-level site.

`position` lives **on `GlobSite`**, set at record time. Draft 5 described its derivation and then left it out of the model, which cannot work: `discovery` and `exclusion` sites have no predicate to hang it on. It has two structural sources, neither a hand-written label:

| Builder family               | `position` from                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `RuleBuilder<T>` subclasses  | `this._phase` at record time (`src/core/rule-builder.ts:30`) — `predicate` → `selector`  |
| `TerminalBuilder` subclasses | the recording method — `slices().assignedFrom()`, `crossLayer().layer()` are `discovery` |
| any builder                  | `.excluding()` / `ignorePaths()` record `exclusion`                                      |

`_phase` exists only on `RuleBuilder`; **seven** builders extend `TerminalBuilder` and have none.

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

**Known exposure:** the `only*` family is not reliably loud — `onlyImportFrom` iterates import declarations, so a subject with zero imports passes vacuously (`src/conditions/reverse-dependency.ts:146` documents this for `onlyBeImportedVia`). Filed as [bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md), and R3's changelog claim is scoped to **path globs** accordingly.

`import-target` globs are exempt entirely. Measured 2026-07-26: `getSourceFiles()` returns 430 files here, **0 under `node_modules/`**, so `**/node_modules/typescript/**` — which `arch-rules.test.ts:98` uses correctly — is unsatisfiable against any path universe by construction, and checking it would fail every correct dependency rule in existence.

`base` does not select a universe; it shapes only the message. Letting it choose the view makes a mis-declared `base` produce a false red **by construction**, on the one axis with no second derivation. The verdict is against the **union** of the views for that `kind`. The residual is a small fail-open, which is the right direction for a breaking change.

### `PathUniverse`

Free function, `WeakMap<ArchProject, …>`, plain strings — not a method on `ArchProject`, whose bare-object test doubles are real. Lives in `src/core/`, consumes `ArchProject`, imports no ts-morph: ADR-007's batch-first shape by construction.

**Two path views, not four**: absolute file paths, and **immediate parent directories** — plus their tsconfig-relative forms. Draft 5 used all-ancestors for the folder view "because an exact-directory glob with no trailing `/**` needs it". That reasoning was backwards. `resideInFolder` tests `filePath.substring(0, lastIndexOf('/'))`, the immediate parent and nothing else, so an all-ancestors universe is not a fail-open — it is a **false green**. Measured: 81 immediate parents against 122 all-ancestors, and **41** of the ancestors are no file's parent. `resideInFolder('**/tests/fixtures')` can never select anything, and all-ancestors calls it satisfiable. Using the parent set removes the over-approximation rather than excusing it, and deletes a Known Exposure.

**The disk set is a memoized lazy view in the same entry, computed on first fault only.** Draft 4 specified it eagerly and called it "never a trigger"; those contradict, and the eager form charges every `check()` a filesystem walk to answer a question no fault asked.

The walk needs an **entry budget with a documented degrade**. The prune list is `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next` — and the plan's own gate repository defeats it: `graphql-code-generator` contains a Rust crate, so a contributor who has run `cargo build` has a `target/` of tens of thousands of entries. Same for `.venv`, `vendor`, `.turbo`, `.yarn`, `.gradle`. Lazy evaluation bounds this to already-failing runs, but a failing run that then hangs inside a 5s vitest timeout is worse than the false green. The budget is **50,000 directory entries**, an implementation constant outside the public contract and not user-tunable. On exceeding it the enrichment degrades to "not determined" — it is already fail-open, so the only cost is message quality, and the degrade path gets its own test rather than being reached only by accident.

Tests assert the **property** — every project file's parent is in the parent view — not the counts. A pinned 430/81 is the snapshot ADR-008 rule 4 bars.

ADR-007 note: materializing the file list is 430 `getFilePath()` crossings. Caching them once is the right mitigation, but the engine-side consequence must be named now — the future `Engine` needs one coarse `filePaths(): readonly string[]`, or the loop merely relocates.

### `outside-project`, specified

Not a fault and not a trigger. It is a **classification of an already-firing `no-match`**, which is what makes it safe on in-memory projects.

- **Disk root:** reuse `discoverIdentityRoot` (`src/helpers/identity-root.ts`), which already answers "where is the root" nearest-first with a written rationale.
- **Guard:** `path.isAbsolute(project.tsConfigPath) && fs.existsSync(root)`, checked on the **input**, before calling `discoverIdentityRoot`. Draft 4 put it on the derived root, where it can never fail — `discoverIdentityRoot` calls `path.resolve` and every return is absolute. Of the **8** synthetic `tsConfigPath` doubles in the suite (7 files), 2 are the relative `'in-memory'` (whose `path.dirname` is `'.'`, walking the real CWD) and **6 are absolute paths that do not exist** — `/repo` ×3, `/virtual` ×2, `/mem` ×1. This is not a test-shaped guard: `ArchProject` is a public exported type, so it protects user-constructed projects too.

**The message states a fact, asserts no remedy, and has its own cause list — not `no-match`'s.** Deferring to `no-match` re-imports _"append `/**`, a segment is misspelled, or the directory holds no source files"_ (`src/builders/slice-rule-builder.ts:74`), two of which are refuted by the fact printed one line above.

**Containment is transitive, and the verdict is per glob, not per path.** A path holds TypeScript if any TypeScript file exists **at or below** it; a glob's verdict is `holds-typescript` if **any** matched path holds TypeScript. Draft 5's committed derivation used `path.dirname` — immediate parents — which mislabels **36** directories on this repo alone, `docs/` among them: it would have printed "contains no TypeScript" directly above `docs/.vitepress/config.ts`. That is a false statement in the one message whose entire ADR-008 defence is that it states only facts. The per-glob rule also settles what happens when one glob straddles both categories, which draft 5 left unspecified while both gate populations have that shape.

| Disk evidence                          | What `outside-project` states                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| some matched path **holds TypeScript** | "exists and contains TypeScript, but your tsconfig's `include`/`exclude` keeps it out of the project" |
| no matched path holds TypeScript       | "exists but contains no TypeScript"                                                                   |
| budget exceeded                        | not determined — no claim                                                                             |

Measured on this repo 2026-07-26 with transitive containment: 33 absent directories, **3** holding TypeScript (`docs`, `docs/.vitepress`, `examples`), **30** not. Both categories populated. The gcg run's 44 + 3 split is **not** claimed against these categories — that script was never run there with the two-category logic, and draft 5 asserted it.

Both categories are verifiable and neither asserts a remedy. This is also a genuine second derivation — filesystem contents versus compiler membership — so it satisfies ADR-008 rule 5 without reading a config file. **Explicitly out of scope:** quoting the offending `exclude` entry. It would be better, and it requires resolving `extends` chains; ts-morph does not expose `include`/`exclude`, which are not compiler options.

### `glob-diagnosis`, promoted

`diagnoseGlob` + `FAULT_ADVICE` (`src/builders/slice-rule-builder.ts:40-75`) moves to `src/core/glob-diagnosis.ts`, and `outside-project` leaves the fault union:

```ts
type GlobFault = 'dot-segment' | 'unanchored' | 'file-not-folder' | 'no-match'
interface GlobDiagnosis {
  readonly fault: GlobFault
  /** Only populated for `no-match`; the other faults are syntactic. */
  readonly onDisk?: 'holds-typescript' | 'no-typescript' | 'not-determined'
}
```

`dot-segment` and `unanchored` are verifiable transformations, both exempt for `specifier`/`import-target`/`literal` — after R1, `notImportFrom('fastify')` is a **working rule** and `isAnchored('fastify')` is `false`. `file-not-folder` is verifiable and has a measured instance: `resideInFolder('**/src/predicates/module**')` matches **0 parent directories and 1 file**. `no-match` lists causes and asserts none.

`base: 'normalized'` for `slices().matching()`, whose `parseMatchingGlob` (`src/models/slice.ts:73`) already strips and re-adds `**/`.

### Globs that escape the contract

`resolvers(p, glob)` filters eagerly in the entry function and hands the builder only `SourceFile[]` — **the glob string is discarded** (`src/graphql/index.ts:82-88`), so no `globs()` can ever report `resolvers(p, 'src/reslvers/**')`. **Decision:** thread it into the builder in R2a, as an **optional** parameter. `ResolverRuleBuilder` is re-exported from the public `./graphql` subpath (`src/graphql/index.ts:93`), so its constructor is public API and a required second parameter would break anyone constructing it directly — which would make R2a breaking, and R2a is the release people install in order to measure. `resolvers()` always passes it.

`loadSchemaFromGlob` (`src/graphql/schema-loader.ts:104`) does **not** need this. It already throws on zero matches (`:109-112`), which is the outcome this plan wants; threading its glob would buy nothing. Draft 5 called the two cases "the same"; they are opposites.

`crossLayer().layer()` needs no restructuring — `Layer.pattern` already reaches `PairFinalBuilder`; its own JSDoc example (`cross-layer-builder.ts:56`, `'src/routes/**'`) is unsatisfiable and is a good first catch for the docs sweep.

Checked and clear: `TypeMatcher` (regex, no path globs), smell builders (builder-recorded), `TsconfigBuilder` (no globs), `correspondence()` (takes selections).

`globs(): GlobNode[]` on the root is **concrete with a `[]` default**, not abstract — adding an abstract member to `RuleBuilder`/`TerminalBuilder` (both public exports, `src/index.ts:21-22`) is a compile break for subclassers, and R2 is the release people install in order to measure. The set-identity test fails a `return []` stub. It reflects over the namespace objects of **both** `src/index.ts` and `src/graphql/index.ts`, filtering by prototype chain on `RuleBuilder`/`TerminalBuilder`, because the main entry point does not export `SchemaRuleBuilder`/`ResolverRuleBuilder` — and `ResolverRuleBuilder` is the one builder R2a modifies. Derived: 13 builder classes, 6 extending `RuleBuilder<T>` and 7 extending `TerminalBuilder`.

---

## Decisions

**Semantic emptiness does not flip**, so **no `.allowEmpty()` is added** and the `CorrespondenceBuilder.allowEmpty(sideName)` collision dissolves.

**Monorepo shared rule file → option (a)**, chosen by both reviewers. `workspace()` is the supported path for glob-bearing rules; per-package `project()` with a shared rule file gets a false red. The obstacle draft 3 claimed does not exist: the per-package recommendation in `docs/config-rules.md:66` and `setup-best-practices.md:83` is scoped to `tsconfig()`, which takes no globs. Option (b) needs cross-`check()` state and would make a rule's colour depend on which other rules ran; option (c) reopens `.allowEmpty()`, which ADR-008 rule 3's corollary bars — an opt-out is the first thing an agent adds on the first red, including the real typo.

Condition: the selector-empty message carries the shape as a **cause, not an asserted remedy** — _"if this rule file is shared across packages loaded separately, use `workspace([...])` so the path universe is the union."_

**Meta-findings are floored at `error` — at three sites.** Six `bypassFilters` producers (`src/core/rule-builder.ts:407`, `src/builders/slice-rule-builder.ts:258`, `src/builders/correspondence-builder.ts:301`, `src/conditions/cross-layer.ts:52`, `src/presets/shared.ts:66`, `src/helpers/baseline.ts:329` — fully qualified, because two files named `baseline.ts` and two named for cross-layer exist); five set no severity.

| Site                                  | Today                    | Reaches                                                  |
| ------------------------------------- | ------------------------ | -------------------------------------------------------- |
| `rule-builder.ts:200`                 | overwrites with `sev`    | `.violations()`                                          |
| `terminal-builder.ts:102`             | overwrites with `sev`    | `.violations()`                                          |
| `execute-rule.ts:138` `stampSeverity` | `v.severity ?? severity` | `executeCheck` (`'error'`), **`executeWarn` (`'warn'`)** |

Draft 4 called the third safe; it is the one that silently resolves five unset producers to `warn`. The floor is `v.bypassFilters === true ? 'error' : <the site's existing expression>`, at all three. These are exhaustive — every other read of `severity` is a `?? 'error'` that defaults upward. Reachability differs per producer: `presets/shared.ts:66` returns a bare `{ violations }` and reaches no stamp site, and `baseline.ts:329` is produced inside `filterNew`, which runs on the `executeCheck`/`executeWarn` path only.

**The `.warn()` contract, in two clauses:** **`.warn()` throws an `ArchRuleError` carrying only the `bypassFilters` meta-findings; ordinary violations are logged exactly as before and never throw.**

The payload half matters as much as the throw. An error carrying 200 warn-severity violations plus one meta-finding makes R3's "these findings are true" false for 200 of 201 entries, and recreates the noise problem in the release that fixes it. `.violations()` remains the non-throwing programmatic surface, which is the honest escape hatch.

Three surfaces inherit it and must be named: `.warn()`, the terminal `.severity('warn')` (which literally calls `.warn()`, `src/core/rule-builder.ts:283`), and the non-terminal `.asSeverity('warn')` followed by `.check()`. The CLI already catches `ArchRuleError` from self-executing rule files and folds it into the run (`src/cli/commands/check.ts:41-50`), so the throw degrades correctly there.

**The documented promises that change with it are not four, and the count is not the deliverable — the sweep is.** A keyword grep finds **18 statements across 12 files** (2026-07-26):

```bash
grep -rnEi "warn" docs examples README.md src/core/execute-rule.ts \
  --include='*.md' --include='*.ts' --exclude-dir=dist \
| grep -Ei "advisor|never throw|not throw|without throwing|don't fail|does not fail|non-?failing|test passes|gradual|not blocking|calls \`\.warn"
```

`docs/api-reference.md:49,61`; `docs/violation-reporting.md:57`; `docs/core-concepts.md:223,230`; `docs/running-in-tests.md:66`; `docs/smell-detection.md:18,54,58`; `docs/standard-rules.md:386`; `docs/cross-layer.md:165,166`; `docs/cli.md:153`; `docs/setup-best-practices.md:17,31`; `docs/ai-agents.md:47`; `docs/what-to-check.md:717`; `examples/custom-rules.test.ts:151`.

**And the grep undercounts**, which is the part worth writing down. It misses four promises whose promising line does not contain the token `warn` at all: `docs/violation-reporting.md:46` ("does not throw. The test passes."), `docs/running-in-tests.md:101`, `docs/smell-detection.md:9` ("reports without failing"), and `src/core/execute-rule.ts:202` ("Advisory — … never throws").

So the keyword grep is a starting point, not the checklist. Draft 6 said the checklist was "the grep plus a read of every `### .warn()` heading" — there are exactly **three** such headings (`violation-reporting.md:34,44`, `core-concepts.md:227`), and they cover **one** of the four known misses. A procedure that needs a hand-written list to be complete is the defect this plan is about.

**The checklist is therefore a bounded superset that requires no hand-list: every line matching `/warn/i`.** Measured 2026-07-26: **136** in `docs/`, `examples/` and `README.md` (excluding the built `docs/.vitepress/dist/`), plus **124** in `src/` for the JSDoc class. That is one sitting, it is mechanically complete, it is re-derivable by anyone, and it asserts no total about how many will actually need editing — which is the number nobody can know in advance.

**A fifth suppression surface needs the same guard: inline exclusion comments** (`src/core/execute-rule.ts:113-116`). `isExcludedByComment` has no `bypassFilters` check. Meta-findings are immune today only **by accident** — they carry `file: ''` (`rule-builder.ts:399`), `readFileSync('')` throws into the catch, and `comment.file === ''` can never hold. The moment a meta-finding carries a real path — and R2's `doctor` reporting glob _origins_ is exactly that temptation — an `// arch-ignore` silently suppresses the finding that says the rule enforces nothing. Add the explicit guard at `:114` in the same commit.

**`emptyIsPass`, specified** — it was previously named only as "`.some()` → `.every()`", which lives on `spike/0067c-empty-by-default` and not in this plan, making it unimplementable from here. The contract: a condition today reports a violation when **some** subject fails; over an empty subject set that is vacuously false, so the rule passes. `emptyIsPass` inverts the default — a condition is satisfied only when **every** subject satisfies it _and_ at least one subject exists — so an empty subject set fails instead. It is opt-out per condition for the genuine cases (`.notExist()` rules, where zero subjects is the passing state), it **never covers a path fault** (an unsatisfiable glob is caught earlier, by the tree, with a different message), and it lands in R3b. Its doc surface is `docs/core-concepts.md`'s condition semantics section.

---

## Releases

**R-any — a commit, not a release. Two edits, not one.** Moving `havePathMatching` from `src/predicates/module.ts:97` to `src/predicates/identity.ts` does **not** close `api/no-single-glob-predicates`: its selector is `resideInFolder('**/src/predicates/module**')`, which matches 0 parent directories before the move and 0 after. The selector must also be retyped to a file kind — `resideInFile('**/src/predicates/module.ts')` — and must stay module-specific, since widening to `'**/src/predicates/**'` would red on `identity.ts` once `havePathMatching` lands there. Verify by running the census on the same commit: it must no longer print `DEAD …:567`. The move itself is API-invisible (`src/index.ts:62` re-exports; there is no `./predicates` subpath in `package.json` exports). Do **not** make `havePathMatching` variadic unless the tree lands first. The other 13 rules are rescoped by construction in the same commit.

**R1 — bug 0014, alone.** Match import globs against the resolved path **and** non-relative specifiers. Breaks in **two** directions: green→red for bans that now work, and **red→green for the allowlist family** (`onlyImportFrom`/`onlyBeImportedVia` violate when no matcher matches, so extra candidates can only reduce violations). Both go in the note, with a guard test that an allowlist reddening today on an installed package flips deliberately.

**R2a — groundwork. Non-breaking. Gates R3.** Single root (own commit); `GlobNode`/`GlobSite`, exported, + combinator propagation; `PathUniverse`; `glob-diagnosis`; the `resolvers()` glob threading; `doctor`.

- `doctor` is an explicitly-invoked diagnostic that **reports findings and exits non-zero**, so an agent does not read `exit 0` as "nothing to do". It is not a build gate and should not be wired into a pipeline; it ships **experimental/hidden**, because removing a documented command later is its own breaking change.
- It must also cover **rules written inside vitest** — a co-equal documented path (`docs/running-in-tests.md`) — via an exported in-process entry point. Without it R2a fails at its one job for half the users. Named, because it is public API on the release people install in order to measure: `diagnose(rules: RuleBuilderLike[]): DiagnosticFinding[]`, exported from the root, where `DiagnosticFinding` carries `{ origin, glob, kind, position, fault, onDisk? }`.
- It reports **condition-less rules** as well as glob faults. Without that, R3b's gate cannot see proposal 019 at all — see the sequencing note below.
- It reports **identities, never totals**.

**R2b — the docs sweep. Not on R3's critical path.** `tests/docs/scan-markdown.ts` is 95 lines of per-line regex over symbol names, and the invariant it can enforce is **syntactic** (anchored, no `./` segment), never satisfiability — doc examples legitimately reference paths that do not exist here. It needs code-fence awareness and per-API classification, or it reds three legitimate patterns: the deliberate counter-example at `docs/troubleshooting.md:36`, the `base: 'normalized'` cases at `docs/slices.md:71,112,202,217`, and every bare specifier. That is real work of unpredictable size, and it gates nothing but R3's own prose. It also carries the three non-compiling `@example` blocks at `src/core/combinators.ts:12,45,74`, which are type errors rather than glob errors and which no markdown scanner can ever see. Lands with or after R3.

**R3 — the flips.** Two units, deliberately separable:

- **R3a, no external gate:** the severity floor, the `.warn()` throw and its doc sweep, the inline-comment guard, and the `#monorepo-setup` retarget. These fire on the meta-findings that **already ship** — empty selector, empty discovery, empty correspondence side, empty layer, baseline-matched-nothing — all six producers live in this repo and the blast radius is fully measurable here.
- **R3b, gated:** the glob guard and `emptyIsPass`. (Proposal 019 moved to plan 0070.) Only these red on globs the adopting team wrote.

**R3b does not ship until** the adopting codebase has run R2a's pre-flight and its findings have been classified by remedy. **Fallback: R3b slips, and R3a ships without it.** R3b explicitly does not fall back to the dogfood corpus — all 35 of this repo's path-glob sites were written by someone who knew the guard was coming and cannot falsify it. The fallback for a missing gate is a slip, not a weaker gate. Splitting a and b is what stops an indefinite external slip holding open a live false-green hole on findings that ship today.

**The gate must be able to see everything it gates.** Proposal 019 fires on condition-less rules, not on globs, so a `doctor` that reports only glob faults would pass while 019's blast radius was completely wrong — this plan's own question, asked of its own gate, answered "pass". Hence R2a's `doctor` reports condition-less rules too. **Resolved differently in the end:** 019 moved to [plan 0070](./0070-a-rule-must-assert-something.md), whose 0.22.0 completes that reporting for every builder family — so this sentence is spent, and R3b keeps only the glob guard and `emptyIsPass`.

### R3a's Upgrading section, which is not R3b's

R3a ships first and may ship alone, so it cannot borrow R3b's notes. Three sentences of its own:

1. **`.warn()` can now throw** — only for a configuration finding, never for an ordinary violation. So can `.severity('warn')` and `.asSeverity('warn') + .check()`.
2. **Here is the complete list of findings that trigger it:** empty selector, empty discovery, empty correspondence side, empty layer, baseline-matched-nothing. Five, enumerable, all pre-existing.
3. **`.violations()` is the non-throwing surface** if you need to inspect rather than fail.

Plus one hazard that is genuinely new and easy to miss: **in a self-executing rule file, a throwing `.warn()` truncates the rest of the module.** Today `rule1.warn(); rule2.check()` evaluates both, because `.warn()` cannot throw. After R3a a meta-finding in `rule1` aborts module evaluation, the CLI's catch (`src/cli/commands/check.ts:41-50`) folds `rule1`'s finding into the run and the output looks entirely normal — while `rule2` was never registered. Silent coverage loss, shipped by the release whose thesis is that silent coverage loss is the defect. `.check()` already has this hazard; R3a extends it to the surface documented as "logs, does not throw". The `export default [rule1, rule2]` shape is unaffected. R3a states the semantics, and the CLI **reports the truncation rather than absorbing it**.

### R3b's Upgrading section, ordered — and the order is the point

1. _"Before upgrading, run `ts-archunit doctor` on 0.2x and classify what it reports."_
2. _"These findings are true. A rule scoped at a path your tsconfig excludes enforces nothing — that is the defect this release surfaces, not a false positive."_ Without this sentence, the release that fixes the false-green problem gets filed as a false-positive release.
3. The measurement, with its mechanism. On `graphql-code-generator` 109 of 215 files on disk are in the project; on this repo, 430 of 438. The spread is not noise: the 49% is dominated by 44 excluded `tests/` directories under a root tsconfig with `include: ["packages"]`. **The ratio is a property of which tsconfig you load, and the at-risk population is monorepo users pointing rules at a build tsconfig that excludes tests.** Naming that audience is the actionable form; "it depends on the repo" reads as "we don't know".
4. **What to do when you cannot fix it today.** There is deliberately no opt-out, so ADR-008 rule 3's other half applies — say what to do instead. The honest cheap remedy happens to be the correct one: **deleting a rule that matches nothing loses no coverage, because it was never enforcing anything.** Saying it out loud is what stops an agent reaching for `**/**` or `.excluding()`. But it is an **ordered** step, not a standalone sentence, because there are exactly two ways it deletes something live:
   - **If the message names the monorepo cause**, switch to `workspace([...])` and re-run first. Per-package `project()` with a shared rule file is a known false red, and an agent told "deleting loses no coverage" will otherwise delete a rule that is live in a sibling package. Delete only if the glob is still dead under the union.
   - **If the path is meant to exist later** — a tripwire on `src/generated/**` written before generation exists — the rule belongs in the PR that creates the path, not in the bin.

### Gate run 2 — the amended rule, on an unseen codegen monorepo

Population: `dotansimha/graphql-code-generator`, chosen sight-unseen as "an OSS TypeScript monorepo with codegen", loaded from its **root** tsconfig (`include: ["packages"]`). Run 2026-07-25 with the direct-containment version of `spikes/0069-gate-walk.mjs`.

```
.ts files on disk under packages/ (pruned)   215
files in the project                         109
directories on disk                           91
directories absent from the project           47   ->  44 under tests/, 3 other

# NOTE: the 44/3 split is DIRECT containment. It is not a measurement
# against the two shipped categories, which use transitive containment.
```

The three non-test directories are `packages/graphql-cli-codegen-plugin`, `packages/presets/swc-plugin`, and `packages/presets/swc-plugin/src` — the last containing **`lib.rs` and `tests.rs`**, a **Rust crate inside a TypeScript monorepo.**

Applying the registered decision rule — _does any finding's message assert a cause that is wrong for that input?_

| Absent directory            | Is "add it to your tsconfig `include`" right?                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `**/tests/**` (44)          | Plausible — if you intend to lint tests. So is "narrow the rule." Both branches genuinely apply |
| `swc-plugin/src` (Rust) (3) | **No.** It is not TypeScript. Adding it to `include` is nonsense                                |

So the two-branch message was not enough, and the fix was to stop treating `outside-project` as a remedy at all. Draft 4 then deferred it to `no-match`'s cause list, which re-imports two causes the fact refutes. The settled form is the two-category fact table above, with transitive containment.

**Gate verdict: pass, with that amendment — and the verdict is narrow in two ways.** First, `graphql-code-generator` carries no ts-archunit rules, so there were no rule-site findings to classify; what the run classified was absent directories, i.e. the inputs to one fault's enrichment. Asking ADR-008 rule 5's question of the gate itself — _what would it do if the `no-match` cause list were wrong for real inputs?_ — the answer is "pass", so it does not guard that. Second, the run predates transitive containment, so its 44/3 split is **not** a measurement against the shipped categories. The adopting codebase's pre-flight is the only population that produces rule-site findings, and it remains the real gate for R3b.

---

## Test inventory

| Test                                                                                        | Proves                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `notImportFrom('fastify')` and `layeredArchitecture({ restrictedPackages })` → **zero**     | R1 does not break R3 — written **first**                            |
| `notImportFrom('**/legacy/**', '**/old/**')` with only `legacy/` present → **no fault**     | the `any` node quantifier                                           |
| `or(havePathMatching(dead), havePathMatching(live))` → **no fault**                         | `or()` is not concatenation                                         |
| `or(and(dead, live), dead)` → **fault**                                                     | the tree is exact where a merge would be fail-open                  |
| `or(havePathMatching(dead), <predicate declaring no globs>)` → **no fault**                 | `or()` propagates only when every input declares globs              |
| `not(and(live, not(dead)))` → **no fault**; `not(or(live, not(dead)))` → **fault**          | `not()` inverts `op`, not only polarity                             |
| `not(not(havePathMatching(dead)))` → **fault**                                              | double negation restores polarity                                   |
| `satisfy(not(resideInFolder(typo)))` reports an **anchoring** fault, not unsatisfiability   | polarity flip through `not()`                                       |
| `satisfy(dependOn(typo))` reports                                                           | the `Condition` half of the contract                                |
| reflecting over both entry points: construct with a known glob, assert it in `globs()`      | set identity — a `return []` default must fail, for all 13 builders |
| `SmellBuilder.inFolder()` declares `kind: 'file-path'`                                      | `kind` is the matched string, not the method name                   |
| for every `file-path`/`parent-dir` site: a real path yields ≥1 subject, nonsense yields 0   | `kind` is behaviourally correct, not just declared                  |
| `resideInFolder('**/tests/fixtures')` (an ancestor, no file's parent) → **fault**           | the parent-dir universe, not all-ancestors                          |
| a `parent-dir` glob matching a **file** and no parent dir reports `file-not-folder`         | the measured `'**/src/predicates/module**'` case                    |
| every project file's parent is in the parent view                                           | `PathUniverse` as a property, not a pinned count                    |
| **every unsatisfiable-glob fixture contains ≥2 candidate paths**                            | mechanically catches `.some(matcher)` — the trap needs index ≥1     |
| a dir holding `.ts` only **below** it classifies `holds-typescript`                         | transitive containment — the `docs/` case                           |
| a glob matching paths in both categories reports `holds-typescript`                         | the per-glob rule                                                   |
| all 8 synthetic `tsConfigPath` doubles produce no disk-derived fault                        | the input-side `isAbsolute` **and** `existsSync` guard              |
| a mis-declared `base` changes the message and not the verdict                               | `base` cannot cause a false red                                     |
| `ignorePaths('**/nonexistent/**')` no finding; `inFolder('**/nonexistent/**')` fires        | exclusion vs selector on one builder                                |
| `slices().matching('src/features/*')` not reported unanchored                               | `base: 'normalized'`                                                |
| per stamp site × per reachable producer: a meta-finding cannot be downgraded                | the floor is at three sites, and reachability is per-path           |
| `.warn()` throws carrying **only** the meta-finding; the 200 ordinary violations are logged | both clauses of the contract                                        |
| `.severity('warn')` and `.asSeverity('warn') + .check()` inherit the throw                  | the two aliases                                                     |
| an `// arch-ignore` comment cannot suppress a meta-finding carrying a real file path        | the fifth suppression surface, guarded explicitly not by accident   |
| the arch suite is green from a differently-named checkout                                   | bug 0011 fixed by construction                                      |
| `spikes/0069-glob-census.mjs` prints no `DEAD` line on the R-any commit                     | R-any actually closes what it claims                                |

Each verified by sabotage: revert the fix, watch it go red.

---

## Known exposures, stated not hidden

- The `only*` family passes vacuously on subjects with no edges — [bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md); R3's changelog claim is scoped to path globs.
- A hand-written `{ description, test }` predicate declares no globs. It disables the check for any `or()` containing it (by the propagation rule) and `doctor` reports its description. `GlobSite`/`GlobNode` are exported so this is fixable by the author.
- `base` is not verified against a second derivation; the cost of a mis-declaration is a worse message, by design.
- `workspace()` sets `tsConfigPath` to the alphabetically-first member tsconfig (`src/core/project.ts:143`), so the disk walk's root derives from one member. `discoverIdentityRoot` walks up to `.git` and usually recovers; an unusual layout scopes the walk below some members and mislabels their globs. Fail-open.
- Per-package `project()` with a shared glob-bearing rule file gets a false red; `workspace()` is the answer, in the message and the docs.
- `outside-project` names the tsconfig as the cause but cannot quote the offending `exclude` entry.
- Above the walk's 50,000-entry budget, `outside-project` reports "not determined" rather than a category.
- **Contradiction is not detected.** `and(havePathMatching(X), not(havePathMatching(X)))` selects ∅ for every `X` and never faults, because the evaluator treats distinct leaves as independent — which is also the stated limit of the model check. Fail-open, correct direction, but it is the one shape the tree provably cannot see.

_Removed this draft:_ "`PathUniverse` over-approximates directories; the guard is fail-open there." It was not fail-open, it was a false green, and the parent-dir universe deletes it.

## Reviewer findings not adopted

Six rounds of review have produced a large yield, and taking all of it would be its own failure mode. What was declined, and why — so the next round does not re-raise it:

| Finding                                                                                                      | Why not                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `globSite()` factory or discriminant tag, so a stray `op` on a user object cannot route to the node branch | The `DeclaredGlob` split already removes it: the author-facing type has neither `op` nor `children`, and excess-property checking rejects the literal. A runtime factory guards a case the type system has closed |
| An entry budget inside `spikes/0069-gate-walk.mjs`                                                           | The spike runs once against a clone; it is a measurement artifact, not the implementation. The budget belongs in `PathUniverse`, where it is specified with a number and a required test for the degrade path     |
| Move proposal 019 into R3a so its gate can see it                                                            | Fixes the symptom. R2a's `doctor` reports condition-less rules instead, which makes the gate valid rather than routing around it                                                                                  |
| `docs/standard-rules.md:460` as a `.warn()` promise, then as "use `.warn()` for soft limits"                 | Miscited twice. It says "Start with generous limits and tighten over time"                                                                                                                                        |
| Flat-merge `or()` with a stated fail-open residual (round 4)                                                 | The tree is exact for the same ten lines. Model-checked: 0 false reds and 0 misses, versus a merge that misses `or(and(dead, live), dead)`                                                                        |
| Flooring severity in `stampSeverity` alone (round 4)                                                         | Only reaches one of three sites; `.violations()` inlines its own map at `rule-builder.ts:200` and `terminal-builder.ts:102`                                                                                       |
| Prove the evaluator with a hand-written four-row table (round 6)                                             | Superseded rather than declined. A hand table is what produced three consecutive wrong evaluators; 4088 enumerated expressions is the same effort once                                                            |

## Open questions

1. **1.0 gate.** R3 is breaking and path-normalization is a further deferred breaking change, so 1.0 is at minimum R3 → path-norm → two quiet releases.
2. **`doctor`'s life after R3** — keep as a supported command, or retire it? Decided **before R3**, not before R2a: shipping it experimental/hidden is precisely the mechanism that defers the decision.

## Out of scope

- **Bug 0012** — per-element thresholds, different mechanism.
- **Path normalization** — making `'src/*'` _work_ is the deeper fix and is separable.
- **Quoting the offending tsconfig `exclude` entry** in `outside-project` — see above.
