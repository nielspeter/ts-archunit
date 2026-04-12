# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.9.0] - 2026-04-12

### Added

- **`jsxElements(p)` entry point** — new rule builder for JSX element architecture rules. Operates on `JsxElement` and `JsxSelfClosingElement` nodes across all `.tsx`/`.jsx` files. Enforces design system compliance, accessibility attributes, and structural JSX conventions.
- **`ArchJsxElement` model** — wraps JSX elements with `getName()`, `isHtmlElement()`, `isComponent()`, `hasAttribute()`, `getAttribute()`, `getAttributeNames()`, `hasChildren()`. Dot-notation tags (`motion.div`, `Icons.Check`) are always classified as components. Spread attributes safely skipped via `Node.isJsxAttribute()` type predicate.
- **`STANDARD_HTML_TAGS` constant** — array of all standard HTML tag names per the WHATWG HTML Living Standard. Use with `areHtmlElements(...STANDARD_HTML_TAGS)` for unambiguous "all standard HTML" matching that excludes custom elements and dot-notation components.
- **JSX predicates:** `areHtmlElements(...tags)` (requires at least one tag), `areComponents(...names?)`, `withAttribute(name)`, `withAttributeMatching(name, value)`. Distinct `with*` naming for predicates avoids dual-use confusion with conditions.
- **JSX conditions:** `notExist()`, `haveAttribute(name)`, `notHaveAttribute(name)`, `haveAttributeMatching(name, value)`, `notHaveAttributeMatching(name, value)`. Violations delegate to core `createViolation()` for code frames. Distinguishes absent, valueless, and wrong-value attributes in messages.
- **`jsxElement(tag)` body-analysis matcher** — `ExpressionMatcher` targeting JSX elements by tag name (string or regex). Integrates with existing `notContain()`/`contain()` on `functions()`, `modules()`, `classes()` entry points.
- **`JsxRuleBuilder`** — extends `RuleBuilder<ArchJsxElement>` with identity predicates (`haveNameMatching`, `resideInFile`, `resideInFolder` — predicate-only, following `CallRuleBuilder` pattern), JSX-specific predicates, and JSX conditions.
- **Documentation:** `docs/jsx.md` (full JSX rules page with tag classification, attribute access, predicate/condition naming rationale, `jsxElement()` matcher, `STANDARD_HTML_TAGS`, `.excluding()` incremental adoption, known limitations). Updated `getting-started.md`, `what-to-check.md`, `api-reference.md`, `recipes.md` (Design System Compliance recipe).

## [0.8.0] - 2026-04-12

### Added

- **`workspace(tsConfigPaths)`** — load multiple tsconfigs into a unified project for monorepo-aware dead-code and unused-export detection. Returns a standard `ArchProject` so all existing entry points and conditions work unchanged. Paths are sorted for deterministic compiler-option selection. Cached per unique set of tsconfigs; `resetProjectCache()` clears both caches.
- **`dependOn(...globs)`** — new condition asserting a module imports from at least one path matching the given globs. Completes the import-condition family alongside `onlyImportFrom` (all) and `notImportFrom` (none). Supports `{ ignoreTypeImports }` for consistency with the family.
- **`silent(pattern)`** — wrapper for `.excluding()` patterns that suppresses the "unused exclusion" warning. Designed for intentionally broad patterns shared across monorepo workspaces where not every workspace triggers every pattern.
- **Dynamic `import()` detection** — `beImported()` and `noDeadModules()` now resolve dynamic `import()` expressions with string-literal and no-substitution template-literal specifiers. Handles `.js→.ts`, `.jsx→.tsx`, `.mjs→.mts` ESM extension mapping and `/index.ts` directory imports.

### Fixed

- ESLint config now ignores `dist/`, `coverage/`, and `docs/.vitepress/` build artifacts, preventing `npx eslint .` failures on generated files.

### Changed

- Reduced cognitive complexity in 7 functions by extracting helpers: `indexStaticImports`, `indexReExports`, `indexDynamicImports` (reverse-dependency), `formatSingleViolation` (format), `handleBlockEnd`, `handleBlockStart`, `handleSingleLine` (exclusion-comments), `passesFileFilters`, `meetsMinLines` (duplicate-bodies), `partitionByPattern`, `buildFolderViolations` (inconsistent-siblings), `handleCheck`, `handleBaseline`, `handleExplain` (CLI).
- Removed 23 unnecessary non-null assertions (`!`) across the codebase, replaced with proper narrowing guards and `?? default` patterns (ADR-005 compliance).
- Merged duplicate imports in `fingerprint.ts`, `schema-rule-builder.ts`.
- Added `readonly` to `_predicates`/`_conditions` in GraphQL rule builders.
- Replaced `localeCompare` sort with locale-independent codepoint ordering where determinism across OS locales matters.
- Added `noSilentCatch` documentation to `standard-rules.md` and `api-reference.md` (was missing since v0.7.2).

## [0.7.2] - 2026-04-02

### Added

- **`noSilentCatch()`, `functionNoSilentCatch()`, `moduleNoSilentCatch()`** (plan 0045) — detect catch blocks that don't reference the caught error variable. Catches silent error swallowing: `catch { return fallback }`, `catch (err) { throw new AppError('failed') }`. Handles simple bindings, object/array destructured bindings. Class variant scans methods, constructors, getters, and setters. New `src/conditions/catch-analysis.ts` with `findSilentCatches()` core detection.

### Fixed

- **BUG-0008: `.excluding()` now works with `satisfy()` conditions.** `getElementName()` resolves inner AST nodes (e.g., `AsExpression`, `CallExpression`) to their nearest enclosing class/method/function, producing qualified names like `MyService.doWork` instead of raw AST kind names. This makes `.excluding('MyService')` and `.excluding('MyService.doWork')` work as expected for all conditions, including `noTypeAssertions()`, `noNonNullAssertions()`, and custom `createViolation()` calls.
- **Element names now include constructors, getters, setters, and property initializers.** `getElementName()` handles `ConstructorDeclaration` (→ `ClassName.constructor`), `GetAccessorDeclaration`, `SetAccessorDeclaration`, and `PropertyDeclaration` (→ `ClassName.propName`). Arrow functions and function expressions assigned to variables are also resolved (→ `handlerName`).

### Changed

- Refactored `getElementName()` into three focused helpers: `getNodeName()` (direct name extraction), `getStructuralName()` (member-level identity for ancestor walking), `isTopLevelDeclaration()` (walk boundary detection). No public API changes.

## [0.7.1] - 2026-03-30

### Changed

- Reduced cognitive complexity in 8 functions by extracting helpers: `applyTypeImportRules`, `applyRestrictedPackages`, `applySharedIsolation`, `applyTestIsolation`, `addToGraph`, `findUnusedExportsInFile`, `matchPropertyValue`, `matchPropertyName`, `collectEdgesFromFile`, `scanParametersForType`, `collectByKind`, `collectBroad`, `collectModuleScopeMatches`
- Eliminated nested template literals in `call.ts`, `dependency.ts`, `members.ts`, `reverse-dependency.ts` by extracting to variables
- Merged duplicate imports in `cross-layer.ts`, `function-rule-builder.ts`
- Added `readonly` to `_exclusions` in `TerminalBuilder` and `_conditions` in `SliceRuleBuilder`
- Used `this` return type in `CrossLayerBuilder.layer()`
- Reworded JSDoc in `matchers.ts` and `hygiene.ts` to avoid false-positive SonarLint stub-comment warnings

## [0.7.0] - 2026-03-30

### Added

- **Architecture rule primitives** (plan 0041) — phase-aware builders with dual-use predicate/condition dispatch based on `.that()` / `.should()` context. Methods `notImportFrom`, `resideInFile`, `resideInFolder`, `haveNameMatching`, `extend`, `implement`, `haveMethodNamed` now work in both phases across 4 builders.
- **Module body analysis** — `modules().should().notContain()` / `contain()` / `useInsteadOf()` with `{ scopeToModule: true }` option for top-level-only scanning.
- **Export conditions** — `notHaveDefaultExport()`, `haveDefaultExport()`, `haveMaxExports(n)` on module builder.
- **Reverse dependency conditions** — `onlyBeImportedVia(...globs)`, `beImported()`, `haveNoUnusedExports()` with cached reverse import graph.
- **Stub detection** — `comment()` matcher, `STUB_PATTERNS` constant, `notHaveEmptyBody()` on functions and classes.
- **19 standard rule variants** (plan 0042):
  - Function variants: `functionNoEval`, `functionNoFunctionConstructor`, `functionNoProcessEnv`, `functionNoConsoleLog`, `functionNoConsole`, `functionNoJsonParse`, `functionNoGenericErrors`, `functionNoTypeErrors`
  - Module variants: `moduleNoEval`, `moduleNoProcessEnv`, `moduleNoConsoleLog`
  - New class rules: `noConsole` (all console methods), `noJsonParse`
  - Architecture primitives: `mustCall(pattern)`, `classMustCall(pattern)` — positive body assertion
  - Hygiene rules: `noDeadModules()`, `noUnusedExports()`, `noStubComments(pattern?)`, `noEmptyBodies()`
  - Sub-path exports: `./rules/architecture`, `./rules/hygiene`
- **3 architecture presets** (plan 0040):
  - `layeredArchitecture(p, options)` — layer ordering, cycle detection, innermost isolation, type-import enforcement, restricted packages
  - `dataLayerIsolation(p, options)` — base class extension, typed error enforcement
  - `strictBoundaries(p, options)` — no cycles, no cross-boundary imports, shared isolation, test isolation, copy-paste detection
  - Override system: per-rule severity (`'error'`, `'warn'`, `'off'`)
  - Sub-path export: `./presets`
- **`.violations()` terminal** on `RuleBuilder` and `TerminalBuilder` — returns violations without throwing for programmatic access and preset aggregation.
- **`dispatchRule()` + `throwIfViolations()`** — aggregated error reporting across multiple preset rules.
- **`ts-archunit explain` CLI subcommand** (plan 0043) — dumps active rules as JSON or markdown table via `.describeRule()` without executing them. Supports `--markdown` flag.
- **`.describeRule()` method** on `RuleBuilder` and `TerminalBuilder` — metadata extraction without rule execution.
- **3 new VitePress doc pages** — presets guide, architecture recipes, explain command reference.
- **Comprehensive documentation overhaul** — added explanatory descriptions to 45+ sections across 18 doc files. Every section now explains what the feature does and why before showing code.
- **36 dogfooding rules** — ts-archunit enforces its own architecture with function/module security rules, hygiene checks, preset isolation, and export hygiene.
- 7 deprecated aliases for backwards compatibility: `notImportFromCondition`, `shouldResideInFile`, `shouldResideInFolder`, `conditionHaveNameMatching`, `shouldExtend`, `shouldImplement`, `shouldHaveMethodNamed`.

## [0.6.0] - 2026-03-28

### Added

- **Type-import awareness** (plan 0038) — `notImportFrom`, `onlyImportFrom`, `importFrom`, and `notImportFrom` predicates now accept `{ ignoreTypeImports: true }` via `ImportOptions`. Type-only imports (`import type { X }` and `import { type X, type Y }`) are excluded from violation checks. Builder methods: `notImportFromConditionWithOptions`, `onlyImportFromWithOptions`, `importFromWithOptions`, `notImportFromWithOptions`.
- **`within()` object literal callback extraction** (plan 0039) — `extractCallbacks()` now searches object literal arguments for function-valued properties (arrow functions, function expressions, method shorthands). Depth-limited to 3 levels. Enables `within(routes).functions()` for Fastify-style `{ handler: (req) => { ... } }` patterns.
- **`isTypeOnlyImport(decl)`** utility — shared helper for checking if an import is purely type-only. Exported for custom condition authors.
- **`ImportOptions`** type — exported for custom condition/predicate authors.

### Fixed

- **`expression()` ancestor deduplication** (plan 0037) — `expression()` matcher no longer reports violations for every ancestor node whose `getText()` contains the pattern. Only the deepest matching node is reported. **Note:** existing rules using `expression()` will see lower violation counts (e.g., 189 → 13 for a real-world case). Update baseline files or count assertions accordingly.
- **`onlyHaveTypeImportsFrom` now handles `import { type X, type Y }`** — previously only checked declaration-level `import type`, now uses the shared `isTypeOnlyImport` helper for consistent behavior.

## [0.5.0] - 2026-03-28

### Added

- **`property()` ExpressionMatcher** (plan 0036) — match `PropertyAssignment` nodes by name (`string | RegExp`) and optional value (`boolean | number | string | RegExp`). Semantic comparison for primitives via `getLiteralValue()`, `RegExp` escape hatch for raw text. Handles quoted property keys, guards against computed property names.
- **`haveArgumentContaining(matcher)` / `notHaveArgumentContaining(matcher)`** (plan 0036) — 2 new conditions on `calls()` that recursively search all argument subtrees with any `ExpressionMatcher`. Superset of `haveCallbackContaining` — searches object literals, callbacks, and nested expressions at any depth.
- Builder methods `haveArgumentContaining()` / `notHaveArgumentContaining()` on `CallRuleBuilder`
- Standalone exports `callHaveArgumentContaining` / `callNotHaveArgumentContaining` for advanced composition

## [0.4.0] - 2026-03-27

### Added

- **Unified combinators** — `not()`, `and()`, `or()` now accept both `Predicate<T>` objects and `TypeMatcher` functions, dispatching based on input type
- **Aliased import condition** (plan 0035) — 1 new condition on `modules()`:
  - `notHaveAliasedImports()` — detect `import { x as y }` aliased named imports
- Architecture rule: `core must not import from helpers`

### Removed

- `notType` export — use `not()` directly, which now handles both predicates and type matchers

### Fixed

- BUG-0007: `not(matching(...))` now works with `haveReturnTypeMatching()` and all TypeMatcher-accepting conditions

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
- `types(p)` — type rules for interfaces and type aliases, with type matchers (`isString`, `isUnionOfLiterals`, `not`, etc.) and `havePropertyType` condition
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
