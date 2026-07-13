# ts-archunit Development Roadmap

**Created:** 2026-03-25
**Updated:** 2026-07-13
**Spec:** `ts-archunit-spec.md`
**Total Plans:** 48 completed + proposal 010, 7 open (see "Open Plans" below)

---

## Priority Matrix

| Priority | Plan                                                                             | Effort    | Status               |
| -------- | -------------------------------------------------------------------------------- | --------- | -------------------- |
| **P0**   | ~~Project Bootstrap & Package Setup (0000)~~                                     | 2-3 hours | COMPLETED 2026-03-25 |
| **P0**   | ~~Exploratory PoC & Technical Validation (0001)~~                                | 0.5 day   | COMPLETED 2026-03-25 |
| **P0**   | ~~Project Loader & Query Engine (0002)~~                                         | 0.5 day   | COMPLETED 2026-03-25 |
| **P0**   | ~~Predicate Engine & Identity Predicates (0003)~~                                | 1 day     | COMPLETED 2026-03-25 |
| **P0**   | ~~Condition Engine & Structural Conditions (0004)~~                              | 1 day     | COMPLETED 2026-03-25 |
| **P0**   | ~~Fluent Rule Builder & `.check()` / `.warn()` (0005)~~                          | 1 day     | COMPLETED 2026-03-25 |
| **P1**   | ~~Violation Reporting & Code Frames (0006)~~                                     | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Module Entry Point & Dependency Conditions (0007)~~                            | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Class Entry Point & Class Predicates/Conditions (0008)~~                       | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Function Entry Point & Function Predicates (0009)~~                            | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Type Entry Point & Type-Level Conditions (0010)~~                              | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Body Analysis: `call()`, `access()`, `newExpr()`, `expression()` (0011)~~      | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Slice Entry Point & Cycle/Layer Conditions (0012)~~                            | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Custom Predicates, Conditions & `definePredicate` / `defineCondition` (0013)~~ | 0.5 day   | COMPLETED 2026-03-26 |
| **P2**   | ~~Call Entry Point & Call Predicates (0014)~~                                    | 1 day     | COMPLETED 2026-03-26 |
| **P2**   | ~~Named Selections, `within()` & Scoped Rules (0015)~~                           | 1 day     | COMPLETED 2026-03-26 |
| **P2**   | ~~Baseline Mode & Diff-Aware Mode (0016)~~                                       | 1 day     | COMPLETED 2026-03-26 |
| **P2**   | ~~Pattern Templates & `definePattern` / `followPattern` (0017)~~                 | 0.5 day   | COMPLETED 2026-03-26 |
| **P2**   | ~~Output Formats: JSON, GitHub Annotations (0019)~~                              | 0.5 day   | COMPLETED 2026-03-26 |
| **P2**   | ~~CLI Standalone Runner (0020)~~                                                 | 0.5 day   | COMPLETED 2026-03-26 |
| **P2**   | ~~Standard Rules Library (0024)~~                                                | 1 day     | COMPLETED 2026-03-26 |
| **P2**   | ~~Rich Rule Metadata (0025)~~                                                    | 0.5 day   | COMPLETED 2026-03-26 |
| **P2**   | ~~User Guide with VitePress (0023)~~                                             | 1 day     | COMPLETED 2026-03-26 |
| **P3**   | ~~Smell Detectors: Duplicate Bodies & Inconsistent Siblings (0018)~~             | 1 day     | COMPLETED 2026-03-26 |
| **P3**   | ~~GraphQL Extension: Schema & Resolver Rules (0021)~~                            | 1 day     | COMPLETED 2026-03-26 |
| **P4**   | ~~Cross-Layer Validation (0022)~~                                                | 1 day     | COMPLETED 2026-03-26 |
| **P2**   | ~~CLI Watch Mode (0027)~~                                                        | 0.5 day   | COMPLETED 2026-03-26 |
| **P3**   | ~~Metric-Based Standard Rules (0028)~~                                           | 1 day     | COMPLETED 2026-03-26 |
| **P3**   | ~~Function Signature Predicates (0029)~~                                         | 0.5 day   | COMPLETED 2026-03-26 |
| **P2**   | ~~Member Property Conditions (0030)~~                                            | 1 day     | COMPLETED 2026-03-27 |
| **P2**   | ~~Parameter Type Conditions (0031)~~                                             | 0.5 day   | COMPLETED 2026-03-27 |
| **P2**   | ~~Member Visibility Predicates (0032)~~                                          | 0.5 day   | COMPLETED 2026-03-27 |
| **P2**   | ~~Return Type Condition (0033)~~                                                 | 0.25 day  | COMPLETED 2026-03-27 |
| **P2**   | ~~Call Argument Property Condition (0034)~~                                      | 0.5 day   | COMPLETED 2026-03-27 |
| **P2**   | ~~Aliased Import Condition (0035)~~                                              | 0.25 day  | COMPLETED 2026-03-27 |
| **P1**   | ~~Property Matcher & Argument Containing Condition (0036)~~                      | 0.5 day   | COMPLETED 2026-03-28 |
| **P0**   | ~~expression() Ancestor Deduplication (0037)~~                                   | 0.25 day  | COMPLETED 2026-03-28 |
| **P1**   | ~~notImportFrom Type-Import Awareness (0038)~~                                   | 0.5 day   | COMPLETED 2026-03-28 |
| **P2**   | ~~within() Object Literal Callback Extraction (0039)~~                           | 0.5 day   | COMPLETED 2026-03-28 |

---

## Final batch (completed 2026-03-30)

| Priority | Plan                                                                | Effort   | Status               | Depends on       |
| -------- | ------------------------------------------------------------------- | -------- | -------------------- | ---------------- |
| **P1**   | ~~Architecture Rule Framework Primitives (0041)~~                   | 2.5 days | COMPLETED 2026-03-30 | 0011, 0007       |
| **P1**   | ~~Standard Architecture Rule Conditions (0042)~~                    | 0.5 day  | COMPLETED 2026-03-30 | 0041             |
| **P1**   | ~~Architecture Presets (0040)~~                                     | 1.5 days | COMPLETED 2026-03-30 | 0041, 0042       |
| **P1**   | ~~Docs, Explain Command, and Recipes (0043)~~                       | 1 day    | COMPLETED 2026-03-30 | 0041, 0042, 0040 |
| **P2**   | ~~TypeScript Assertion Matchers + Function/Module Variants (0046)~~ | 0.5 day  | COMPLETED 2026-04-12 |                  |
| **P1**   | ~~Argument-Aware Identity for `calls()` Rules (0057)~~              | 1 day    | COMPLETED 2026-06-13 | none             |
| **P3**   | ~~`jsxText()` Matcher (0056)~~                                      | ~3 hours | COMPLETED 2026-07-03 | none             |

---

## What's Shipped

**1910 tests across 140 files. All checks pass.**

### Core (P0)

- `project('tsconfig.json')` with singleton caching, `workspace([...tsconfigs])` for monorepos
- `Predicate<T>` + `Condition<T>` interfaces with combinators
- `RuleBuilder<T>` with fluent `.that().should().check()` chain
- `.because()`, `.warn()`, `.severity()`, `.rule({ id, because, suggestion, docs })`

### Entry Points (P1)

- `modules(p)` — import/dependency rules, type-only import enforcement, `dependOn()`, dynamic import detection
- `classes(p)` — inheritance, decorators, methods, body analysis
- `functions(p)` — function declarations, arrow functions, class methods
- `types(p)` — interfaces + type aliases, type matchers through Partial/Pick
- `slices(p)` — cycle detection (Tarjan's SCC), layer ordering, isolation
- `calls(p)` — framework-agnostic call expression matching (P2)

### Body Analysis (P1) — the differentiator

- `call()`, `newExpr()`, `access()`, `property()`, `expression()` matchers
- `contain()`, `notContain()`, `useInsteadOf()` conditions
- Optional chaining normalization, nested call detection

### Advanced Features (P2)

- `within(selection).functions()` — scoped rules inside matched callbacks
- `withBaseline()` + `diffAware()` — gradual adoption for existing codebases
- `detectFormat()` — GitHub Actions annotations, JSON, terminal output
- `.rule({ id, because, suggestion, docs })` — rich violation messages
- `definePattern()` + `followPattern()` — return shape conventions
- `defineConfig()` + `npx ts-archunit check` — CLI runner
- `definePredicate()` + `defineCondition()` + `.satisfy()` — extension API
- 13 standard rules via `@nielspeter/ts-archunit/rules/*` sub-path exports

### P3 + P4

- `smells.duplicateBodies()` + `smells.inconsistentSiblings()` — AST fingerprint similarity
- `ts-archunit/graphql` — schema + resolver rules with optional graphql peer dep
- `crossLayer(p)` — route ↔ schema ↔ SDK consistency validation

### Documentation

- VitePress user guide with 13 pages (plan 0023)
- GitHub Pages deployment workflow

### CLI & Metrics (P2/P3 — plan 0027, 0028)

- `npx ts-archunit check --watch` — debounced file watcher with `resetProjectCache()` + `importFresh()`
- `ts-archunit/rules/metrics` — `maxCyclomaticComplexity`, `maxClassLines`, `maxMethodLines`, `maxMethods`, `maxParameters` + function-level equivalents
- Metric predicates for composition: `haveCyclomaticComplexity`, `haveMoreLinesThan`, `haveMoreMethodsThan`, `haveComplexity`, `haveMoreFunctionLinesThan`
- `docs/cli.md` — full CLI documentation page
- `docs/metrics.md` — full metrics documentation page

### Member Inspection Layer (P2 — plans 0030–0034)

- Property conditions: `havePropertyNamed`, `notHavePropertyNamed`, `havePropertyMatching`, `notHavePropertyMatching`, `haveOnlyReadonlyProperties`, `maxProperties`
- Parameter type conditions: `acceptParameterOfType`, `notAcceptParameterOfType` (classes + functions)
- Visibility predicates: `arePublic`, `areProtected`, `arePrivate`
- Return type condition: `haveReturnTypeMatching`
- Call argument conditions: `haveArgumentWithProperty`, `notHaveArgumentWithProperty`, `haveArgumentContaining`, `notHaveArgumentContaining`

### Bug Fixes

- BUG-0001: `.excluding()` now matches against `element`, `file`, and `message` (was element-only)
- BUG-0002 through BUG-0007: See CHANGELOG 0.3.0

### Documentation

- VitePress user guide with 16 pages (plans 0023, 0027, 0028)
- GitHub Pages deployment workflow

### Standard Architecture Rule Conditions (P1 — plan 0042)

- Security function variants: `functionNoEval`, `functionNoFunctionConstructor`, `functionNoProcessEnv`, `functionNoConsoleLog`, `functionNoConsole`, `functionNoJsonParse`
- Security module variants: `moduleNoEval`, `moduleNoProcessEnv`, `moduleNoConsoleLog`
- New class security rules: `noConsole` (all console methods), `noJsonParse`
- Error function variants: `functionNoGenericErrors`, `functionNoTypeErrors`
- Architecture primitives: `mustCall(pattern)`, `classMustCall(pattern)` — positive body assertion
- Hygiene rules: `noDeadModules`, `noUnusedExports`, `noStubComments`, `noEmptyBodies`
- Sub-path exports: `./rules/architecture`, `./rules/hygiene`

### Architecture Rule Primitives (P1 — plan 0041)

- Builder phase tracking: `_phase` field, dual-use methods dispatch as predicate or condition based on `.that()` / `.should()` context
- Phase-aware methods: `notImportFrom`, `resideInFile`, `resideInFolder`, `haveNameMatching`, `extend`, `implement`, `haveMethodNamed` across 4 builders
- Module body analysis: `modules().should().notContain()` / `contain()` / `useInsteadOf()` with `{ scopeToModule: true }` option
- Export conditions: `notHaveDefaultExport()`, `haveDefaultExport()`, `haveMaxExports(n)`
- Reverse dependency: `onlyBeImportedVia()`, `beImported()`, `haveNoUnusedExports()` with cached reverse import graph
- Stub detection: `comment()` matcher, `STUB_PATTERNS` constant, `notHaveEmptyBody()` on functions + classes
- 7 deprecated aliases: `notImportFromCondition`, `shouldResideInFile`, `shouldResideInFolder`, `conditionHaveNameMatching`, `shouldExtend`, `shouldImplement`, `shouldHaveMethodNamed`

### Architecture Presets (P1 — plan 0040)

- `layeredArchitecture(p, options)` — layer ordering, cycle detection, innermost isolation, type-import enforcement, restricted packages
- `dataLayerIsolation(p, options)` — base class extension, typed error enforcement for repositories
- `strictBoundaries(p, options)` — no cycles, no cross-boundary imports, shared isolation, test isolation, copy-paste detection
- `.violations()` terminal on `RuleBuilder` and `TerminalBuilder` — returns violations without throwing
- `dispatchRule()` + `throwIfViolations()` — aggregated error reporting across multiple rules
- Sub-path export: `./presets`
- Override system: per-rule severity (`'error'`, `'warn'`, `'off'`)

### Docs, Explain Command, and Recipes (P1 — plan 0043)

- `npx ts-archunit explain` CLI subcommand — dumps active rules as JSON or markdown
- `.describeRule()` on `RuleBuilder` and `TerminalBuilder` — metadata extraction without rule execution
- VitePress: `docs/presets.md`, `docs/recipes.md`, `docs/explain.md` — 3 new pages
- Updated: `docs/standard-rules.md`, `docs/getting-started.md`, `docs/cli.md`
- Explanatory descriptions added to all 45+ sections across 18 documentation files

---

## Open Plans

Seven plans are authored but not yet completed. All plan files live in `plans/` (completed plans move to `plans/completed/`).

Plans 0047–0055 were reviewed 2026-07-13 (architect + product) and their key design decisions locked — each carries a `Review` line in its Status block and a `## Review findings` section. Plan 0060 was split out of 0050 during that review.

| Priority | Plan                                            | Effort      | State                     | Depends on |
| -------- | ----------------------------------------------- | ----------- | ------------------------- | ---------- |
| **P0**   | Agent-Facing Rule Surface (0044)                | ~1.5 days   | Ready                     | 0040, 0043 |
| **P2**   | `tsconfig()` Config-Assertion Rule (0055)       | 0.5–1 day   | Reviewed — flat API       | none       |
| **P2**   | TypeScript Escape-Hatch Matchers (0047)         | ~1 day      | Reviewed — module-only    | 0046       |
| **P2**   | `usingTagged()` Symbol-Tagged Matcher (0048)    | ~1–1.5 days | Reviewed — `@deprecated`  | 0011, 0013, 0046 |
| **P2***  | `check` Unified Pipeline / Preset Support (0060) | ~1 day      | Reviewed — Option 2       | 0020, 0016, 0040 |
| **P2***  | `recommended()` Sensible-Defaults Preset (0049) | 0.5 day     | Reviewed — thin + returning form | standard rules, 0060 |
| **P2***  | `ts-archunit init` CLI Scaffolder (0050)        | 0.5–1 day   | Reviewed — returning form | 0049, 0060 |

\* Draft priority is TBD (likely P2 once approved).

**Build sequence** (least-dependent first): **0055 → 0047 → 0048 → 0060 → 0049 → 0050.** 0044 (Agent-Facing Rule Surface) is independent and can slot anywhere. 0060 (the CLI's severity-aware unified pipeline + preset support) was split out of 0050's review — it's an independently-valuable gap (presets don't run under `check` today, and warns bypass baseline/format) and a hard prerequisite for both `recommended`'s returning form (0049) and the `init` scaffolder (0050).

### Plan 0044 phases (MCP server dropped — the CLI already exposes the same surface)

1. **Agent-Optimized Explain Format** (0.5 day) — `explain --format agent` emits imperative markdown for system prompts; new `imperative` field on rule metadata/description
2. **Agent Guardrails Preset** (0.5 day) — `agentGuardrails(p, {...})` one-liner bundling function-variant body-analysis rules for common agent mistakes
3. **Documentation** (0.5 day) — `docs/ai-agents.md` + getting-started / cli / presets updates

The original MCP server (`check_architecture` / `explain_rules`) was deferred — it duplicated `npx ts-archunit check --format json` / `explain` without adding capability. See 0044's "Deferred: MCP server" section (revisit only if cold-start latency is measured to hurt the agent loop, and evaluate a CLI daemon before MCP).

### Adoption cluster (0060 → 0049 → 0050)

0060 (severity-aware unified `check` pipeline), 0049 (thin `recommended()`, returning form), and 0050 (`init` scaffolder) form the onboarding chain. The design (Option 2, decided 2026-07-13): `recommended()` returns severity-carrying builders; the generated `arch.rules.ts` does `export default [...recommended(p)]`; 0060's pipeline runs them with baseline/format/severity applied uniformly (so the two `warn` rules are baseline-filtered, not lost to `console.warn`). Build 0060 first (the pipeline), then 0049 (returning-form recommended), then 0050. 0055, 0047, and 0048 stand alone. Design decisions for 0047–0060 are locked (see each plan's `## Review findings` / design-decision sections); they still need a scheduling/go decision.

---

## Completed

48 plans implemented + proposal 010 (JSX Element Rules). Latest: `jsxText()` matcher (0056, v0.12.0). 1910 tests across 140 files.
