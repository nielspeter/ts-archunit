# ts-archunit Roadmap

**Version:** 0.18.1 · **Tests:** 2160 across 156 files · **Updated:** 2026-07-25
**Spec:** `../ts-archunit-spec.md` · **Direction:** `ai-era-product-direction.md`
**Plans:** 59 completed (`completed/`) · 3 open (below) · proposals in `../proposals/` ·
open defects in `../bugs/`

> Conventions: a plan is **READY** when its design is settled and it can be built as
> written; **PROPOSED** when the design is reviewed but nobody has decided to build
> it; **PARTIAL** when some phases shipped and the rest were deliberately deferred.

---

## Open work

| Plan                                           | State        | Effort   | Blocked on                              |
| ---------------------------------------------- | ------------ | -------- | --------------------------------------- |
| 0067 — Empty-selector safety (**part C only**) | **PARTIAL**  | ~1 day   | a version decision (breaking re-cut)    |
| 0047 — TypeScript escape-hatch matchers        | **PROPOSED** | ~1 day   | go/no-go — trimmed scope already agreed |
| 0048 — `usingTagged()` symbol-tagged matcher   | **PROPOSED** | ~1.5 day | go/no-go — deferred until demand        |

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

Measured and reproduced. Full write-ups in `../bugs/`.

| Bug                                                                                          | State                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0010](../bugs/0010-violation-identity-embeds-absolute-paths.md) — identity embeds abs paths | **Fixed** on `spike/0010`, after a review round found two criticals in the fix itself. Ships as 0.19.0.                                          |
| [0013](../bugs/0013-resolvers-cannot-see-resolvers.md) — collectors blind to object literals | **Fixed** on the same branch (merged in). `resolvers()`, both smells and two presets could not see handler-map functions.                        |
| [0011](../bugs/0011-dogfood-rules-select-nothing.md) — 14 dogfood rules select nothing       | **Open**, and its fix is now known: the 0067-C empty-selector flip detects all 13 automatically. No bespoke guard needed — see below.            |
| [0012](../bugs/0012-metric-findings-have-no-usable-ratchet.md) — improving a metric goes red | **Open**, and wider than first filed: eight sites, not one. Needs a per-element threshold ratchet, which is a design decision rather than a fix. |

**0011 no longer needs its own mechanism.** It originally proposed a file-set
identity assertion. The 0067-C measurement supersedes that: running the
empty-selector flip from a checkout **not** named `ts-archunit` produces 23
failures against 10 from a correctly-named one, and the 13-failure delta is
exactly these rules. Whatever fixes the class fixes them, so 0011 is now
waiting on the 0067-C decision rather than on work of its own.

**Proposal [019](../proposals/019-rules-that-enforce-nothing-must-fail.md) got
cheaper.** It replaces `console.warn(...) + return []` at five sites — a rule
that has subjects but no conditions asserts nothing and passes. All five are
still there. But 0014 merged the two builder hierarchies into one root, so the
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

| Version    | Theme                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------ |
| **0.18.1** | Slice glob parsing (every spelling agrees); meta-finding remedies visible and unsilenceable      |
| **0.18.0** | AI-era program — `correspondence()`, object-literal functions, empty-selector safety ⚠️ breaking |
| 0.17.0     | `init` scaffolds the shape presets                                                               |
| 0.16.0     | Docs restructure (golden path); shape presets → returning form ⚠️ breaking                       |
| 0.15.0     | `tsconfig()` config-assertion rule                                                               |
| 0.14.0     | `ts-archunit init` scaffolder                                                                    |
| 0.13.0     | AI-agent delivery program                                                                        |

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

59 plans in `completed/`, numbered 0000–0066. Accepted proposals that shipped without
a numbered plan live in `../proposals/completed/` (multi-project workspace, dynamic
imports, builtin `importsFrom`, silent exclusions, JSX element rules, call-argument
identity, per-rule exclusions).

The per-plan history lives in those files and in `../CHANGELOG.md`; it is deliberately
not duplicated here — three overlapping "what's done" tables were what made the
previous version of this file hard to read.
