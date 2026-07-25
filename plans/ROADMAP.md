# ts-archunit Roadmap

**Version:** 0.18.1 · **Tests:** 2160 across 156 files · **Updated:** 2026-07-25
**Spec:** `../ts-archunit-spec.md` · **Direction:** `ai-era-product-direction.md`
**Plans:** 59 completed (`completed/`) · 4 open (below) · proposals in `../proposals/`

> Conventions: a plan is **READY** when its design is settled and it can be built as
> written; **PROPOSED** when the design is reviewed but nobody has decided to build
> it; **PARTIAL** when some phases shipped and the rest were deliberately deferred.

---

## Open work

| Plan                                           | State        | Effort   | Blocked on                              |
| ---------------------------------------------- | ------------ | -------- | --------------------------------------- |
| 0068 — Close vacuity holes in our dogfooding   | **READY**    | ~2 h     | nothing                                 |
| 0067 — Empty-selector safety (**part C only**) | **PARTIAL**  | ~1 day   | a version decision (breaking re-cut)    |
| 0047 — TypeScript escape-hatch matchers        | **PROPOSED** | ~1 day   | go/no-go — trimmed scope already agreed |
| 0048 — `usingTagged()` symbol-tagged matcher   | **PROPOSED** | ~1.5 day | go/no-go — deferred until demand        |

**0068 is READY** — it closes a live false green: 13 existing dogfood rules scope on
`**/ts-archunit/src/**` and select nothing in a worktree or renamed checkout. The
other three items need a decision, not implementation. 0063 shipped 2026-07-25.

**0067 part C** is the remaining slice of proposal 014: path-glob auto-fail on every
builder plus path normalization. It is the broadest breaking change left, which is
why it is parked on a version decision rather than an implementation question.

**0047 / 0048** were reviewed 2026-07-13 and given a go/no-go on 2026-07-14: 0047
ship **trimmed** (`doubleCast` + `anyAnnotation`; defer `broadType`/`tsDirective`),
0048 **defer until demand** (overlaps `@typescript-eslint/no-deprecated`; the symbol
layer is speculative). Both remain PROPOSED — the open question is whether each earns
API surface, not how to build it.

## Deferred — decided, not scheduled

- **Discovery surface → adoptable** — [proposal 018](../proposals/018-adoptable-discovery-surface.md),
  **drafted 2026-07-25, needs review.** Reframes the long-standing "promote the smells
  to fail-grade" item: `.check()` already works on them (`SmellBuilder extends
TerminalBuilder`), so severity was never the blocker. The measured blocker is that
  `hashViolation` is destabilised by the coordinates the detectors write into
  `message`, which makes `withBaseline()` non-functional for the whole surface — you
  cannot accept existing debt, so the only options are red-on-arrival or off. This is
  still the strategic gap: the enforcement half is mature, the discovery half is
  unused.
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
