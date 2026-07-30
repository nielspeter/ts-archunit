# ts-archunit Roadmap

**Version:** 0.26.0 · **Tests:** 2478 across 176 files · **Updated:** 2026-07-30
**Spec:** `../ts-archunit-spec.md` · **Direction:** `ai-era-product-direction.md`
**Plans:** 60 completed (`completed/`) · 5 open (below) · proposals in `../proposals/` ·
open defects in `../bugs/`

> Conventions: a plan is **READY** when its design is settled and it can be built as
> written; **PROPOSED** when the design is reviewed but nobody has decided to build
> it; **PARTIAL** when some phases shipped and the rest were deliberately deferred.

---

## Open work

| Plan                                                                                                    | State                                                                                                                                                                                                    | Effort   | Blocked on                                                                                               |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| [0071](./0071-one-definition-of-a-module-edge.md) — Forward dependency conditions see every module edge | **DRAFT 3, implementation-ready.** Split in two: 0.27.0 ships migration instruments, 0.28.0 the widening — an adopter's pre-upgrade measurement must be trustworthy before the thing it measures changes | ~2 days  | nothing — closes bug 0022                                                                                |
| [0069](./0069-no-rule-may-certify-nothing.md) — No rule may certify nothing                             | **R-any/R1/R2a/R3a SHIPPED** (v0.20.0). Prerequisites now both satisfied. R3b **gained a fault** on 2026-07-30 — a satisfiable glob that matched no edge, handed over from bug 0015 / plan 0071          | ~2 days  | R2b unblocked; R3b = the glob guard + `emptyIsPass` + the new fault, still gated on an adopting codebase |
| 0067 — Empty-selector safety (**part C only**)                                                          | **PARTIAL**                                                                                                                                                                                              | ~1 day   | a version decision (breaking re-cut)                                                                     |
| 0047 — TypeScript escape-hatch matchers                                                                 | **PROPOSED**                                                                                                                                                                                             | ~1 day   | go/no-go — trimmed scope already agreed                                                                  |
| 0048 — `usingTagged()` symbol-tagged matcher                                                            | **PROPOSED**                                                                                                                                                                                             | ~1.5 day | go/no-go — deferred until demand                                                                         |

All three need a decision, not implementation. 0063 shipped 2026-07-25.

**0067 part C** is the remaining slice of proposal 014: path-glob auto-fail on every
builder plus path normalization. It is the broadest breaking change left, which is
why it is parked on a version decision rather than an implementation question.

**0047 / 0048** were reviewed 2026-07-13 and given a go/no-go on 2026-07-14: 0047
ship **trimmed** (`doubleCast` + `anyAnnotation`; defer `broadType`/`tsDirective`),
0048 **defer until demand** (overlaps `@typescript-eslint/no-deprecated`; the symbol
layer is speculative). Both remain PROPOSED — the open question is whether each earns
API surface, not how to build it.

## Open defects

Measured and reproduced. Full write-ups in `../bugs/`; fixed ones move to
`../bugs/fixed/`, so this table lists only what is still open.

A `**Fixed:**` date is the convention going forward, not a property of the
directory: 6 of the 16 files in `bugs/fixed/` carry one (0001-0009 predate it).
Nothing enforces it, which by this project's own standard makes it a stated
invariant without a guard — so the location, not the header, is what this table
relies on.

| Bug                                                                                                                                                   | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0012](../bugs/0012-metric-findings-have-no-usable-ratchet.md) — improving a metric goes red                                                          | **Open**, and wider than first filed: eight sites, not one. Needs a per-element threshold ratchet, which is a design decision rather than a fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [0015](../bugs/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md) — `only*` conditions pass on ∅                                       | **Open — option 1 REFUTED, option 2 is the remedy.** Failing on an edgeless subject has no statable remedy, and the rule-level version fails three ways (12 of 13 rules `strictBoundaries` generates for one dependency-free file; a pure-entity innermost layer; and worst, a layer whose only edge is `import type` under the `ignoreTypeImports` the docs recommend). Evidence now lives **in the bug file**, not in a plan that moves to `completed/`. Remaining work: report the edgeless-subject count on the reporting surface. A never-exercised _denylist_ glob is a different fault and belongs to 0069 R3b.                                                                                                         |
| [0019](../bugs/fixed/0019-a-rule-with-no-condition-passes-in-total-silence.md) — a rule with no condition passes silently                             | **FIXED in v0.23.0** via [plan 0070](./completed/0070-a-rule-must-assert-something.md). 0.22.0 completed the instrument — `doctor`/`diagnose()` report every such rule with the remedy for its own shape; 0.23.0 made it an unsuppressable configuration finding on every terminal, which closes this.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [0020](../bugs/fixed/0020-should-twice-silently-drops-the-first-assertion.md) — `should()` twice drops the first assertion                            | **FIXED in v0.23.0** via [plan 0070](./completed/0070-a-rule-must-assert-something.md): conditions accumulate instead of clearing, with a `HASH_VERSION` bump so a stale baseline reports the right cause.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [0017](../bugs/fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md) — `no-cross-boundary`'s remedy cannot remediate | **FIXED in v0.25.0.** The `no-cross-boundary` remedy said "import from the other boundary's entry point instead", which reproduces the identical violation — measured. Three strings corrected, the `suggestion` computed because no fixed text is right when `shared` is empty. Baseline-free (an old-text baseline replays with 0 new findings), which also corrected a docstring claiming otherwise. `explain --format agent` no longer repeats one bullet per boundary.                                                                                                                                                                                                                                                    |
| [0022](../bugs/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md) — forward import conditions miss two edge kinds          | **Open — designed, see [plan 0071](./0071-one-definition-of-a-module-edge.md).** Its suggested fix is **withdrawn**: the reverse graph is the weaker half and porting its collectors forward would reintroduce bug 0014 in the new edge kinds (4 of 7 edges lost, measured). The extraction runs forward-out from `importCandidates`.                                                                                                                                                                                                                                                                                                                                                                                          |
| [0023](../bugs/fixed/0023-strictboundaries-shared-globs-are-raw-and-unguarded.md) — `shared` globs raw and unguarded                                  | **FIXED in v0.25.0.** A `shared` glob matching no file is now a configuration finding, the treatment `folders` has had since plan 0067 — the relative and dead spellings were indistinguishable from outside (same violation count, same silence). The report's normalization half was **withdrawn**: `atPath` is about file-vs-folder, not relative-vs-absolute, and `folders` is not normalized either, so rewriting `shared` globs would have made one option accept a spelling the other rejects.                                                                                                                                                                                                                          |
| [0028](../bugs/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — two findings can share a baseline identity                           | **Open.** `hashViolation` is `rule::element::message` and a dependency message carries neither the line nor the imported names, so a file that imports one module for a type and a value produces two byte-identical findings — measured, **8 colliding pairs of 47 (17%)** in this repo. You cannot accept one without the other, and if one is fixed the survivor keeps matching the stale entry. `ArchViolation.identity` exists for exactly this and needs no message change. Found while verifying [plan 0071](./0071-one-definition-of-a-module-edge.md), which must **not** claim to fix it.                                                                                                                            |
| [0029](../bugs/0029-a-throwing-warn-truncates-the-rest-of-the-rule-file.md) — a throwing `.warn()` truncates the rest of the rule file                | **Open — silent coverage loss, shipped.** In a self-executing rule file, R3a's warn-throw for a configuration finding aborts the module, so every rule declared after it is never registered. Measured at v0.26.0: rule 1 warns on a dead `.expectNonEmpty()` selector, rule 2 has **four real violations, and all four are absent** from both the terminal and `--format json`; a `.violations()` control reports all four. The run is red for the _other_ finding, so nobody investigates. Plan 0069's R3a specified the remedy — "the CLI reports the truncation rather than absorbing it" — and shipped without it. A second, lesser defect in the same path: the thrown finding prints **twice**, both labelled "1 of 1". |
| [0024](../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md) — `.warn()` in a test reports nothing                                   | **FIXED in v0.26.0.** One `writeStderr` channel, ten call sites across five files — the scope was wider than the report: the stale-exclusion, `expression()`, diff-aware and invalid-baseline warnings were all invisible in a passing test too. Guarded by a real child `vitest run` in both directions, because a spy proves the call and never the delivery. Also closed a live EPIPE defect in `writeReport`. 57 tests moved off `console.warn` spies.                                                                                                                                                                                                                                                                     |
| [0025](../bugs/fixed/0025-a-non-archruleerror-from-one-rule-file-drops-every-other-finding.md) — one bad rule file drops every finding in the run     | **FIXED in v0.24.0.** Both halves: the CLI now catches at the two boundaries that fail independently (loading per file, evaluating per builder, so one malformed rule does not take its siblings down), and `CorrespondenceBuilder.assertsSomething()` returns false for wrong arity regardless of the assertion chosen — `.beComplete()` on one side cannot assert anything. Fixing it surfaced three output defects, all fixed: the rich formatter never printed a located violation's `message`, `--format github` doubled a period, and the finding named its path four times.                                                                                                                                             |
| [0026](../bugs/fixed/0026-a-location-less-finding-does-not-say-which-rule-file-it-came-from.md) — a location-less finding is not locatable            | **FIXED in v0.24.0.** `attributeToRuleFile` stamps the rule file (line 1, the `tsconfig()` precedent) onto findings with no location of their own, at the point in the CLI loop where the mapping exists; `doctor` now diagnoses per file and carries `ruleFile` on each finding. Surfaced that the `ts-archunit-exclude` immunity for configuration findings had no test — and this change is what makes it live — plus two source comments naming a directive that does not exist.                                                                                                                                                                                                                                           |
| [0027](../bugs/fixed/0027-an-unmatched-baseline-entry-cannot-be-diagnosed.md) — an unmatched baseline entry cannot be diagnosed                       | **FIXED in v0.24.0**, and not by the mechanism the report proposed: comparing the entry's `rule` string cannot detect a _description_ change, because the description is what changed. A `subject` hash over `element::message` separates "the rule was edited" from "the violation was fixed"; the specific diagnosis supersedes the generic `matched === 0` finding because a matched subject disproves its repository-root explanation.                                                                                                                                                                                                                                                                                     |

### Fixed

| Bug                                                                                                                                   | Landed                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0010](../bugs/fixed/0010-violation-identity-embeds-absolute-paths.md) — identity embeds abs paths                                    | v0.19.0, after a review round found two criticals in the fix itself.                                                                                                                                                                                                                                         |
| [0011](../bugs/fixed/0011-dogfood-rules-select-nothing.md) — dogfood rules select nothing (17, not the 14 filed)                      | v0.20.0. Fixed by rescoping the rules, not by the bespoke mechanism it originally proposed — see below.                                                                                                                                                                                                      |
| [0013](../bugs/fixed/0013-resolvers-cannot-see-resolvers.md) — collectors blind to object literals                                    | v0.19.0. `resolvers()`, both smells and two presets could not see handler-map functions.                                                                                                                                                                                                                     |
| [0014](../bugs/fixed/0014-bare-package-import-globs-match-nothing.md) — bare package globs match nothing                              | v0.20.0. `notImportFrom('fastify')` compared the glob to the _resolved_ path, so it matched only when the package was NOT installed.                                                                                                                                                                         |
| [0016](../bugs/fixed/0016-narrowing-a-named-selection-mutates-it.md) — a held selection was mutated                                   | v0.21.0. 40 chain methods across 12 classes returned `this` after mutating it, so a held selection lost subjects and later rules passed. Nine of those classes were outside `RuleBuilder`'s hierarchy, and the GraphQL pair forked in neither `that()` nor `should()` — the shape `docs/graphql.md` teaches. |
| [0018](../bugs/fixed/0018-data-layer-preset-silently-enforces-nothing-for-a-file-glob.md) — a preset enforced nothing for a file glob | v0.20.0. `repositories`/`shared`/layer globs went to `resideInFolder`, which reads the parent directory, so a file glob matched nothing.                                                                                                                                                                     |

**0011 was fixed by rescoping, not by a mechanism** — kept here for the 0067-C
rationale, which still stands. It originally proposed a file-set identity
assertion. The 0067-C measurement superseded that: running the empty-selector
flip from a checkout **not** named `ts-archunit` produced 23 failures against 10
from a correctly-named one, and the 13-failure delta was exactly these rules.
That is the argument for fixing the class rather than the instances, and it is
why R3b still subsumes this even though the rules themselves were rescoped in
v0.20.0. An earlier version of this paragraph ended "0011 is now waiting on the
0067-C decision" while the table above recorded it as shipped — the same
table-versus-prose contradiction the Open/Fixed split was written to remove.

**Proposal [019](../proposals/019-rules-that-enforce-nothing-must-fail.md) got
cheaper.** It replaces `console.warn(...) + return []` at four sites — a rule
that has subjects but no conditions asserts nothing and passes. **The four sites
are deleted by [plan 0070](./completed/0070-a-rule-must-assert-something.md)'s 0.22.0 work** —
`assertionAdvice()` replaced them with one per-state remedy read by `doctor`, closing
[bug 0019](../bugs/fixed/0019-a-rule-with-no-condition-passes-in-total-silence.md)'s
observation that the main one could not fire (it was gated on
`_phase === 'predicate'`, which `should()` had already left). But 0014 merged the two builder hierarchies into one root, so the
fix is now a single implementation on `TerminalBuilder` instead of five copies,
and it composes with the census's `conditions: 0`, which already reports the
state without failing on it.

019 and 0067-C are the two halves of one guard: **019 is empty conditions,
0067-C is empty subjects.** Neither is a defect report; both are decisions.

## Deferred — decided, not scheduled

- **Discovery surface → adoptable** — [proposal 018](../proposals/018-adoptable-discovery-surface.md),
  **Draft 3, parked on bug 0010.** The strategic gap is real and unchanged: the
  enforcement half is mature, the discovery half (`duplicateBodies`,
  `inconsistentSiblings`) is used essentially zero times, and pointing it at a large
  adopting codebase surfaced ~700 findings that all 177 of that project's enforced
  rules were blind to. Review killed the obvious diagnosis — severity was never the
  blocker (`.check()` already works on smells via `overrides`), and a count ratchet is
  forbidden by ADR-008 rule 5. What remains is bug 0010 plus one parked question:
  whether a working baseline is enough to adopt a 700-finding surface, or a violation
  budget is needed.
- **`runtimeIsolation`** — proposal unwritten.
- **Slice discovery guards** — failing on a single-slice result, and on an empty slice
  among populated siblings. Both catch real false-greens; both were built and withdrawn
  from 0.18.1 because they fire on legitimate projects with no opt-out. They return once
  each remedy is executable data and an opt-out exists (`correspondence().allowEmpty()`
  is the model). See `../bugs/fixed/0009-*.md`.
- **015 (Bun)** — decided: no core preset. A tier-3 `@ts-archunit/bun` package, gated on
  a second real app. Nothing to build in core.
- **Proposal 012 (workspace config-coverage)** — rejected as core (2026-07-17): the root
  fix is a package-manager flag and the problem is structurally absent on
  pnpm/Turborepo/Nx. One idea extracted for its own proposal: reasoned exclusions
  (`deferred(pattern, reason)` beside `silent()`).

---

## Releases

| Version    | Theme                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| **0.22.0** | The assertion instrument — `doctor`/`diagnose()` see every rule that asserts nothing, each with its own remedy |
| **0.21.0** | A held builder is immutable — 40 chain methods across 12 classes are copy-on-write ⚠️ behaviour                |
| **0.20.0** | `doctor` / `diagnose()` and the glob declaration model; config findings cannot be downgraded                   |
| **0.19.0** | Portable violation identity — `withBaseline()` works across checkouts; three collectors see handler maps       |
| **0.18.1** | Slice glob parsing (every spelling agrees); meta-finding remedies visible and unsilenceable                    |
| **0.18.0** | AI-era program — `correspondence()`, object-literal functions, empty-selector safety ⚠️ breaking               |
| 0.17.0     | `init` scaffolds the shape presets                                                                             |
| 0.16.0     | Docs restructure (golden path); shape presets → returning form ⚠️ breaking                                     |
| 0.15.0     | `tsconfig()` config-assertion rule                                                                             |
| 0.14.0     | `ts-archunit init` scaffolder                                                                                  |
| 0.13.0     | AI-agent delivery program                                                                                      |

### 0.18.0 — the AI-era program (PR #2, 2026-07-24)

Turned the "architecture governance for the AI era" positioning into shipped code.
Positioning lives in `docs/why-ts-archunit.md`; the sequenced roadmap in
`ai-era-product-direction.md`. Motivated by an audit of a large adopting codebase —
its two largest recurring bug classes were route↔permission-matrix drift and phantom
limits, plus an empty-selector false-green the tool itself committed twice.

| Plan | What                                                 | Public API                                                                                                               |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0064 | F1 — filtered-subject materialization (the keystone) | `RuleBuilder.subjects()`                                                                                                 |
| 0065 | F2 + proposal 017 — coverage/relation primitive      | `correspondence(p).side()` → `.beComplete()` / `.haveNoOrphans()` / `.beBijective()`; `byName`/`byArg`/`byPropertyNames` |
| 0066 | F3 + proposal 016 — object-literal functions         | `functions(p, { includeObjectLiteralFunctions })`                                                                        |
| 0067 | F4 + proposal 014 (A/B/D) — empty-selector safety    | `.expectNonEmpty()`; `ArchViolation.bypassFilters`; slice/preset discovery non-vacuity                                   |

---

## Capabilities

What the library can do today. Details in `../docs/`.

**Entry points** — `modules()` imports and dependency direction · `classes()`
inheritance, decorators, members · `functions()` declarations, arrows, methods, and
optionally object-literal values · `types()` interfaces and aliases, matching through
`Partial`/`Pick` · `slices()` cycles (Tarjan), layer order, isolation · `calls()`
framework-agnostic call matching.

**Body analysis** (the differentiator) — `call()`, `newExpr()`, `access()`,
`property()`, `expression()`, `comment()` matchers with `contain()` / `notContain()` /
`useInsteadOf()`; optional-chaining normalization and nested-call detection.
`within(selection)` scopes rules inside matched callbacks.

**Relations & consistency** — `correspondence()` for "every X has a matching Y" by
identity · `crossLayer()` route↔schema↔SDK · `smells.duplicateBodies()` and
`smells.inconsistentSiblings()` AST-fingerprint detectors.

**Member inspection** — property, parameter-type, return-type and call-argument
conditions; visibility predicates.

**Adoption** — `withBaseline()` and `diffAware()` for existing codebases; per-rule
severity overrides; `.excluding()` / `silent()`; config-level findings deliberately
bypass both filters.

**Presets & standard rules** — `layeredArchitecture`, `dataLayerIsolation`,
`strictBoundaries`, `recommended`, `agentGuardrails` (all composable, returning form);
standard rules under `rules/` — `architecture`, `code-quality`, `dependencies`,
`errors`, `hygiene`, `metrics`, `metrics-function`, `naming`, `security`, `typescript`.

**CLI & output** — `check` (with `--watch`), `baseline`, `explain`, `init`;
terminal / JSON / GitHub-annotation formats; `tsconfig()` compiler-option assertions.

**Extension** — `definePredicate()`, `defineCondition()`, `.satisfy()`,
`definePattern()` / `followPattern()`, `not()` / `and()` / `or()` combinators.

---

## Completed plans

60 plans in `completed/`, numbered 0000–0070. Accepted proposals that shipped without
a numbered plan live in `../proposals/completed/` (multi-project workspace, dynamic
imports, builtin `importsFrom`, silent exclusions, JSX element rules, call-argument
identity, per-rule exclusions).

The per-plan history lives in those files and in `../CHANGELOG.md`; it is deliberately
not duplicated here — three overlapping "what's done" tables were what made the
previous version of this file hard to read.
