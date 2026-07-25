# Plan 0069 — No rule may certify nothing

**Status:** DRAFT 5 — after `/review-proposal` round 4. **R-any, R1 and R2 are approved.** **R3 is approved by both reviewers, conditional on** three specification items, all settled below: `outside-project` gets its own cause list, `.warn()` is decided in one sentence, and the stale test row is retyped.
**Priority:** Highest open item. The defect the tool exists to prevent, committed by the tool.
**Supersedes:** part C of [plan 0067](./0067-empty-selector-safety.md); absorbs [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md); closes [bug 0011](../bugs/0011-dogfood-rules-select-nothing.md).
**Prerequisites:** [bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md) ships first, alone. The single-root refactor (`spike/0014-rule-census`, +456/−165) is **unmerged** and lands as its own commit with its own test pass.

## Corrections carried into draft 5

Round 4 found two Criticals and five wrong claims. The pattern is now the plan's most reliable finding about itself.

| Claimed in draft 4                                                        | Derived 2026-07-26                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`and()`/`or()` concatenate their inputs' groups"                         | Concatenating `or()` **re-lands the 0.18.1 withdrawal one level up**: `or(deadGlob, liveGlob)` is a working rule and would red. `or` is a public export (`src/core/combinators.ts:81`). The model is a tree |
| "require `path.isAbsolute()` on the derived root"                         | A **no-op**. `discoverIdentityRoot` calls `path.resolve` (`src/helpers/identity-root.ts:34`) and every return path is absolute (`:55`). The check belongs on the **input**, plus an existence check         |
| "Two test doubles use `tsConfigPath: 'in-memory'`"                        | **8 synthetic doubles across 6 files**: 2 × `'in-memory'`, 3 × `'/repo/…'`, 2 × `'/virtual/…'`, 1 × `'/mem/…'`. Six are **absolute paths that do not exist** — `isAbsolute` waves all six through           |
| "`execute-rule.ts:137` is already `?? severity` and safe"                 | `??` resolves the five unset producers to **`warn`** on the `executeWarn` path (`:219`). It is the least safe of the three sites, not the safe one                                                          |
| "`position` is `this._phase`"                                             | `_phase` exists only on `RuleBuilder` (`src/core/rule-builder.ts:30`). **Seven** builders extend `TerminalBuilder` and have none — including the one `diagnoseGlob` lives in today                          |
| "on a real monorepo, roughly half the source may sit outside the project" | n=1. Re-run on this repo: **8 of 438** files outside, 1.8%. Two points, 1.8% and 49% — the ratio is a property of the repository, not of monorepos                                                          |
| The Problem table's counts carried no derivation date                     | 13 and 1 re-derived today by `spikes/0069-glob-census.mjs`; the adopting-codebase figures keep their original 2026-07-25 date and are marked as such                                                        |

And one the plan found in its own instrument, which is the best evidence in it for the `kind` axis:

> The first census I wrote tested every glob against **one flat universe** of files + directories, and reported `resideInFolder('**/src/predicates/module**')` as satisfiable. It is not — `resideInFolder` matches the directory portion, and that glob matches a **file**. Measured: **0 directories, 1 file.** A universe that ignores `kind` hid the exact bug the census existed to find. `spikes/0069-glob-census.mjs` splits by kind and finds it.

Standing rule for this plan: **no count appears in it that was not derived on the stated date**, and — new in draft 5 — **no count appears that a reader cannot re-derive.** Both scripts are committed under `spikes/`.

---

## Problem

A rule that cannot match anything passes. Measured:

| Where                              | What                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| This repo (2026-07-26)             | 13 dogfood rules select nothing outside a checkout named `ts-archunit`; 1 selects nothing everywhere and hides a live violation               |
| This repo's own suite (2026-07-25) | 8 tests assert on rules that select nothing — one **encodes the false green as expected behaviour** (`tests/smells/smell-builder.test.ts:78`) |
| An adopting codebase (2026-07-25)  | 7 rule sites, **2 of them security rules** — JWT verification and internal-route auth, both guarding nothing                                  |

`.expectNonEmpty()` exists for this and is opt-in. The adopting team calls it eight times (2026-07-25), in the same files as their seven vacuous rules. Opt-in does not work.

Re-derivation of row 1, today: `node spikes/0069-glob-census.mjs` reports 35 path-glob sites, 16 import-target sites exempt, **1 matching nothing** — `resideInFolder('**/src/predicates/module**')` at `arch-rules.test.ts:567`. The 13 are checkout-name-dependent rather than dead here: `'**/ts-archunit/src/**'` matches 14 directories in this checkout and **0** with the checkout renamed.

---

## Mechanism

> **Can this glob match anything in this project?** — a question about the _project_, answerable without running the rule.

### The data model is a tree, because the quantifier nests

Draft 3 flattened everything into one array, which destroyed the grouping. Draft 4 introduced a two-level `GlobGroup` and specified `or()` as concatenation, which is wrong in the opposite direction: `or(a, b)` is dead only when **both** are dead, so concatenating produces two groups, the dead one faults, and a working rule reds. That is the failure the group model was introduced to prevent.

A tree gets both right, and makes `op` load-bearing instead of decorative:

```ts
interface GlobSite {
  readonly glob: string
  readonly kind: 'file' | 'folder' | 'import-target' | 'specifier' | 'literal'
  readonly polarity: 'positive' | 'negative'
  readonly base: 'absolute' | 'tsconfig-relative' | 'normalized'
  readonly origin: string
}
interface GlobNode {
  readonly op: 'any' | 'all'
  readonly children: readonly (GlobNode | GlobSite)[]
}
```

```
dead(site) = site.polarity === 'positive'
          && (site.kind === 'file' || site.kind === 'folder')
          && no path in the universe matches site.glob

dead(node) = node.op === 'all' ? node.children.some(dead)
                               : node.children.every(dead)
```

- `and(a, b)` → `{ op: 'all' }` — dead if either input is dead.
- `or(a, b)` → `{ op: 'any' }` — dead only if both are.
- A variadic predicate (`importFrom(...globs)` is `matchers.some`, `src/predicates/module.ts:45`) → `{ op: 'any' }`.
- A preset's option list → `{ op: 'any' }`, by the same rule rather than by prose.

`or(and(deadA, liveB), deadC)` evaluates **exactly** — the `all` node is dead, `deadC` is dead, so the `any` node is dead. A flat merge would miss it. The tree costs ten lines of recursion and buys away the fail-open.

**A negative site is never dead.** That single clause is what makes `not()` correct without a special case: `not()` flips polarity across its subtree, so `not(and(a, b))` has two negative children, neither dead, so the `all` node is not dead — which is right, because negating an empty conjunction over-selects. Double negation flips back to positive and faults again.

`not()` returns a fresh object (`src/core/combinators.ts:23-26`), so the flip is a recursive map over `globs`, no mutation and no `as`. The `TypeMatcher` overload carries no globs and is untouched.

### `position` is derived — from two places, not one

Draft 4 claimed `position` is `this._phase`. `_phase` is declared once, on `RuleBuilder` (`src/core/rule-builder.ts:30`), and **seven** builders extend `TerminalBuilder` instead and have none: `CorrespondenceBuilder`, `PairFinalBuilder`, `SliceRuleBuilder`, `SmellBuilder`, `TsconfigBuilder`, `SchemaRuleBuilder`, `ResolverRuleBuilder`.

So `position` has two derivations, both structural, neither a hand-written label on a data literal:

| Builder family               | `position` comes from                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `RuleBuilder<T>` subclasses  | `this._phase` at record time — `'predicate'` → `selector`, `'condition'` → `condition`          |
| `TerminalBuilder` subclasses | **the recording method** — `slices().assignedFrom()` and `crossLayer().layer()` are `discovery` |
| any builder                  | `.excluding()` / `ignorePaths()` record `exclusion`, again by method identity                   |

That is the honest claim: not one derivation, two, and both are "where the code is" rather than "what someone typed".

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

### `kind` gates which universe applies; `base` shapes only the message

Measured 2026-07-26: `getSourceFiles()` returns 430 files here, **0 under `node_modules/`**. So an import-target glob like `**/node_modules/typescript/**` — which our own arch rule at `arch-rules.test.ts:98` uses correctly — is unsatisfiable against the path universe **by construction**, and checking it would fail every correct dependency rule in existence. Only `file` and `folder` are checked.

`base` is demoted. Draft 4 let it select which view a site is matched against, which makes a mis-declared `base` produce a false red **by construction** — the worst failure mode of any axis, on the one axis that has no second derivation. Instead: the verdict is "unsatisfiable against the **union** of all views", and `base` only chooses the wording of the message. A mis-declaration now costs a worse sentence, never a red build. The residual is a small fail-open — a glob labelled `absolute` that happens to match the tsconfig-relative view is not reported — which is the direction a breaking change should lean.

### `PathUniverse`

Free function, `WeakMap<ArchProject, …>`, plain strings — not a method on `ArchProject`, whose bare-object test doubles are real (`tests/builders/slice-rule-builder.test.ts:384`). Lives in `src/core/`, consumes `ArchProject`, imports no ts-morph: ADR-007's batch-first shape by construction.

Three views are computed eagerly from `getSourceFiles()` — absolute file paths, absolute ancestor directories, their tsconfig-relative forms — because they are one pass over a list already in memory. **The disk set is a memoized lazy view in the same entry, computed on first fault only.** Draft 4 specified it eagerly and claimed it was "never a trigger"; those contradict, and the eager form charges every `check()` a recursive filesystem walk to answer a question no fault asked.

ADR-007 note: materializing the file list is 430 `getFilePath()` crossings. Caching them once is the right mitigation, but the engine-side consequence should be named now — the future `Engine` needs one coarse `filePaths(): readonly string[]`, or the loop merely relocates.

Directories are **all ancestors**. Measured: 430 files, 122 ancestors. Spike 1 narrowed the practical impact — only 3 directories hold solely subdirectories, and the common `**/x/**` spelling matched identically against either set — but all-ancestors remains correct for exact-directory globs with no trailing `/**`. The universe over-approximates, so the guard is **fail-open** on that axis.

### `outside-project`, specified

Not a fault and not a trigger. It is a **classification of an already-firing `no-match`**, which is what makes it safe on in-memory projects.

- **Disk root:** reuse `discoverIdentityRoot` (`src/helpers/identity-root.ts`), which already answers "where is the root" nearest-first with a written rationale. Do not invent a second answer.
- **Guard:** `path.isAbsolute(project.tsConfigPath) && fs.existsSync(root)`, checked on the **input**, before calling `discoverIdentityRoot`. Draft 4 put it on the derived root, where it can never fail. Both halves are load-bearing, and the second is the one that matters: of the **8** synthetic `tsConfigPath` doubles in the suite, 2 are the relative `'in-memory'` (whose `path.dirname` is `'.'`, walking the real CWD) and **6 are absolute paths that do not exist** — `/repo` (×3), `/virtual` (×2), `/mem` (×1). Without `existsSync`, `readdirSync` throws ENOENT from inside a guard.
- **Pruning is mandatory, and is policy:** `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next`. Draft 4 pruned the first two only, leaving build output to be walked and then reported as "absent from the project", which is noise rather than a finding. Measured on this repo today: 149 directories, 15ms.

**The message states a fact and asserts no remedy — and it has its own cause list, not `no-match`'s.** Draft 4 deferred to `no-match`, whose list is _"append `/**`, a segment is misspelled, or the directory holds no source files"_ (`src/builders/slice-rule-builder.ts:74`). Run that against the gate's own findings and two of the three causes are refuted by the fact printed one line above: the path is not misspelled, it exists; and it is already `/**`-shaped. Importing three hypotheses the fact just disproved is ADR-008 rule 2 in substance even if not in letter.

The walk already knows enough to split it, with no tsconfig parsing:

| Disk evidence                               | What `outside-project` states                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| the path exists and **holds TypeScript**    | "exists and contains TypeScript, but your tsconfig's `include`/`exclude` keeps it out of the project" |
| the path exists and **holds no TypeScript** | "exists but contains no TypeScript"                                                                   |

Both are verifiable, neither asserts a remedy, and both categories are populated in both gate runs — `**/tests/**` (44) and `swc-plugin/src` (Rust, 3) on graphql-code-generator; `docs/.vitepress` and `examples` (2) versus `adr/`, `plans/`, `.github/` and 28 more (31) on this repo. The Rust crate lands in "contains no TypeScript", which is true and useful, and is the input that killed draft 4's remedy branch.

This is also a genuine second derivation — filesystem contents versus compiler membership — so it satisfies ADR-008 rule 5 without reading a config file. **Explicitly out of scope:** quoting the offending `exclude` entry back to the user. It would be better, and it requires resolving `extends` chains; ts-morph does not expose `include`/`exclude`, which are not compiler options.

### `glob-diagnosis`, promoted

`diagnoseGlob` + `FAULT_ADVICE` (`src/builders/slice-rule-builder.ts:40-75`) moves to `src/core/glob-diagnosis.ts`, and `outside-project` leaves the fault union:

```ts
type GlobFault = 'dot-segment' | 'unanchored' | 'file-not-folder' | 'no-match'
interface GlobDiagnosis {
  readonly fault: GlobFault
  readonly onDisk: 'holds-typescript' | 'no-typescript' | 'absent'
}
```

`dot-segment` and `unanchored` are verifiable transformations, both exempt for `specifier`/`import-target`/`literal` — after R1, `notImportFrom('fastify')` is a **working rule** and `isAnchored('fastify')` is `false`. `file-not-folder` is verifiable and now has a measured instance: `resideInFolder('**/src/predicates/module**')` matches **0 directories and 1 file**. `no-match` lists causes and asserts none.

`base: 'normalized'` for `slices().matching()`, whose `parseMatchingGlob` (`src/models/slice.ts:73`) already strips and re-adds `**/`.

### Globs that escape the contract

`resolvers(p, glob)` filters eagerly in the entry function and hands the builder only `SourceFile[]` — **the glob string is discarded** (`src/graphql/index.ts:82-88`), so no `globs()` can ever report `resolvers(p, 'src/reslvers/**')`. Same for `loadSchemaFromGlob` (`src/graphql/schema-loader.ts:104`). Both are `tsconfig-relative`.

**Decision:** thread the glob into the builder in R2. It is a constructor widening on two public exports, so it belongs in R2's release note. `crossLayer().layer()` needs no restructuring — `Layer.pattern` already reaches `PairFinalBuilder`; its own JSDoc example (`cross-layer-builder.ts:56`, `'src/routes/**'`) is unsatisfiable and is a good first catch for the R2 docs sweep.

Checked and clear: `TypeMatcher` (regex, no path globs), smell builders (builder-recorded), `TsconfigBuilder` (no globs), `correspondence()` (takes selections).

### Where the nodes come from

```ts
interface Predicate<T> { …; globs?: GlobNode }
interface Condition<T> { …; globs?: GlobNode }
```

`globs(): GlobNode[]` on the root is **concrete with a `[]` default**, not abstract — adding an abstract member to `RuleBuilder`/`TerminalBuilder` (both public exports, `src/index.ts:21-22`) is a compile break for subclassers, and R2 is the release people install in order to measure. The vacuity risk that motivated `abstract` is covered by the set-identity test below, which fails a `return []` stub. Non-breaking _and_ guarded.

---

## Decisions

**Semantic emptiness does not flip**, so **no `.allowEmpty()` is added** and the `CorrespondenceBuilder.allowEmpty(sideName)` collision dissolves.

**Monorepo shared rule file → option (a)**, chosen by both reviewers. `workspace()` is the supported path for glob-bearing rules; per-package `project()` with a shared rule file gets a false red. The obstacle draft 3 claimed does not exist: the per-package recommendation in `docs/config-rules.md:66` and `setup-best-practices.md:83` is scoped to `tsconfig()`, which takes no globs. Option (b) needs cross-`check()` state and would make a rule's colour depend on which other rules ran; option (c) reopens `.allowEmpty()`, which ADR-008 rule 3's corollary bars — an opt-out is the first thing an agent adds on the first red, including the real typo.

Condition: the selector-empty message carries the shape as a **cause, not an asserted remedy** — _"if this rule file is shared across packages loaded separately, use `workspace([...])` so the path universe is the union."_ No cross-project state; a single `check()` knows its own root and file set.

**Meta-findings are floored at `error` — at three sites, not two.** Six `bypassFilters` producers (`rule-builder.ts:407`, `slice-rule-builder.ts:258`, `correspondence-builder.ts:301`, `cross-layer.ts:52`, `presets/shared.ts:66`, `baseline.ts:329`); five set no severity. The stamp sites:

| Site                                  | Today                    | Reaches                                                  |
| ------------------------------------- | ------------------------ | -------------------------------------------------------- |
| `rule-builder.ts:200`                 | overwrites with `sev`    | `.violations()`                                          |
| `terminal-builder.ts:102`             | overwrites with `sev`    | `.violations()`                                          |
| `execute-rule.ts:138` `stampSeverity` | `v.severity ?? severity` | `executeCheck` (`'error'`), **`executeWarn` (`'warn'`)** |

Draft 4 called the third safe. It is the one that silently resolves five unset producers to `warn`. The floor is `v.bypassFilters === true ? 'error' : <the site's existing expression>`, applied at all three, with a test per site. Reachability differs per producer and the tests must respect it: `presets/shared.ts:66` returns a bare `{ violations }` object and reaches no stamp site at all, and `baseline.ts:329` is produced inside `filterNew`, which runs on the `executeCheck`/`executeWarn` path only — never on `.violations()`.

**The `.warn()` contract, in one sentence:** **`.warn()` throws when a rule produces a `bypassFilters` meta-finding, and does not throw for anything else.**

This is a real break and gets its own Upgrading paragraph. It is also the only answer consistent with what already ships. `bypassFilters` means "this finding reports that the rule enforces nothing", and three of the four filters already refuse to suppress it: `.excluding()` refuses it explicitly and warns the caller why (`src/core/execute-rule.ts:50-61`), baseline honours it, diff honours it. `.warn()` was the last one that did not, and leaving it would put a false green on the documented gradual-adoption path — the same audience R2's in-process `doctor` entry point exists to serve. Draft 4's partition covered the CLI and `checkAll` and left exactly that hole open while reading as though it had closed it.

Four documented promises change with it and must be edited in the same commit, not left to drift: `docs/core-concepts.md:230` ("test passes, advisory only"), `docs/running-in-tests.md:66` ("logs, does not throw"), and `docs/smell-detection.md:18,54`. Each gains the one exception; none of them stops being true for ordinary violations.

**`emptyIsPass`** lands in R3 (it exists only on `spike/0067c`), with `.some()` → `.every()`, and never covers a path fault.

---

## Releases

**R-any — a commit, not a release.** Our 14 rules, rescoped by construction. Includes moving `havePathMatching` from `src/predicates/module.ts:97` to `src/predicates/identity.ts`: the dogfood rule is scoped `'**/src/predicates/module**'` and its own comment already carves out identity predicates, so moving the function makes the scope glob the enforcement — exclusion by construction, no public API change (`src/index.ts:62` re-exports, and there is no `./predicates` subpath in `package.json` exports). Do **not** make it variadic unless the tree model lands first.

**R1 — bug 0014, alone.** Match import globs against the resolved path **and** non-relative specifiers. Breaks in **two** directions: green→red for bans that now work, and **red→green for the allowlist family** (`onlyImportFrom`/`onlyBeImportedVia` violate when no matcher matches, so extra candidates can only reduce violations). Both go in the note, with a guard test that an allowlist reddening today on an installed package flips deliberately.

**R2 — groundwork. Non-breaking.** Single root (own commit); `GlobNode`/`GlobSite` + combinator propagation; `PathUniverse`; `glob-diagnosis`; the graphql glob threading; `doctor`; the docs sweep.

- `doctor` reports, never fails, and **exits non-zero on findings** (an explicitly-invoked diagnostic, not a build gate). Shipped **experimental/hidden**, because removing a documented command later is its own breaking change.
- It must also cover **rules written inside vitest** — a co-equal documented path (`docs/running-in-tests.md`). An exported in-process reporting entry point, so that audience can pre-measure too. Without it R2 fails at its one job for half the users.
- It reports **identities, never totals** — including the set of predicate descriptions that declared no globs, not a count of them.
- **The docs invariant is syntactic, not satisfiability.** Doc examples legitimately reference paths that do not exist here. The scanner can enforce _anchored_ and _no `./` segment_; it cannot enforce satisfiability. It also needs **code-fence awareness and per-API classification** — `tests/docs/scan-markdown.ts` is 95 lines of per-line regex over symbol names, and without fence parsing it reds three legitimate patterns: the deliberate counter-example at `docs/troubleshooting.md:36`, the `base: 'normalized'` cases at `docs/slices.md:71,112,202,217`, and every bare specifier. Size this as real work.

**R3 — every flip together.** The glob guard, proposal 019, the severity floor + the `.warn()` throw, `emptyIsPass`. One Upgrading section. Ships with the 8 vacuous-test fixes in the same commit.

**R3's Upgrading section leads with the pre-flight**, then says the reds are true, then gives the measurement attributed to the repo it came from:

1. _"Before upgrading, run `ts-archunit doctor` on 0.2x and classify what it reports."_
2. _"These findings are true. A rule scoped at a path your tsconfig excludes enforces nothing — that is the defect this release surfaces, not a false positive."_ Without this sentence, the release that fixes the false-green problem gets filed as a false-positive release.
3. The measurement, attributed: on `graphql-code-generator` 109 of 215 files on disk are in the project; on this repo, 430 of 438. The ratio is a property of the repository. Do not lead with it.

**R3 does not ship until** the adopting codebase has run R2's pre-flight and its findings have been classified by remedy. **Fallback, if that has not happened by the R3 cut: R3 slips.** It does not ship on the dogfood corpus instead — every one of this repo's 35 path-glob sites was written by someone who knew the guard was coming, so they cannot falsify it. The fallback for a missing gate is a slip, not a weaker gate.

### Gate run 2 — the amended rule, on an unseen codegen monorepo

Population: `dotansimha/graphql-code-generator`, chosen sight-unseen as "an OSS TypeScript monorepo with codegen", loaded from its **root** tsconfig (`include: ["packages"]`). Run 2026-07-25, reproducible with `node spikes/0069-gate-walk.mjs <path>/tsconfig.json`.

```
.ts files on disk under packages/ (pruned)   215
files in the project                         109
directories on disk                           91
directories absent from the project           47   ->  44 under tests/, 3 other
```

The three non-test directories are `packages/graphql-cli-codegen-plugin`, `packages/presets/swc-plugin`, and `packages/presets/swc-plugin/src` — the last containing **`lib.rs` and `tests.rs`**, a **Rust crate inside a TypeScript monorepo.**

Applying the registered decision rule — _does any finding's message assert a cause that is wrong for that input?_

| Absent directory            | Is "add it to your tsconfig `include`" right?                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `**/tests/**` (44)          | Plausible — if you intend to lint tests. So is "narrow the rule." Both branches genuinely apply |
| `swc-plugin/src` (Rust) (3) | **No.** It is not TypeScript. Adding it to `include` is nonsense                                |

**So the two-branch message from draft 3 is not enough**, and the fix is to stop treating `outside-project` as a remedy at all. Draft 4 then deferred it to `no-match`'s cause list, which round 4 showed re-imports two causes the fact refutes. The settled form is the two-category fact table above: **its own cause list, no remedy, both categories derived from the walk.**

**Gate verdict: pass, with that amendment — and the verdict is narrow.** `graphql-code-generator` carries no ts-archunit rules, so there were no rule-site findings to classify; what the run classified was absent directories, i.e. the inputs to one fault's enrichment. The gate therefore **falsified `outside-project`'s remedy branch** and is **silent on `no-match`, `unanchored`, `dot-segment` and `file-not-folder`**. Asking ADR-008 rule 5's question of the gate itself — _what would it do if the `no-match` cause list were wrong for real inputs?_ — the answer is "pass", so it does not guard that. The adopting codebase's pre-flight is the only population that produces rule-site findings, and it remains the real R3 gate.

---

## Test inventory

| Test                                                                                                        | Proves                                                          |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `notImportFrom('fastify')` and `layeredArchitecture({ restrictedPackages })` → **zero**                     | R1 does not break R3 — written **first**                        |
| `notImportFrom('**/legacy/**', '**/old/**')` with only `legacy/` present → **no fault**                     | the `any` node quantifier                                       |
| `or(havePathMatching(dead), havePathMatching(live))` → **no fault**                                         | `or()` is not concatenation                                     |
| `or(and(dead, live), dead)` → **fault**                                                                     | the tree is exact where a merge would be fail-open              |
| `satisfy(not(resideInFolder(typo)))` reports an **anchoring** fault, not unsatisfiability                   | polarity flip through `not()`                                   |
| `not(not(havePathMatching(dead)))` → **fault**                                                              | double negation restores polarity                               |
| `satisfy(dependOn(typo))` reports                                                                           | the `Condition` half of the contract                            |
| per builder: construct with a known glob, assert **that exact string** in `globs()`                         | set identity — a `return []` default must fail                  |
| for every `file`/`folder` site: a real path yields ≥1 subject, nonsense yields 0                            | `kind` is behaviourally correct, not just declared              |
| a `folder` glob matching a **file** and no directory reports `file-not-folder`                              | the measured `'**/src/predicates/module**'` case                |
| **every unsatisfiable-glob fixture contains ≥2 candidate paths**                                            | mechanically catches `.some(matcher)` — the trap needs index ≥1 |
| `outside-project` on a dir holding `.ts` and on one holding none → **different facts, no remedy in either** | the two-category cause list                                     |
| all 8 synthetic `tsConfigPath` doubles produce no disk-derived fault                                        | the input-side `isAbsolute` **and** `existsSync` guard          |
| a mis-declared `base` changes the message and not the verdict                                               | `base` cannot cause a false red                                 |
| `ignorePaths('**/nonexistent/**')` no finding; `inFolder('**/nonexistent/**')` fires                        | exclusion vs selector on one builder                            |
| `slices().matching('src/features/*')` not reported unanchored                                               | `base: 'normalized'`                                            |
| per stamp site × per reachable producer: `.asSeverity('warn')` cannot downgrade a meta-finding              | the floor is at three sites, and reachability is per-path       |
| `.warn()` throws on a `bypassFilters` finding and does not throw on an ordinary violation                   | the stated contract, both halves                                |
| the arch suite is green from a differently-named checkout                                                   | bug 0011 fixed by construction                                  |

Each verified by sabotage: revert the fix, watch it go red.

---

## Known exposures, stated not hidden

- The `only*` family passes vacuously on subjects with no edges — [bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md); R3's changelog claim is scoped to path globs.
- A hand-written `{ description, test }` predicate declares no globs; `doctor` reports their descriptions.
- `PathUniverse` over-approximates directories; the guard is fail-open there.
- `base` is not verified against a second derivation; the cost of a mis-declaration is a worse message, by design.
- Per-package `project()` with a shared glob-bearing rule file gets a false red; `workspace()` is the answer, in the message and the docs.
- `outside-project` names the tsconfig as the cause but cannot quote the offending `exclude` entry.

## Open questions

1. **1.0 gate.** R3 is breaking and path-normalization is a further deferred breaking change, so 1.0 is at minimum R3 → path-norm → two quiet releases.
2. **`doctor`'s life after R3** — keep as a supported command, or retire it? Decided **before R3**, not before R2: shipping it experimental/hidden in R2 is precisely the mechanism that defers the decision.

## Out of scope

- **Bug 0012** — per-element thresholds, different mechanism.
- **Path normalization** — making `'src/*'` _work_ is the deeper fix and is separable.
- **Quoting the offending tsconfig `exclude` entry** in `outside-project` — see above.
- **`docs/standard-rules.md:270`** links to a `#monorepo-setup` anchor that does not exist in `getting-started.md`. Unrelated, but on the path users will follow once `workspace()` becomes a correctness requirement.
