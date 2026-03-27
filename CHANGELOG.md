# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-03-27

### Added

- **Member property conditions** (plan 0030) — 6 new conditions on `types()` and `classes()`:
  - `havePropertyNamed(...names)` / `notHavePropertyNamed(...names)` — assert property name existence
  - `havePropertyMatching(pattern)` / `notHavePropertyMatching(pattern)` — assert property names by regex
  - `haveOnlyReadonlyProperties()` — assert all properties are readonly (supports `Readonly<T>` mapped types)
  - `maxProperties(n)` — assert property count limit
- **Parameter type conditions** (plan 0031) — 2 new conditions on `classes()` and `functions()`:
  - `acceptParameterOfType(matcher)` / `notAcceptParameterOfType(matcher)` — assert parameter types using TypeMatcher
  - Class version scans constructor + methods + set accessors
- **Visibility predicates** (plan 0032) — 3 new predicates on `functions()`:
  - `arePublic()` / `areProtected()` / `arePrivate()` — filter by member visibility
  - `getScope()` added to ArchFunction interface
- **Return type condition** (plan 0033) — 1 new condition on `functions()`:
  - `haveReturnTypeMatching(matcher)` — assert return type using TypeMatcher (composable with `isString()`, `matching()`, `not()`, etc.)
- **Call argument conditions** (plan 0034) — 2 new conditions on `calls()`:
  - `haveArgumentWithProperty(...names)` / `notHaveArgumentWithProperty(...names)` — assert object literal argument properties
- `PropertyBearingNode` type exported for custom condition authors

### Changed

- Package renamed from `ts-archunit` to `@nielspeter/ts-archunit` — all import paths updated

### Removed

- `ts-archunit/rules/dependencies` sub-path export — `onlyDependOn`, `mustNotDependOn`, `typeOnlyFrom` were pure aliases of `onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom`. Use the core primitives directly.

### Fixed

- BUG-0002: Property name checking no longer requires custom `defineCondition`
- BUG-0003: Constructor/function parameter type checking no longer requires body string matching
- BUG-0004: Multi-tenant method parameter checking composable via `arePublic()` + `acceptParameterOfType()`
- BUG-0005: Method return type checking no longer requires 30-line custom conditions
- BUG-0006: Call argument property checking no longer requires 40-line AST traversal

## [0.2.0] - 2026-03-26

### Added

- Function signature predicates (plan 0029):
  - `haveRestParameter()` — matches functions with `...args` parameters
  - `haveOptionalParameter()` — matches functions with optional or default-valued parameters
  - `haveParameterOfType(index, matcher)` — type-checks parameter at position using TypeMatcher
  - `haveParameterNameMatching(regex)` — matches parameter names by pattern
- Builder methods on `FunctionRuleBuilder` for all 4 new predicates
- Dogfooding architecture rule: module predicates must not accept single `glob` parameter
- `.notImportFrom()` and `.importFrom()` now accept multiple globs (variadic)

### Fixed

- `.excluding()` now matches against `violation.element`, `violation.file`, and `violation.message` (was element-only, BUG-0001)
- `.notImportFrom('fastify', 'knex', 'bullmq')` no longer silently ignores arguments 2+

## [0.1.0] - 2026-03-26

### Added (post-v1: plans 0027, 0028)

- CLI watch mode: `npx ts-archunit check --watch` / `-w` — debounced file watcher with automatic re-run
- `watchDirs` config option for `defineConfig()` — configure which directories to watch
- `resetProjectCache()` — clear the project singleton cache (for watch mode and tests)
- `ts-archunit/rules/metrics` — metric-based standard rules:
  - `maxCyclomaticComplexity(n)`, `maxClassLines(n)`, `maxMethodLines(n)`, `maxMethods(n)`, `maxParameters(n)` (class-level)
  - `maxFunctionComplexity(n)`, `maxFunctionLines(n)`, `maxFunctionParameters(n)` (function-level)
- Metric predicates: `haveCyclomaticComplexity`, `haveComplexity`, `haveMoreLinesThan`, `haveMoreFunctionLinesThan`, `haveMoreMethodsThan`
- `cyclomaticComplexity()` and `linesOfCode()` helpers exported for custom metric rules
- `docs/cli.md` — full CLI documentation page
- `docs/metrics.md` — full metrics documentation page

### Fixed (post-v1)

- `.excluding()` now matches against `violation.element`, `violation.file`, and `violation.message` (was element-only). Fixes BUG-0001: `defineCondition` violations can now be excluded by file path or message content.

### Added

- `project('tsconfig.json')` — load a TypeScript project with singleton caching
- `modules(p)` — module-level rules with dependency conditions (`onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom`)
- `classes(p)` — class rules with predicates (`extend`, `implement`, `haveDecorator`, `areAbstract`, etc.) and conditions (`shouldExtend`, `shouldHaveMethodNamed`, etc.)
- `functions(p)` — function rules supporting both `function` declarations and `const` arrow functions, with predicates (`areAsync`, `haveParameterCount`, `haveReturnType`, etc.)
- `types(p)` — type rules for interfaces and type aliases, with type matchers (`isString`, `isUnionOfLiterals`, `notType`, etc.) and `havePropertyType` condition
- `slices(p)` — slice-level rules with `matching()` and `assignedFrom()`, conditions: `beFreeOfCycles`, `respectLayerOrder`, `notDependOn`
- Body analysis: `call()`, `newExpr()`, `access()`, `expression()` matchers with `contain()`, `notContain()`, `useInsteadOf()` conditions
- Identity predicates: `haveNameMatching`, `resideInFile`, `resideInFolder`, `areExported`, etc.
- Custom rules: `definePredicate()`, `defineCondition()`, `.satisfy()`
- Violation reporting with code frames, ANSI colors, `.check()` / `.warn()` / `.severity()`
- Named selections for reusable predicate chains

### Fixed

- Runtime warning when `.check()` is called with predicates but no conditions (prevents silent no-op rules)
- `.check()` now honors `format: 'json'` option (previously only `.warn()` did)
- `.check()` now prints rich format (Why/Fix/Docs) to stderr before throwing
- Duplicate Reason/Suggestion lines removed from terminal violation output
- `diffAware()` error fallback no longer silently suppresses all violations
- Inline exclusion comments (`// ts-archunit-exclude`) now work across all builder types
- `.excluding()` API available on all builders (GraphQL, cross-layer, smell detectors)
- Shell injection vulnerability fixed in `diffAware()` — uses `execFileSync` instead of shell interpolation
- `FORCE_COLOR=0` correctly disables color output (previously enabled it)
- `extendType()` predicate uses word-boundary matching to avoid false positives
- Slice violation line numbers now point to the actual import declaration
- Baseline file loading validates JSON structure instead of unsafe cast
- `fork()` preserves `.because()` reason across `.should()` boundary
