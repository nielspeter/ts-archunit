# ts-archunit Development Roadmap

**Created:** 2026-03-25
**Updated:** 2026-03-26
**Spec:** `ts-archunit-spec.md`
**Total Plans:** 22 completed, 4 remaining

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
| **P2**   | User Guide with VitePress (0023)                                                 | 1-2 days  | Not Started          |
| **P3**   | Smell Detectors: Duplicate Bodies & Inconsistent Siblings (0018)                 | 2-3 days  | Not Started          |
| **P3**   | GraphQL Extension: Schema & Resolver Rules (0021)                                | 3-5 days  | Not Started          |
| **P4**   | Cross-Layer Validation (0022)                                                    | 3-5 days  | Not Started          |

---

## What's Shipped

**658 tests across 66 files. All checks pass.**

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

### Not Yet Shipped
- Smell detectors (duplicate bodies, inconsistent siblings)
- GraphQL extension (`ts-archunit/graphql`)
- Cross-layer validation (route ↔ schema ↔ SDK consistency)
- User guide (VitePress documentation site)
- Watch mode for CLI

---

## Remaining Plans

### P2: Documentation
```
0023 - User Guide with VitePress + GitHub Pages
```

### P3: Nice-to-have
```
0018 - Smell Detectors (duplicate body detection, inconsistent siblings)
0021 - GraphQL Extension (ts-archunit/graphql sub-path, schema + resolver rules)
```

### P4: Research
```
0022 - Cross-Layer Validation (route ↔ schema ↔ SDK consistency)
```

Build when users ask for them.
