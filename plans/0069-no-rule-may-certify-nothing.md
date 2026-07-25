# Plan 0069 — No rule may certify nothing

**Status:** DRAFT 6 — after `/review-proposal` round 5. **R1 is approved outright. R-any, R2 and R3 are approved conditional on corrections only** — both reviewers state that **no open design decisions remain**. Every round-5 item is settled below.
**Priority:** Highest open item. The defect the tool exists to prevent, committed by the tool.
**Supersedes:** part C of [plan 0067](./0067-empty-selector-safety.md); absorbs [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md); closes [bug 0011](../bugs/0011-dogfood-rules-select-nothing.md).
**Prerequisites:** [bug 0014](../bugs/0014-bare-package-import-globs-match-nothing.md) ships first, alone. The single-root refactor (`spike/0014-rule-census`, +456/−165) is **unmerged** and lands as its own commit with its own test pass.

## Corrections carried into draft 6

Round 5 found three defects **inside draft 5's own fixes**, which is the pattern this plan keeps predicting about itself. Every row was re-derived before being written down.

| Claimed in draft 5                                                     | Derived 2026-07-26                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`not()` flips `polarity` across its subtree" is sufficient            | Only for an unnested `not()`. With a `not` already inside the subtree it produces a **false red** one way and a **miss** the other. `not()` must invert `op` as well — full De Morgan push-down                                    |
| An `any` node may drop children that declare no globs                  | That makes `or()` fail **closed**: `or(havePathMatching(dead), exportSymbolNamed('Foo'))` reds a working rule. Most predicates declare no globs, so this would be commoner than the bug the tree replaced                          |
| R-any's `havePathMatching` move "makes the scope glob the enforcement" | It does not. The selector is `resideInFolder('**/src/predicates/module**')`, which matches **0 directories and 1 file** — before the move and after it. The census still prints `DEAD …:567` on the commit that claims to close it |
| `kind: 'file' \| 'folder'`                                             | Names the intent, not the matched string. `SmellBuilder.inFolder()` matches the **full path** (`src/smells/duplicate-bodies.ts:52`). Renamed to `file-path` / `parent-dir` and derived from the matcher                            |
| Directories are all ancestors; "only 3 hold solely subdirectories"     | **41** ancestors are no file's immediate parent (**36** in-repo), and `resideInFolder` tests the immediate parent only (`src/predicates/identity.ts:96`). All-ancestors is a **false green**, not a fail-open. The 3 was wrong     |
| `onDisk` derived from `path.dirname` of each disk file                 | Direct-parent containment. **36** directories hold TypeScript transitively but not directly — including `docs/`, which would print "contains no TypeScript" above `docs/.vitepress/config.ts`. A false fact                        |
| "Four documented promises change with `.warn()`"                       | **18 by grep, across 12 files — and the grep undercounts by at least 4.** No total is asserted; the sweep is specified instead. `.severity('warn')` / `.asSeverity('warn')` are documented aliases the sentence never mentioned    |
| "8 synthetic doubles across 6 files"                                   | 8 doubles, **7 files**. The 8 and the 2/3/2/1 split are exact                                                                                                                                                                      |
| gcg's 44 `tests/` + 3 Rust map onto the two categories                 | Inferred, not measured — the script was never run against a gcg checkout with the two-category split. Claim withdrawn; this repo carries it                                                                                        |
| `loadSchemaFromGlob` needs its glob threaded, "same as `resolvers()`"  | It **throws** on zero matches (`src/graphql/schema-loader.ts:109-112`). Threading buys nothing. Only `resolvers()` needs the R2 widening                                                                                           |
| "149 directories, 15ms"                                                | 149 verified; 4ms warm. A wall-clock figure is not re-derivable under this plan's own rule. Dropped                                                                                                                                |

Standing rule for this plan: **no count appears in it that was not derived on the stated date, and none that a reader cannot re-derive.** Both scripts are committed under `spikes/`; both were themselves wrong this round and are fixed.

> The census has now had **two** `kind` bugs, and each one reported a vacuous rule as satisfiable. First a single flat universe of files + directories; then `inFolder: 'folder'`, which is false for the only `inFolder` that ships. That is the best evidence in this document that `kind` must be derived from **what string the matcher is applied to**, never from what the API is called.

---

## Problem

A rule that cannot match anything passes. Measured:

| Where                              | What                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| This repo (2026-07-26)             | 13 dogfood rules select nothing outside a checkout named `ts-archunit`; 1 selects nothing everywhere and hides a live violation               |
| This repo's own suite (2026-07-25) | 8 tests assert on rules that select nothing — one **encodes the false green as expected behaviour** (`tests/smells/smell-builder.test.ts:78`) |
| An adopting codebase (2026-07-25)  | 7 rule sites, **2 of them security rules** — JWT verification and internal-route auth, both guarding nothing                                  |

`.expectNonEmpty()` exists for this and is opt-in. The adopting team calls it eight times (2026-07-25), in the same files as their seven vacuous rules. Opt-in does not work.

Derivation status of each row, because two of the three are not yet reproducible:

- **Row 1** — `node spikes/0069-glob-census.mjs`: 35 path-glob sites, 16 import-target sites exempt, **1 matching nothing** (`arch-rules.test.ts:567`). The 13 is a separate one-line grep (`grep -c "ts-archunit/src" tests/archunit/arch-rules.test.ts` → 13), confirmed by rerunning the universe with the checkout renamed: 14 parent directories match here, **0** renamed.
- **Row 2** — dated but **not reproducible by anything committed**. R3 "ships with the 8 vacuous-test fixes in the same commit", so an inaccurate 8 makes that commit incomplete by construction. Given that draft 5's "four documented promises" turned out to be 13, **the 8 must be re-derived before R3 is cut**, and that is a precondition, not a nicety.
- **Row 3** — the adopting codebase, 2026-07-25. Not reproducible here by design.

---

## Mechanism

> **Can this glob match anything in this project?** — a question about the _project_, answerable without running the rule.

### The data model is a tree, and `not()` pushes through it

Draft 3 flattened everything, which destroyed the grouping. Draft 4 specified `or()` as concatenation, which reds `or(dead, live)` — a working rule. Draft 5's tree fixed that and introduced two of its own, both in the same three lines. The settled model:

```ts
interface GlobSite {
  readonly glob: string
  readonly kind: 'file-path' | 'parent-dir' | 'import-target' | 'specifier' | 'literal'
  readonly position: 'selector' | 'discovery' | 'condition' | 'exclusion'
  readonly polarity: 'positive' | 'negative'
  readonly base: 'absolute' | 'tsconfig-relative' | 'normalized'
  /** Where the glob was written, for the message: `resideInFolder("…") in rule "adr005/no-any"`. */
  readonly origin: string
}
interface GlobNode {
  readonly op: 'any' | 'all'
  readonly children: readonly (GlobNode | GlobSite)[]
}
```

Both are **exported** in R2. A user-written predicate that cannot declare globs would otherwise permanently disable the check for any `or()` it appears in, by the propagation rule below.

```
dead(site) = site.polarity === 'positive'
          && (site.kind === 'file-path' || site.kind === 'parent-dir')
          && no path in that kind's universe matches site.glob

dead(node) = node.op === 'all' ? node.children.some(dead)
                               : node.children.every(dead)
```

`and(a, b)` → `all`; `or(a, b)` → `any`; a variadic predicate (`importFrom(...globs)` is `matchers.some`, `src/predicates/module.ts:45`) → `any`; a preset's option list → `any`; repeated `.inFolder()` calls OR together (`folderMatchers.some`) → `any`. `or(and(deadA, liveB), deadC)` evaluates exactly, where a flat merge would miss it.

**`not()` inverts `op` as well as `polarity`** — standard negation-normal-form push-down, not a polarity flip. Draft 5 flipped polarity only, which is right for `not()` over plain leaves and wrong as soon as the subtree already contains a `not()`. Both directions were reachable through public exports, since `and()` returns a `Predicate<T>` and `not()` takes one:

| Expression                  | Truth                                 | Polarity flip alone | With `op` inverted |
| --------------------------- | ------------------------------------- | ------------------- | ------------------ |
| `not(and(live, not(dead)))` | selects the complement of `live` — no | **false red**       | no fault ✓         |
| `not(or(live, not(dead)))`  | selects ∅ — **genuinely dead**        | **missed**          | fault ✓            |

Every row already in the polarity table survives: `not(not(dead))` still faults, `not(and(a, b))` still does not.

**A negative site is never dead.** That single clause is what makes the flip correct without a special case, and it holds for all four op/polarity combinations once `op` inverts too.

**`or()` propagates globs only when every input declares them; `and()` may drop the ones that do not.** Under `all`, `some(dead)` is monotone, so dropping an opaque child is safe. Under `any`, `every(dead)` is not: `or(havePathMatching('**/nope/**'), exportSymbolNamed('Foo'))` would drop the second child, leave one dead child, and red a rule that selects every module exporting `Foo`. Since `globs` is optional and most predicates carry none, that failure would have been commoner than the one the tree was introduced to fix.

### `kind` names the matched string; `position` is stored, not inferred

`kind` is not what the API is called. Derived across every glob-taking selector in `src/`, exactly **one** matches a directory:

| Selector                                                                  | Matched against      | `kind`          |
| ------------------------------------------------------------------------- | -------------------- | --------------- |
| `resideInFolder` (`src/predicates/identity.ts:96`)                        | immediate parent dir | `parent-dir`    |
| `resideInFile`, `havePathMatching`, `assignedFrom`, `slices().matching()` | full absolute path   | `file-path`     |
| `SmellBuilder.inFolder()` (`src/smells/duplicate-bodies.ts:52`)           | full absolute path   | `file-path`     |
| `crossLayer().layer()`                                                    | full absolute path   | `file-path`     |
| `importFrom` and family                                                   | resolved module path | `import-target` |

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

The walk needs an **entry budget with a documented degrade**. The prune list is `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `.next` — and the plan's own gate repository defeats it: `graphql-code-generator` contains a Rust crate, so a contributor who has run `cargo build` has a `target/` of tens of thousands of entries. Same for `.venv`, `vendor`, `.turbo`, `.yarn`, `.gradle`. Lazy evaluation bounds this to already-failing runs, but a failing run that then hangs inside a 5s vitest timeout is worse than the false green. On exceeding the budget the enrichment degrades to "not determined" — it is already fail-open, so the only cost is message quality.

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

`resolvers(p, glob)` filters eagerly in the entry function and hands the builder only `SourceFile[]` — **the glob string is discarded** (`src/graphql/index.ts:82-88`), so no `globs()` can ever report `resolvers(p, 'src/reslvers/**')`. **Decision:** thread it into the builder in R2. It is a constructor widening on one public export and belongs in R2's release note.

`loadSchemaFromGlob` (`src/graphql/schema-loader.ts:104`) does **not** need this. It already throws on zero matches (`:109-112`), which is the outcome this plan wants; threading its glob would buy nothing. Draft 5 called the two cases "the same"; they are opposites.

`crossLayer().layer()` needs no restructuring — `Layer.pattern` already reaches `PairFinalBuilder`; its own JSDoc example (`cross-layer-builder.ts:56`, `'src/routes/**'`) is unsatisfiable and is a good first catch for the docs sweep.

Checked and clear: `TypeMatcher` (regex, no path globs), smell builders (builder-recorded), `TsconfigBuilder` (no globs), `correspondence()` (takes selections).

`globs(): GlobNode[]` on the root is **concrete with a `[]` default**, not abstract — adding an abstract member to `RuleBuilder`/`TerminalBuilder` (both public exports, `src/index.ts:21-22`) is a compile break for subclassers, and R2 is the release people install in order to measure. The set-identity test fails a `return []` stub, and it is driven off the exported builder list rather than hand-written per builder, so an eleventh builder inheriting the default is covered.

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

**And the grep undercounts**, which is the part worth writing down. It misses four promises whose promising line does not contain the token `warn` at all: `docs/violation-reporting.md:46` ("does not throw. The test passes."), `docs/running-in-tests.md:101`, `docs/smell-detection.md:9` ("reports without failing"), and `src/core/execute-rule.ts:202` ("Advisory — … never throws"). So the commit's checklist is the grep **plus** a read of every `### .warn()` section heading. Asserting a total here would repeat the error twice over: draft 5 said four, and round 5's own derived list contained a line (`docs/standard-rules.md:460`) that turns out to be about metric limits, not `.warn()`.

**A fifth suppression surface needs the same guard: inline exclusion comments** (`src/core/execute-rule.ts:113-116`). `isExcludedByComment` has no `bypassFilters` check. Meta-findings are immune today only **by accident** — they carry `file: ''` (`rule-builder.ts:399`), `readFileSync('')` throws into the catch, and `comment.file === ''` can never hold. The moment a meta-finding carries a real path — and R2's `doctor` reporting glob _origins_ is exactly that temptation — an `// arch-ignore` silently suppresses the finding that says the rule enforces nothing. Add the explicit guard at `:114` in the same commit.

**`emptyIsPass`** lands in R3 (it exists only on `spike/0067c`), with `.some()` → `.every()`, and never covers a path fault.

---

## Releases

**R-any — a commit, not a release. Two edits, not one.** Moving `havePathMatching` from `src/predicates/module.ts:97` to `src/predicates/identity.ts` does **not** close `api/no-single-glob-predicates`: its selector is `resideInFolder('**/src/predicates/module**')`, which matches 0 parent directories before the move and 0 after. The selector must also be retyped to a file kind — `resideInFile('**/src/predicates/module.ts')` — and must stay module-specific, since widening to `'**/src/predicates/**'` would red on `identity.ts` once `havePathMatching` lands there. Verify by running the census on the same commit: it must no longer print `DEAD …:567`. The move itself is API-invisible (`src/index.ts:62` re-exports; there is no `./predicates` subpath in `package.json` exports). Do **not** make `havePathMatching` variadic unless the tree lands first. The other 13 rules are rescoped by construction in the same commit.

**R1 — bug 0014, alone.** Match import globs against the resolved path **and** non-relative specifiers. Breaks in **two** directions: green→red for bans that now work, and **red→green for the allowlist family** (`onlyImportFrom`/`onlyBeImportedVia` violate when no matcher matches, so extra candidates can only reduce violations). Both go in the note, with a guard test that an allowlist reddening today on an installed package flips deliberately.

**R2a — groundwork. Non-breaking. Gates R3.** Single root (own commit); `GlobNode`/`GlobSite`, exported, + combinator propagation; `PathUniverse`; `glob-diagnosis`; the `resolvers()` glob threading; `doctor`.

- `doctor` is an explicitly-invoked diagnostic that **reports findings and exits non-zero**, so an agent does not read `exit 0` as "nothing to do". It is not a build gate and should not be wired into a pipeline; it ships **experimental/hidden**, because removing a documented command later is its own breaking change.
- It must also cover **rules written inside vitest** — a co-equal documented path (`docs/running-in-tests.md`) — via an exported in-process entry point. Without it R2a fails at its one job for half the users.
- It reports **identities, never totals**.

**R2b — the docs sweep. Not on R3's critical path.** `tests/docs/scan-markdown.ts` is 95 lines of per-line regex over symbol names, and the invariant it can enforce is **syntactic** (anchored, no `./` segment), never satisfiability — doc examples legitimately reference paths that do not exist here. It needs code-fence awareness and per-API classification, or it reds three legitimate patterns: the deliberate counter-example at `docs/troubleshooting.md:36`, the `base: 'normalized'` cases at `docs/slices.md:71,112,202,217`, and every bare specifier. That is real work of unpredictable size, and it gates nothing but R3's own prose. It also carries the one-line `#monorepo-setup` anchor fix (`docs/standard-rules.md:270`), which R3 makes load-bearing. Lands with or after R3.

**R3 — the flips.** Two units, deliberately separable:

- **R3a, no external gate:** the severity floor, the `.warn()` throw and its 13 doc edits, the inline-comment guard. These fire on the meta-findings that **already ship** — empty selector, empty discovery, empty correspondence side, empty layer, baseline-matched-nothing — all six producers live in this repo and the blast radius is fully measurable here.
- **R3b, gated:** the glob guard, proposal 019, `emptyIsPass`. Only these red on globs the adopting team wrote.

**R3b does not ship until** the adopting codebase has run R2a's pre-flight and its findings have been classified by remedy. **Fallback: R3b slips, and R3a ships without it.** R3b explicitly does not fall back to the dogfood corpus — all 35 of this repo's path-glob sites were written by someone who knew the guard was coming and cannot falsify it. The fallback for a missing gate is a slip, not a weaker gate. Splitting a and b is what stops an indefinite external slip holding open a live false-green hole on findings that ship today.

R3's Upgrading section is ordered, and the order is the point:

1. _"Before upgrading, run `ts-archunit doctor` on 0.2x and classify what it reports."_
2. _"These findings are true. A rule scoped at a path your tsconfig excludes enforces nothing — that is the defect this release surfaces, not a false positive."_ Without this sentence, the release that fixes the false-green problem gets filed as a false-positive release.
3. The measurement, with its mechanism. On `graphql-code-generator` 109 of 215 files on disk are in the project; on this repo, 430 of 438. The spread is not noise: the 49% is dominated by 44 excluded `tests/` directories under a root tsconfig with `include: ["packages"]`. **The ratio is a property of which tsconfig you load, and the at-risk population is monorepo users pointing rules at a build tsconfig that excludes tests.** Naming that audience is the actionable form; "it depends on the repo" reads as "we don't know".
4. **What to do when you cannot fix it today.** There is deliberately no opt-out, so ADR-008 rule 3's other half applies — say what to do instead. The honest cheap remedy happens to be the correct one: **deleting a rule that matches nothing loses no coverage, because it was never enforcing anything.** Saying it out loud is what stops an agent reaching for `**/**`, `.excluding()`, or silent deletion of a rule that _was_ working.

### Gate run 2 — the amended rule, on an unseen codegen monorepo

Population: `dotansimha/graphql-code-generator`, chosen sight-unseen as "an OSS TypeScript monorepo with codegen", loaded from its **root** tsconfig (`include: ["packages"]`). Run 2026-07-25 with the direct-containment version of `spikes/0069-gate-walk.mjs`.

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

So the two-branch message was not enough, and the fix was to stop treating `outside-project` as a remedy at all. Draft 4 then deferred it to `no-match`'s cause list, which re-imports two causes the fact refutes. The settled form is the two-category fact table above, with transitive containment.

**Gate verdict: pass, with that amendment — and the verdict is narrow in two ways.** First, `graphql-code-generator` carries no ts-archunit rules, so there were no rule-site findings to classify; what the run classified was absent directories, i.e. the inputs to one fault's enrichment. Asking ADR-008 rule 5's question of the gate itself — _what would it do if the `no-match` cause list were wrong for real inputs?_ — the answer is "pass", so it does not guard that. Second, the run predates transitive containment, so its 44/3 split is **not** a measurement against the shipped categories. The adopting codebase's pre-flight is the only population that produces rule-site findings, and it remains the real gate for R3b.

---

## Test inventory

| Test                                                                                        | Proves                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `notImportFrom('fastify')` and `layeredArchitecture({ restrictedPackages })` → **zero**     | R1 does not break R3 — written **first**                          |
| `notImportFrom('**/legacy/**', '**/old/**')` with only `legacy/` present → **no fault**     | the `any` node quantifier                                         |
| `or(havePathMatching(dead), havePathMatching(live))` → **no fault**                         | `or()` is not concatenation                                       |
| `or(and(dead, live), dead)` → **fault**                                                     | the tree is exact where a merge would be fail-open                |
| `or(havePathMatching(dead), <predicate declaring no globs>)` → **no fault**                 | `or()` propagates only when every input declares globs            |
| `not(and(live, not(dead)))` → **no fault**; `not(or(live, not(dead)))` → **fault**          | `not()` inverts `op`, not only polarity                           |
| `not(not(havePathMatching(dead)))` → **fault**                                              | double negation restores polarity                                 |
| `satisfy(not(resideInFolder(typo)))` reports an **anchoring** fault, not unsatisfiability   | polarity flip through `not()`                                     |
| `satisfy(dependOn(typo))` reports                                                           | the `Condition` half of the contract                              |
| driven off the exported builder list: construct with a known glob, assert it in `globs()`   | set identity — a `return []` default must fail, for every builder |
| `SmellBuilder.inFolder()` declares `kind: 'file-path'`                                      | `kind` is the matched string, not the method name                 |
| for every `file-path`/`parent-dir` site: a real path yields ≥1 subject, nonsense yields 0   | `kind` is behaviourally correct, not just declared                |
| `resideInFolder('**/tests/fixtures')` (an ancestor, no file's parent) → **fault**           | the parent-dir universe, not all-ancestors                        |
| a `parent-dir` glob matching a **file** and no parent dir reports `file-not-folder`         | the measured `'**/src/predicates/module**'` case                  |
| every project file's parent is in the parent view                                           | `PathUniverse` as a property, not a pinned count                  |
| **every unsatisfiable-glob fixture contains ≥2 candidate paths**                            | mechanically catches `.some(matcher)` — the trap needs index ≥1   |
| a dir holding `.ts` only **below** it classifies `holds-typescript`                         | transitive containment — the `docs/` case                         |
| a glob matching paths in both categories reports `holds-typescript`                         | the per-glob rule                                                 |
| all 8 synthetic `tsConfigPath` doubles produce no disk-derived fault                        | the input-side `isAbsolute` **and** `existsSync` guard            |
| a mis-declared `base` changes the message and not the verdict                               | `base` cannot cause a false red                                   |
| `ignorePaths('**/nonexistent/**')` no finding; `inFolder('**/nonexistent/**')` fires        | exclusion vs selector on one builder                              |
| `slices().matching('src/features/*')` not reported unanchored                               | `base: 'normalized'`                                              |
| per stamp site × per reachable producer: a meta-finding cannot be downgraded                | the floor is at three sites, and reachability is per-path         |
| `.warn()` throws carrying **only** the meta-finding; the 200 ordinary violations are logged | both clauses of the contract                                      |
| `.severity('warn')` and `.asSeverity('warn') + .check()` inherit the throw                  | the two aliases                                                   |
| an `// arch-ignore` comment cannot suppress a meta-finding carrying a real file path        | the fifth suppression surface, guarded explicitly not by accident |
| the arch suite is green from a differently-named checkout                                   | bug 0011 fixed by construction                                    |
| `spikes/0069-glob-census.mjs` prints no `DEAD` line on the R-any commit                     | R-any actually closes what it claims                              |

Each verified by sabotage: revert the fix, watch it go red.

---

## Known exposures, stated not hidden

- The `only*` family passes vacuously on subjects with no edges — [bug 0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md); R3's changelog claim is scoped to path globs.
- A hand-written `{ description, test }` predicate declares no globs. It disables the check for any `or()` containing it (by the propagation rule) and `doctor` reports its description. `GlobSite`/`GlobNode` are exported so this is fixable by the author.
- `base` is not verified against a second derivation; the cost of a mis-declaration is a worse message, by design.
- `workspace()` sets `tsConfigPath` to the alphabetically-first member tsconfig (`src/core/project.ts:143`), so the disk walk's root derives from one member. `discoverIdentityRoot` walks up to `.git` and usually recovers; an unusual layout scopes the walk below some members and mislabels their globs. Fail-open.
- Per-package `project()` with a shared glob-bearing rule file gets a false red; `workspace()` is the answer, in the message and the docs.
- `outside-project` names the tsconfig as the cause but cannot quote the offending `exclude` entry.
- Above the walk's entry budget, `outside-project` reports "not determined" rather than a category.

_Removed this draft:_ "`PathUniverse` over-approximates directories; the guard is fail-open there." It was not fail-open, it was a false green, and the parent-dir universe deletes it.

## Open questions

1. **1.0 gate.** R3 is breaking and path-normalization is a further deferred breaking change, so 1.0 is at minimum R3 → path-norm → two quiet releases.
2. **`doctor`'s life after R3** — keep as a supported command, or retire it? Decided **before R3**, not before R2a: shipping it experimental/hidden is precisely the mechanism that defers the decision.

## Out of scope

- **Bug 0012** — per-element thresholds, different mechanism.
- **Path normalization** — making `'src/*'` _work_ is the deeper fix and is separable.
- **Quoting the offending tsconfig `exclude` entry** in `outside-project` — see above.
