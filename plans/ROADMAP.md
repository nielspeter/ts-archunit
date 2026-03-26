# ts-archunit Development Roadmap

**Created:** 2026-03-25
**Updated:** 2026-03-25
**Spec:** `ts-archunit-spec.md`
**Total Plans:** 14 completed, ~9 remaining

---

## Priority Matrix

| Priority | Plan                                                                         | Effort    | Status      |
| -------- | ---------------------------------------------------------------------------- | --------- | ----------- |
| **P0**   | ~~Project Bootstrap & Package Setup (0000)~~                                 | 2-3 hours | COMPLETED 2026-03-25 |
| **P0**   | ~~Exploratory PoC & Technical Validation (0001)~~                            | 0.5 day   | COMPLETED 2026-03-25 |
| **P0**   | ~~Project Loader & Query Engine (0002)~~                                     | 0.5 day   | COMPLETED 2026-03-25 |
| **P0**   | ~~Predicate Engine & Identity Predicates (0003)~~                            | 1 day     | COMPLETED 2026-03-25 |
| **P0**   | ~~Condition Engine & Structural Conditions (0004)~~                          | 1 day     | COMPLETED 2026-03-25 |
| **P0**   | ~~Fluent Rule Builder & `.check()` / `.warn()` (0005)~~                      | 1 day     | COMPLETED 2026-03-25 |
| **P1**   | ~~Violation Reporting & Code Frames (0006)~~                                 | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Module Entry Point & Dependency Conditions (0007)~~                        | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Class Entry Point & Class Predicates/Conditions (0008)~~                   | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Function Entry Point & Function Predicates (0009)~~                        | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Type Entry Point & Type-Level Conditions (0010)~~                          | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Body Analysis: `call()`, `access()`, `newExpr()`, `expression()` (0011)~~  | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Slice Entry Point & Cycle/Layer Conditions (0012)~~                        | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Custom Predicates, Conditions & `definePredicate` / `defineCondition` (0013)~~ | 0.5 day | COMPLETED 2026-03-26 |
| **P2**   | Call Entry Point & Call Predicates (0014)                                    | 2-3 days  | Not Started |
| **P2**   | Named Selections, `within()` & Scoped Rules (0015)                           | 1-2 days  | Not Started |
| **P2**   | Baseline Mode & Diff-Aware Mode (0016)                                       | 1-2 days  | Not Started |
| **P2**   | Pattern Templates & `definePattern` / `followPattern` (0017)                 | 1-2 days  | Not Started |
| **P2**   | Smell Detectors: Duplicate Bodies & Inconsistent Siblings (0018)             | 2-3 days  | Not Started |
| **P2**   | Output Formats: JSON, GitHub Annotations (0019)                              | 1 day     | Not Started |
| **P3**   | CLI Standalone Runner & Watch Mode (0020)                                    | 1-2 days  | Not Started |
| **P3**   | GraphQL Extension: Schema & Resolver Rules (0021)                            | 3-5 days  | Not Started |
| **P4**   | Cross-Layer Validation (0022)                                                | 3-5 days  | Not Started |
| **P2**   | User Guide with VitePress (0023)                                             | 1-2 days  | Not Started |
| **P2**   | ~~Standard Rules Library (0024)~~                                            | 1 day     | COMPLETED 2026-03-26 |

---

## Recommended Execution Order

### Bootstrap + PoC (P0) — sequential, gate for everything

```
0000 - Project Bootstrap & Package Setup
  └─► 0001 - Exploratory PoC & Technical Validation
```

0000 sets up the npm package (package.json, tsconfig, vitest, eslint, prettier, directory structure). 0001 uses it to validate core assumptions (ts-morph body analysis, type checker integration, API ergonomics, performance baseline) against fixtures modeled on real cmless plan 0212 pain points. Findings feed back into plans 0002-0013 — may change API design, split/merge plans, or surface unknown risks.

### Foundation (P0) — must be sequential

These plans build on each other. Each one is useless without the previous.

```
0002 - Project Loader & Query Engine (informed by 0001 findings)
  └─► 0003 - Predicate Engine & Identity Predicates
        └─► 0004 - Condition Engine & Structural Conditions
              └─► 0005 - Fluent Rule Builder & .check() / .warn()
```

After 0005, you have a working but minimal tool — you can write rules that filter by name/path and assert structural conditions. Nothing useful yet for real projects, but the entire pipeline works end-to-end.

### Core Entry Points (P1) — parallelizable after foundation

Once the foundation is solid, these are largely independent. Each adds an entry point (`modules()`, `classes()`, etc.) with its predicates and conditions. Order matters only where noted.

```
0006 - Violation Reporting & Code Frames (needed by all entry points for good DX)
  └─► 0007 - Module Entry Point & Dependency Conditions
      0008 - Class Entry Point & Class Predicates/Conditions
      0009 - Function Entry Point & Function Predicates
      0010 - Type Entry Point & Type-Level Conditions
      0011 - Body Analysis (depends on 0008 + 0009 — operates on class/function bodies)
      0012 - Slice Entry Point & Cycle/Layer Conditions (depends on 0007 — uses import graph)
      0013 - Custom Predicates & Conditions
```

After P1, you have a **fully functional Phase 1 MVP** matching the spec. Users can write real architecture tests.

### Advanced Features (P2)

```
0014 - Call Entry Point & Call Predicates
0015 - Named Selections & within() (depends on 0014 for call-scoped rules)
0016 - Baseline Mode & Diff-Aware Mode
0017 - Pattern Templates
0018 - Smell Detectors (depends on 0011 — uses body analysis)
0019 - Output Formats
```

### Extensions (P3/P4)

```
0020 - CLI Standalone Runner & Watch Mode
0021 - GraphQL Extension (depends on all P1 being complete)
0022 - Cross-Layer Validation (depends on 0021)
```

---

## MVP Definition

**Minimum viable release** requires plans 0000-0013. After these, users can:

- Load a TypeScript project via `project('tsconfig.json')`
- Write rules using `modules()`, `classes()`, `functions()`, `types()`
- Filter with identity predicates + type-specific predicates
- Assert dependency rules, structural rules, and body analysis rules
- Get actionable violation reports with code frames
- Define custom predicates and conditions
- Run rules in vitest/jest with `.check()` and `.warn()`
- Enforce layer ordering and detect cycles with `slices()`

---

## Plan Summaries

### 0000. Project Bootstrap & Package Setup

Set up the npm package from scratch: package.json (ESM-only per ADR-004), tsconfig (strict + noUncheckedIndexedAccess), vitest, eslint, prettier (per ADR-001), directory structure matching spec Section 13. Dependencies: ts-morph (ADR-002), picomatch. Smoke test verifying ts-morph loads. All tooling decisions per ADR-001.

---

### 0001. Exploratory PoC & Technical Validation

Throwaway spike to validate that ts-archunit can prevent the architecture rot documented in cmless plan 0212. Five probes against fixtures modeled on real cmless code: (1) function existence — find `parseXxxOrder()` by regex; (2) body analysis — `call('parseInt')`, `call('this.extractCount')`, `newExpr('Error')`, `newExpr('URLSearchParams')` matching; (3) type checker — distinguish `orderBy: string` from `orderBy: 'a' | 'b'` through aliases/Partial/Pick; (4) performance — 500-file project baseline; (5) API ergonomics — write real 0212 rules in vitest. Deliverable: findings doc + go/no-go.

---

### 0002. Project Loader & Query Engine

`project('tsconfig.json')` entry point. ts-morph `Project` loading. Pre-indexing of source files. Lazy AST loading for large codebases. Singleton caching per tsconfig path. Memoization infrastructure for predicate results. Spec Sections 4.2, 13.1, 13.4.

---

### 0003. Predicate Engine & Identity Predicates

Core `Predicate<T>` interface. Predicate combinators (AND, OR, NOT). Identity predicates shared across all entry points: `haveNameMatching`, `haveNameStartingWith`, `haveNameEndingWith`, `resideInFile`, `resideInFolder`, `areExported`, `areNotExported`. Spec Sections 5.1, 13.2.

---

### 0004. Condition Engine & Structural Conditions

Core `Condition<T>` interface. Structural conditions: `resideInFile`, `resideInFolder`, `haveNameMatching`, `beExported`, `notExist`. Quantifier conditions: `allMatch`, `noneMatch`, `atLeastOne`. Logical combinators: `.andShould()`, `.orShould()`. Spec Sections 6.1, 6.7, 6.8.

---

### 0005. Fluent Rule Builder & `.check()` / `.warn()`

Base `RuleBuilder` with `.that()`, `.and()`, `.should()`, `.andShould()`, `.orShould()`, `.because()`, `.check()`, `.warn()`, `.severity()`. Rule execution pipeline: filter elements with predicates, evaluate conditions, collect violations, throw or warn. Fluent builder pattern per ADR-003. Spec Sections 4.3, 6.9.

---

### 0006. Violation Reporting & Code Frames

`ArchViolation` interface. Code frame extraction from ts-morph source positions. Suggestion generation (from `useInsteadOf`, etc.). Terminal formatter with colors. Violation grouping and counting. Spec Section 12.

---

### 0007. Module Entry Point & Dependency Conditions

`modules(p)` entry point returning `ModuleRuleBuilder`. Module predicates: `importFrom`, `notImportFrom`, `exportSymbolNamed`, `havePathMatching`. Dependency conditions: `onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom`, `notReference`, `notReferenceType`. Import graph construction. Spec Sections 5.6, 6.2.

---

### 0008. Class Entry Point & Class Predicates/Conditions

`classes(p)` entry point returning `ClassRuleBuilder`. Class predicates: `extend`, `implement`, `structurallyMatch`, `haveDecorator`, `haveDecoratorMatching`, `areAbstract`, `haveMethodNamed`, `haveMethodMatching`, `havePropertyNamed`. Class conditions: `extend`, `implement`, `haveMethodNamed`, `notHaveMethodMatching`. Spec Sections 5.2, 6.5.

---

### 0009. Function Entry Point & Function Predicates

`functions(p)` entry point returning `FunctionRuleBuilder`. Covers both `FunctionDeclaration` and `const` arrow functions. Function predicates: `areAsync`, `haveParameterCount`, `haveParameterCountGreaterThan`, `haveParameterNamed`, `haveReturnType`, `haveDecorator`. Spec Section 5.3.

---

### 0010. Type Entry Point & Type-Level Conditions

`types(p)` entry point returning `TypeRuleBuilder`. Type predicates: `areInterfaces`, `areTypeAliases`, `haveProperty`, `havePropertyOfType`, `extendType`. Type-level conditions: `havePropertyType` with semantic matchers (`not()`, `isString()`, `isUnionOfLiterals()`, `isStringLiteral()`, `shapeOf()`, `exactly()`, `arrayOf()`, `matching()`). Two-tier analysis: these conditions trigger the type checker. Spec Sections 5.4, 6.4.

---

### 0011. Body Analysis: `call()`, `access()`, `newExpr()`, `expression()`

The differentiating feature. Body analysis conditions: `contain(call())`, `notContain(call())`, `contain(access())`, `contain(newExpr())`, `notContain(newExpr())`, `useInsteadOf()`. Helpers: `call(name)`, `call(regex)`, `call(predicate)`, `access(chain)`, `newExpr(name)`, `expression()` (escape hatch with runtime warning). Argument-level matching: `call().withArgument()`. Spec Sections 6.3, 6.3.1-6.3.5.

---

### 0012. Slice Entry Point & Cycle/Layer Conditions

`slices(p)` entry point returning `SliceRuleBuilder`. Slice predicates: `matching(glob)`, `assignedFrom(definition)`. Slice conditions: `beFreeOfCycles` (Tarjan's SCC), `respectLayerOrder`, `notDependOn`. Builds directed graph from module import data (depends on 0007 import graph). Spec Sections 5.7, 6.6.

---

### 0013. Custom Predicates, Conditions & Extension API

`definePredicate<T>()`, `defineCondition<T>()`. `.satisfy()` method on rule builders for plugging in custom predicates/conditions. Same interface as built-in ones — no second-class citizens. Spec Section 7.1, 7.2.

---

### 0014. Call Entry Point & Call Predicates

`calls(p)` entry point returning `CallRuleBuilder`. Call predicates: `onObject(name)`, `withMethod(nameOrRegex)`, `withArgMatching(index, pattern)`, `withStringArg(index, glob)`, `haveCallbackContaining(predicate)`. Critical for framework-agnostic route/handler matching. Spec Section 5.5.

---

### 0015. Named Selections, `within()` & Scoped Rules

Lazy named selections — save predicate chains for reuse across rules. `within()` for scoping rules to a context (e.g., "within route handlers, enforce X"). Performance: restricts search space to matched callbacks. Spec Sections 4.4, 4.4 (within).

---

### 0016. Baseline Mode & Diff-Aware Mode

Baseline: `npx ts-archunit baseline --output arch-baseline.json`, `--baseline` flag on check. Records violations, only fails on new ones. Fuzzy line matching. Diff-aware: `--changed` flag, evaluates full project but reports only on `git diff` changed files. Programmatic API: `withBaseline()`, `check({ baseline })`. Spec Sections 11.4, 11.5.

---

### 0017. Pattern Templates & `definePattern` / `followPattern`

`definePattern(name, { returnShape })` for encoding team conventions as reusable shapes. `.followPattern()` condition. Spec Section 7.3.

---

### 0018. Smell Detectors: Duplicate Bodies & Inconsistent Siblings

`smells.duplicateBodies()` — AST similarity detection with configurable threshold. `smells.inconsistentSiblings()` — flags odd-one-out in same-folder files. Guardrails: `minLines`, `ignoreTests`, `ignorePaths`, `groupByFolder`, `withMinSimilarity`. Default to `.warn()`. Spec Section 8.

---

### 0019. Output Formats: JSON, GitHub Annotations

JSON output for CI integration. GitHub Actions annotation format for inline PR comments. `--format` flag. Spec Section 12.3.

---

### 0020. CLI Standalone Runner & Watch Mode

`npx ts-archunit check arch.rules.ts` — standalone execution without test runner. `--watch` mode. Optional `ts-archunit.config.ts` with `defineConfig()`. Spec Sections 11.2, 11.3.

---

### 0021. GraphQL Extension: Schema & Resolver Rules

Separate entry point: `ts-archunit/graphql`. Schema loader for `.graphql` files + programmatic SDL. `schema()` and `resolvers()` entry points. Schema predicates: `queries()`, `mutations()`, `typesNamed()`, `returnListOf()`. Resolver conditions reuse body analysis engine. Optional dependency on `graphql` package. Spec Section 9.

---

### 0022. Cross-Layer Validation

`crossLayer(p)` for consistency checks across architectural boundaries (routes ↔ SDK types ↔ OpenAPI schemas). User-provided mappings. `.forEachPair().should()` API. Hardest extension. Spec Section 10.
