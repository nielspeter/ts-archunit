# ts-archunit Development Roadmap

**Created:** 2026-03-25
**Updated:** 2026-03-26
**Spec:** `ts-archunit-spec.md`
**Total Plans:** 29 completed, 0 remaining

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

---

## What's Shipped

**1265 tests across 102 files. All checks pass.**

### Core (P0)

- `project('tsconfig.json')` with singleton caching
- `Predicate<T>` + `Condition<T>` interfaces with combinators
- `RuleBuilder<T>` with fluent `.that().should().check()` chain
- `.because()`, `.warn()`, `.severity()`, `.rule({ id, because, suggestion, docs })`

### Entry Points (P1)

- `modules(p)` — import/dependency rules, type-only import enforcement
- `classes(p)` — inheritance, decorators, methods, body analysis
- `functions(p)` — function declarations, arrow functions, class methods
- `types(p)` — interfaces + type aliases, type matchers through Partial/Pick
- `slices(p)` — cycle detection (Tarjan's SCC), layer ordering, isolation
- `calls(p)` — framework-agnostic call expression matching (P2)

### Body Analysis (P1) — the differentiator

- `call()`, `newExpr()`, `access()`, `expression()` matchers
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
- 14 standard rules via `ts-archunit/rules/*` sub-path exports

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

### Bug Fixes

- BUG-0001: `.excluding()` now matches against `element`, `file`, and `message` (was element-only)

### Documentation

- VitePress user guide with 16 pages (plans 0023, 0027, 0028)
- GitHub Pages deployment workflow

---

## All Plans Complete

29 of 29 plans implemented. 1265 tests across 102 files. 90% integration test coverage.
