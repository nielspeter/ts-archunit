# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-03-26

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
