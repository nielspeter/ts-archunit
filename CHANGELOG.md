# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Roadmap foundations F1–F4 and proposals 017/016/014 (see `plans/ai-era-product-direction.md`). All new/changed public API is additive except the ⚠️ breaking behavior changes noted below.

### Added

- **`correspondence(p)`** — a coverage/relation primitive: `.side(name, selection, keyFn)` | `.side(name, keys)`, then `.beComplete()` / `.haveNoOrphans()` / `.beBijective()` (+ `.allowEmpty()`, `.distinctKeysOn()`). Compares two independently-derived key sets by identity (never count); an empty side fails (ADR-008). keyFn vocabulary `byName` / `byArg` / `byPropertyNames`; low-level `setCorrespondence()` core. (Proposal 017, plans 0064/0065.)
- **`RuleBuilder.subjects()`** — materialize the post-`.that()` filtered subject set (F1); **`.expectNonEmpty()`** — opt-in non-vacuity guard: an empty selector fails instead of passing vacuously. (Plans 0064/0067.)
- **`functions(p, { includeObjectLiteralFunctions })`** — opt-in (default off) collection of object-literal function values (`{ GET: () => {} }`), named by qualified key path; shared `collectObjectLiteralFunctions` traversal. First options object on `functions()`. (Proposal 016, plan 0066.)
- **`ArchViolation.bypassFilters`** — config-level meta-findings (empty selector/discovery) now survive diff-aware and baseline filtering. (Plan 0067.)

### Changed (⚠️ BREAKING — empty discovery now fails instead of passing)

- **`slices().matching()` / `.assignedFrom()`** that resolve to no slices (or slices with no files) now **fail** with a discovery meta-finding, where they previously passed vacuously. Fix the glob (globs match absolute paths — use `**/src/*`, not `src/*`).
- **`crossLayer` `haveMatchingCounterpart`** now **fails** when the left layer matched zero files (was a vacuous pass). Reconciled onto the shared `setCorrespondence` core; non-empty behavior is unchanged.
- **`strictBoundaries`** now emits a `preset/boundaries/discovery` failure when the `folders` glob matches no boundaries, instead of silently generating zero rules.

Migration: a mis-globbed layer/boundary/slice that was silently green will now go red — correct the glob (usually add the `**/` prefix). These findings bypass diff/baseline, so they surface even in PR-only CI.

### Fixed

- `docs/functions.md` overclaimed "every function shape"; corrected to "every _named_ function shape" (a live zero-subject false-green for object-literal handler maps).

## [0.17.0] - 2026-07-14

### Added

- **`ts-archunit init` scaffolds the shape presets** — `--preset layered` | `strict-boundaries` | `data-layer` now generate an `arch.rules.ts` that spreads the `recommended` floor **plus** the chosen shape preset, pre-filled with folder globs (derived from your source root) and a one-line "edit these to your project" note. Unblocked by the returning-form migration (0062); completes the preset family on the `init` golden path. (Plan 0062, Phase 5.)

## [0.16.0] - 2026-07-14

### Changed

- **⚠️ ACTION REQUIRED (BREAKING) — shape presets now RETURN rules instead of throwing.** `layeredArchitecture`, `strictBoundaries`, and `dataLayerIsolation` now return `RuleBuilderLike[]` (like `recommended` / `agentGuardrails`) instead of `void`-and-throwing. **A bare `layeredArchitecture(p, {...})` call no longer fails your test — it silently enforces nothing. You must update every call.** Migrate: spread into a rule file (`export default [...layeredArchitecture(p, opts)]`), or in a test add `import { checkAll } from '@nielspeter/ts-archunit'` and wrap it: `checkAll(layeredArchitecture(p, opts))` (see [Running Rules in Tests](https://nielspeter.github.io/ts-archunit/running-in-tests)). This makes every preset composable on the CLI golden path, fixes `arch:baseline` crashing on a shape preset, and routes their `warn`-default rules (`type-imports-only`, `no-duplicate-bodies`) through the severity pipeline instead of dropping them to `console.warn`. `dispatchRule` and `throwIfViolations` are removed from `@nielspeter/ts-archunit/presets`.

### Added

- **`checkAll(rules, options?)`** — a test-file terminal for an array of rules (e.g. a spread preset): runs them all and throws one aggregated `ArchRuleError` on any error-severity violation; warns are reported but never fail. Exported from `@nielspeter/ts-archunit`. (Plan 0062.)

### Docs

- **Documentation restructured around a golden path** — one reconciled workflow (CLI rule file as the default, test files as a co-equal alternative with a conversion guide), a new Getting Started, Setup & Best Practices, Running Rules in Tests, and Troubleshooting, a four-tier IA (Introduction / Guide / Rule Catalog / Reference), and the galleries merged. (Plan 0061.)

## [0.15.0] - 2026-07-13

### Added

- **`tsconfig(p)` config-assertion rule** — assert a project's resolved TypeScript compiler options with `.requires(spec: Partial<CompilerOptions>)`. A flat top-level entry point (like `project` / `smells`) returning a `TerminalBuilder`, so it composes with `.because()` / `.rule()` / `.excluding()` / `.asSeverity()` / `.check()` / `.warn()` / baseline / diff. Mirrors tsc's strict-family resolution (`strict: true` implies its nine sub-flags — `strictNullChecks`, `strictBuiltinIteratorReturn`, etc. — with explicit overrides winning), resolves `extends`, deep-compares array/object options, and renders enum-backed options (`target`, `module`, `moduleResolution`) by name in messages. One violation per mismatched flag (flag name is the `element`). Exported from `@nielspeter/ts-archunit`. (Plan 0055.)

## [0.14.0] - 2026-07-13

### Added

- **`ts-archunit init` CLI scaffolder** — one command generates a working setup: a discoverable `ts-archunit.config.ts`, an `arch.rules.ts` that spreads a returning-form preset (`--preset recommended` (default) | `agent-guardrails`), an empty `arch-baseline.json`, and `arch` / `arch:baseline` npm scripts. Detects the source root from tsconfig `include`/`rootDir` and threads it into the preset `include`. Non-destructive by default (`--force` to overwrite, `--dry-run` to preview); `--tsconfig` and `--no-baseline` supported. Shape presets are excluded from v1 (no returning form). Brownfield-aware closing message (errors fail CI, warnings don't; baseline before gating CI). (Plan 0050.)

## [0.13.0] - 2026-07-13

### Added

- **`recommended(p, options?)` preset** — a deliberately thin, universal safety floor for any TypeScript project: `functionNoEval` + `functionNoFunctionConstructor` (error), `functionNoSilentCatch` + `noEmptyBodies` (warn). Returns severity-carrying builders (`export default [...recommended(p)]`); ids `preset/recommended/*`; opt-in-ladder severity via `overrides`. Exported from `@nielspeter/ts-archunit/presets`. Overlaps `agentGuardrails` on empty-bodies + eval. (Plan 0049.)
- **`agentGuardrails(p, options)` preset** — a one-liner bundling the mistakes AI coding agents make most often (inline logic, generic errors, stub comments, empty bodies, copy-paste). Returns severity-carrying builders (`export default [...agentGuardrails(p, { … })]`); each rule carries agent-facing `because` / `suggestion` / `imperative` metadata. Exported from `@nielspeter/ts-archunit/presets`. (Plan 0044.)
- **`explain --format agent`** — emits an imperative "Do NOT … / MUST …" markdown block for AI-agent system prompts / project instructions, with a check-in-loop preamble and `<!-- ts-archunit:start/end -->` sentinel markers for idempotent updates. Backed by a new optional `imperative` field on `RuleMetadata` / `RuleDescription` (with a heuristic fallback). See the new **AI Agents** guide.
- **`codeFrame` in `check --format json`** — each violation now includes the source snippet, so an agent can locate it without re-reading the file.
- **Rule severity in the CLI** — `.asSeverity('error' | 'warn')`, a non-terminal builder method that marks a rule's severity _without_ executing it, so severity-carrying builders can be collected into a rule file's `export default` array. `check` reports **warn**-severity violations but they never fail the run; only **error**-severity violations set a non-zero exit. `ArchViolation` gains an optional `severity` field. (Plan 0060.)
- **Single-document, severity-aware `check --format json`** — the JSON output is now one document for the whole run (previously one blob per rule, which was not valid JSON for multi-rule files), and it is **always emitted, even on a clean run** (`{ "summary": { "total": 0, … }, "violations": [] }`) so consumers can parse the success case. Each violation carries `severity`; the summary reports `{ total, errors, warnings, reason }`. Intended for CI tooling and AI coding agents that consume the JSON to self-correct.
- **`check --format github` respects severity** — warn-severity violations render as `::warning` annotations (previously every violation was emitted as `::error`).
- **`check` runs preset-returning rule files** — a rule file can `export default [...myPreset(p)]` where the preset returns severity-carrying builders. A file that instead self-executes a throwing preset at import is handled by a best-effort catch (error-severity only).

### Fixed

- **Rule metadata now reaches per-violation output** — `.because()` and `.rule({ because, suggestion, docs })` previously flowed only to `explain` and the error header, never to individual violations, so `check --format json` returned `suggestion: null` even when the author set one. Per-violation `because` / `suggestion` / `docs` now fall back to the rule metadata when the condition sets none (per-violation values still take precedence). This affects **all** output formats — terminal, `github`, and `json` — and in-test `.check()` / `.warn()`, not only the CLI: violation output now includes the author's `Fix:` / `Docs:` lines where it didn't before. Snapshot tests or log-parsers keyed on the old violation text may need updating.

### Changed

- **`check` collects `.violations()` instead of calling `.check()` per builder** — it gathers every builder's violations into one unified list, then filters / formats / exits once. Single-rule behavior is unchanged; multi-rule `--format json` is now a single valid document. `collectViolations()` (used by `baseline`) likewise switched to `.violations()`.

## [0.12.0] - 2026-07-03

### Added

- **`jsxText()` matcher** — detects hardcoded JSX text content: `JsxText` children of JSX elements (`<button>Save</button>`), plus expression-wrapped literals (`<div>{"Save"}</div>` and ``<div>{`Save`}</div>``). Skips inter-element whitespace, dynamic expressions (`{count}`, `{t("save")}`), templates with substitution, and attribute values (braced or quoted) — those remain the domain of the `jsxElements()` entry point. Composes with `notContain()` for i18n enforcement. Takes no options and bakes in no letter filter — scope with folder/file predicates or `.excluding(...)`. Complements the existing `jsxElement()` matcher.

## [0.11.0] - 2026-06-13

### Added

- **`calls().identifiedByArg(index)`** — opt-in builder method that folds a string-literal argument into the violation `element` and `message`, so identity-keyed registrations (HTTP routes, event handlers, command names, registry entries, DI tokens, migration ids, etc.) can be excluded individually rather than only by file. Default behavior unchanged. The element field preserves the literal verbatim (exclusion stability); rendered violation messages elide the middle of literals longer than 80 characters. Predicates continue to see the bare callee — use `withStringArg(i, glob)` or `withArgMatching(i, pattern)` to filter by argument value. See proposal 011 / plan 0057 for the design, the 8-case generic-pattern table, and the edge-case behavior matrix.

## [0.10.0] - 2026-04-17

### Added

- **`typeAssertion()` and `nonNullAssertion()` matchers** — compose with any body-analysis entry point (`classes`, `functions`, `modules`, `within()`). `typeAssertion()` matches both `as Type` AND `<Type>value` angle-bracket forms. `typeAssertion({ allowConst: false })` bans `as const` too; default `true` allows `as const` as idiomatic literal preservation.
- **Function and module variants of the TypeScript rules** — `functionNoTypeAssertions()`, `functionNoNonNullAssertions()`, `moduleNoTypeAssertions()`, `moduleNoNonNullAssertions()` exported from `@nielspeter/ts-archunit/rules/typescript`. Mirror the class/function/module family pattern used by `rules/security.ts` and `rules/errors.ts`.

### Breaking

Two user-visible behavior changes to `noTypeAssertions()` / `noNonNullAssertions()`:

- **Scope widened** — they now scan constructors, getters, and setters in addition to methods. This is a bug fix (matches the scope of `noSilentCatch()`), but existing codebases with a clean baseline will see new violations for assertions inside ctors/getters/setters. **Action:** regenerate your baseline (`npx ts-archunit baseline`) before upgrading to absorb the new coverage.
- **Violation message format changed** — from `${Class}.${method} uses type assertion — use type guards instead` to `${Class} contains type assertion at line N`. Consistent with every other rule in `rules/security.ts` and `rules/errors.ts`.
  - If you use `.excluding('UserService.load')` with the `Class.method` format, those exclusions will no longer match. Migration options:
    - **Class-wide (over-broad):** `.excluding('UserService')` — exempts every method in the class
    - **Method-precise:** use inline `// ts-archunit-exclude` comments on the specific lines, OR file+line-based exclusion patterns
  - Add `.because('use type guards instead')` to restore the actionable hint in violation output.
  - Snapshot tests and log-parsers keyed to the old message format will need updates.

### Changed

- `rules/typescript.ts` refactored from custom `evaluate()` logic to matcher composition — ~60 LOC removed, aligns with the pattern used across the rest of `rules/`.

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
