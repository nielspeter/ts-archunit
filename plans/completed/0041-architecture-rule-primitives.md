# Plan 0041: Architecture Rule Framework Primitives

## Status

- **State:** Done
- **Priority:** P1 — Closes framework gaps that block expressing common architecture rules
- **Effort:** 2.5 days
- **Created:** 2026-03-30
- **Completed:** 2026-03-30
- **Depends on:** 0011 (Body Analysis), 0007 (Modules)

## Context

The 34 architecture rules from real-world evaluation (layer enforcement, logic placement, boundary control, export conventions) exposed gaps in the framework layer. These are rules that any architecture testing tool must support, but ts-archunit currently lacks the primitives to express them.

**Layer 1 vs Layer 2:** This plan adds generic framework primitives — the building blocks. Plan 0042 adds pre-built rules on top. Plan 0040 composes both into presets.

### Five gaps

| Gap                    | What's blocked                                                                               | Example rule                                               |
| ---------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Builder phase tracking | Natural condition names — every user writes `.should().notImportFrom()` and gets a predicate | `modules(p).should().notImportFrom('**/repos/**')`         |
| Module body analysis   | Module-scope rules — no env access, no console.log, no eval outside classes/functions        | `modules(p).should().notContain(access('process.env'))`    |
| Export conditions      | Export conventions — no default exports, max exports per file                                | `modules(p).should().notHaveDefaultExport()`               |
| Reverse dependency     | Barrel/facade enforcement, dead code detection                                               | `modules(p).should().onlyBeImportedVia('**/index.ts')`     |
| Stub/comment detection | AI agents leave TODO/FIXME/stubs — no way to scan comments or detect empty bodies            | `functions(p).should().notContain(comment(STUB_PATTERNS))` |

## Phase 1: Builder phase tracking (0.5 day)

### Problem

The `RuleBuilder` uses a single class for both `.that()` (predicate) and `.should()` (condition) phases. When a method name exists as both predicate and condition, the builder needs different names:

| Predicate (after `.that()`) | Condition (after `.should()`) | Convention |
| --------------------------- | ----------------------------- | ---------- |
| `notImportFrom()`           | `notImportFromCondition()`    | suffix     |
| `resideInFolder()`          | `shouldResideInFolder()`      | prefix     |
| `haveNameMatching()`        | `conditionHaveNameMatching()` | prefix     |
| `extend()`                  | `shouldExtend()`              | prefix     |
| `implement()`               | `shouldImplement()`           | prefix     |
| `haveMethodNamed()`         | `shouldHaveMethodNamed()`     | prefix     |

Three different naming conventions for the same problem. Every user who writes `.should().notImportFrom()` gets a predicate added silently (caught by the warning at rule-builder.ts:252, but only at runtime).

### Solution: phase-aware dispatch

Add a `_phase` field to `RuleBuilder`. The `.should()` fork sets `_phase = 'condition'`. Dual-use methods check `_phase` and dispatch to the correct underlying predicate or condition.

```ts
// src/core/rule-builder.ts
protected _phase: 'predicate' | 'condition' = 'predicate'

that(): this {
  this._phase = 'predicate'  // explicit reset — defensive against .should().that() misuse
  return this
}

should(): this {
  const fork = this.fork()
  fork._phase = 'condition'
  return fork
}
```

**`that()` explicitly resets phase.** Previously `that()` was a pure no-op. With phase tracking, it must set `_phase = 'predicate'` defensively. Nobody would write `.should().that()` intentionally, but phase tracking introduces real mutable state where these methods were previously syntactic sugar.

**`satisfy()` bypasses phase tracking.** The `satisfy()` method uses structural dispatch (`'test' in custom` → predicate, `'evaluate' in custom` → condition). This is correct — `satisfy()` already knows the type. Phase tracking only affects the dual-use builder methods.

Then in each builder, dual-use methods dispatch:

```ts
// src/builders/module-rule-builder.ts
notImportFrom(...globs: string[]): this {
  if (this._phase === 'condition') {
    return this.addCondition(notImportFromCondition(...globs))
  }
  return this.addPredicate(notImportFromPredicate(...globs))
}
```

**Backwards compatible:** Existing code using `notImportFromCondition()` / `shouldResideInFolder()` etc. continues to work — those methods stay as aliases, marked with `/** @deprecated Use notImportFrom() after .should() instead */` JSDoc tags so IDEs show strikethrough. Keep deprecated aliases through v1.0.

### Builders affected

| Builder               | Methods to make phase-aware                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `ModuleRuleBuilder`   | `notImportFrom`, `resideInFile`, `resideInFolder`                                              |
| `ClassRuleBuilder`    | `resideInFile`, `resideInFolder`, `haveNameMatching`, `extend`, `implement`, `haveMethodNamed` |
| `FunctionRuleBuilder` | `haveNameMatching`                                                                             |
| `TypeRuleBuilder`     | `haveNameMatching`                                                                             |

Also add `resideInFolder` and `resideInFile` as phase-aware to `ModuleRuleBuilder` (currently predicate-only — the conditions exist in `structural.ts` but aren't wired up).

### What changes

```ts
// Before (confusing — three naming conventions)
modules(p).should().notImportFromCondition('**/repos/**')
classes(p).should().shouldResideInFolder('**/services/**')
functions(p).should().conditionHaveNameMatching(/^handle/)

// After (natural — same name works in both phases)
modules(p).should().notImportFrom('**/repos/**')
classes(p).should().resideInFolder('**/services/**')
functions(p).should().haveNameMatching(/^handle/)

// Predicate usage unchanged
modules(p).that().notImportFrom('**/legacy/**').should()...
classes(p).that().resideInFolder('**/domain/**').should()...
```

### Remove the no-condition warning for phase-aware methods

The warning at rule-builder.ts:252 ("Did you use a predicate method after .should()?") becomes unnecessary for phase-aware methods. Keep it only for genuinely predicate-only methods called after `.should()`.

## Phase 2: Module body analysis (0.5 day)

### Problem

`classes(p).should().notContain(access('process.env'))` works. `functions(p).should().notContain(access('process.env'))` works. But `modules(p).should().notContain(access('process.env'))` doesn't — ModuleRuleBuilder has no body analysis.

Module-scope code exists: top-level `const config = process.env.DB_URL`, module-scope `eval()`, top-level `console.log()`. These can't be caught by class or function rules.

### Implementation

Follow the exact same pattern as class and function body analysis:

1. **`src/helpers/body-traversal.ts`** — add `searchModuleBody(sourceFile, matcher)`:
   - Walk all top-level statements and their descendants
   - Use the same `findMatchesInNode` infrastructure
   - Skip class/function bodies (those are covered by their own entry points) — only check module-scope code

2. **`src/conditions/body-analysis-module.ts`** — new file:
   - `moduleContain(matcher)` → `Condition<SourceFile>`
   - `moduleNotContain(matcher)` → `Condition<SourceFile>`
   - `moduleUseInsteadOf(bad, good)` → `Condition<SourceFile>`

3. **`ModuleRuleBuilder`** — wire up:
   - `contain(matcher)` / `notContain(matcher)` / `useInsteadOf(bad, good)` methods

### Design decision: module-scope only vs full file

Two options for what "module body" means:

- **Full file:** Walk all descendants of the SourceFile, including inside classes and functions
- **Module-scope only:** Walk only top-level statements and their immediate expressions (skip class/function bodies)

**Default: full file.** Rationale: When a user writes `modules(p).that().resideInFolder('**/domain/**').should().notContain(access('process.env'))`, they want to ensure NO code in domain modules accesses `process.env` — not just top-level code. Module-scope-only would miss `process.env` inside a class method or function body within that module.

This means `modules().notContain()` is a superset of `classes().notContain()` + `functions().notContain()` for the same files. That's intentional — it serves a different purpose (file-level policy vs element-level).

**Escape hatch: `{ scopeToModule: true }`.** For users who also have class/function rules and want to avoid duplicate violations, `moduleNotContain(matcher, { scopeToModule: true })` restricts traversal to top-level statements only (skips class bodies, function bodies, arrow functions). The builder wires this as:

```ts
modules(p).should().notContain(access('process.env'), { scopeToModule: true })
```

This is an option, not the default — most users want the simpler "no X anywhere in this file" semantics.

### What this enables

```ts
// No process.env anywhere in domain modules
modules(p).that().resideInFolder('**/domain/**').should().notContain(access('process.env')).check()

// No eval at module scope or anywhere in a file
modules(p).should().notContain(call('eval')).check()

// No console.log in production code
modules(p).that().resideInFolder('**/src/**').should().notContain(call('console.log')).check()
```

## Phase 3: Export conditions (0.5 day)

### Problem

No way to enforce export conventions:

- "No default exports" — a common ESLint rule, but ESLint can't scope it to specific folders
- "Max one export per file" — single-responsibility enforcement
- "Must have a default export" — for framework conventions (Next.js pages, etc.)

### Implementation

**`src/conditions/exports.ts`** — new file:

```ts
export function notHaveDefaultExport(): Condition<SourceFile>
export function haveDefaultExport(): Condition<SourceFile>
export function haveMaxExports(max: number): Condition<SourceFile>
```

Implementation uses ts-morph:

- `sourceFile.getDefaultExportSymbol()` — checks for default export
- `sourceFile.getExportedDeclarations()` — counts named exports (`.size` for the map)

**`ModuleRuleBuilder`** — wire up:

- `notHaveDefaultExport()`, `haveDefaultExport()`, `haveMaxExports(n)`

### What this enables

```ts
// No default exports in src (scoped — ESLint can't do this)
modules(p).that().resideInFolder('**/src/**').should().notHaveDefaultExport().check()

// Single export per file in domain
modules(p).that().resideInFolder('**/domain/**').should().haveMaxExports(1).check()

// Pages must have default exports (Next.js)
modules(p).that().resideInFolder('**/pages/**').should().haveDefaultExport().check()
```

## Phase 4: Reverse dependency & dead code detection (0.75 day)

### Problem

No way to enforce barrel/facade patterns: "internal modules should only be imported through their index.ts". This is `onlyBeImportedVia()` — an inverted dependency check.

Current conditions check what a module imports FROM. This checks what imports a module — the reverse direction.

### Implementation

**`src/conditions/reverse-dependency.ts`** — new file:

```ts
export function onlyBeImportedVia(...globs: string[]): Condition<SourceFile>
export function beImported(): Condition<SourceFile>
export function haveNoUnusedExports(): Condition<SourceFile>
```

**`onlyBeImportedVia`** logic:

1. For each module matching the predicates, find all source files in the project that import it
2. Check that every importing file matches at least one of the globs
3. Violation for each importing file that doesn't match

**`beImported`** logic:

1. For each module matching the predicates, check that at least one file in the project imports it
2. Violation if zero importers — the module is dead code

**`haveNoUnusedExports`** logic:

1. For each module, get its exported declarations via `sourceFile.getExportedDeclarations()`
2. For each exported symbol, use ts-morph's `findReferencesAsNodes()` to check if any other file references it
3. **Short-circuit:** stop after first external reference is found (we only need "is referenced at least once", not "how many times"). This turns O(exports × references) into O(exports) amortized for well-connected code
4. Violation for each export that has zero external references — the export is dead code
5. This is more expensive than file-level checks (symbol-level analysis), but dead exports are bad code worth finding. Users should scope with `.that().resideInFolder()` to limit the search space

Building the reverse import graph: iterate `project.getSourceFiles()`, for each file iterate its import declarations, resolve to absolute paths, build a `Map<string, SourceFile[]>` (imported path → importing files). This is O(files × imports), same complexity as the existing dependency conditions.

**Cache the reverse import graph** on the `ArchProject` instance (or as a `WeakMap` keyed by `ArchProject`). The graph only changes when source files change, and ts-morph's `Project` already caches file state. Multiple `onlyBeImportedVia()` rules in the same test suite must not rebuild the graph each time. The `resetProjectCache()` function (used by watch mode) clears the cached graph.

**`ModuleRuleBuilder`** — wire up `onlyBeImportedVia(...globs)`.

### What this enables

```ts
// Internal feature modules only importable through index.ts
modules(p)
  .that()
  .resideInFolder('src/features/*/internal/**')
  .should()
  .onlyBeImportedVia('**/index.ts', '**/internal/**')
  .rule({
    id: 'feature/public-api',
    because: 'Internal modules must be accessed through the public API',
  })
  .check()

// Shared utilities only importable from src/ (not from tests directly)
modules(p).that().resideInFolder('src/shared/**').should().onlyBeImportedVia('**/src/**').check()

// Dead module detection — find files nobody imports
modules(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .beImported()
  .rule({
    id: 'hygiene/no-dead-modules',
    because: 'Unimported modules are dead code',
    suggestion: 'Delete the module or import it where needed',
  })
  .check()

// Unused export detection — find exports nobody references
modules(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .haveNoUnusedExports()
  .rule({
    id: 'hygiene/no-unused-exports',
    because: 'Unused exports bloat the public API and confuse consumers',
    suggestion: 'Remove the export or make it internal',
  })
  .check()
```

### Known limitations / false positive sources

These conditions rely on static import analysis. Document these in the API docs so users know what to `.excluding()`:

| Scenario                                                   | Affected condition      | Mitigation                                                                                     |
| ---------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| Entry points (`main.ts`, `index.ts`, CLI bins)             | `beImported()`          | `.excluding('main.ts', 'index.ts')`                                                            |
| Dynamic imports (`import('./plugin.js')`)                  | `beImported()`          | ts-morph does not resolve dynamic import paths — `.excluding()` the target                     |
| Files referenced outside TypeScript (webpack config, etc.) | `beImported()`          | `.excluding()` or scope to `src/**`                                                            |
| Public API barrel re-exports consumed by npm users         | `haveNoUnusedExports()` | Scope to internal folders, not the top-level `index.ts`                                        |
| Re-export chains (A re-exports B, but nobody uses A)       | `haveNoUnusedExports()` | The re-export counts as a reference to B — the deeper chain is not detected. Known limitation. |
| Type-only exports (`export type Foo`)                      | `haveNoUnusedExports()` | `findReferencesAsNodes()` includes type references — no false positive here                    |
| Exports used only in test files outside tsconfig scope     | `haveNoUnusedExports()` | Ensure test files are included in the project's tsconfig                                       |

## Files

| File                                            | Type                                                                                                                                                                                                | Phase |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `src/core/rule-builder.ts`                      | Modified — add `_phase`, set in `should()`/`that()`                                                                                                                                                 | 1     |
| `src/builders/module-rule-builder.ts`           | Modified — phase-aware `notImportFrom`, `resideInFolder`, `resideInFile`, plus `contain`, `notContain`, `useInsteadOf`, export conditions, `onlyBeImportedVia`, `beImported`, `haveNoUnusedExports` | 1–4   |
| `src/builders/class-rule-builder.ts`            | Modified — phase-aware `resideInFile`, `resideInFolder`, `haveNameMatching`, `extend`, `implement`, `haveMethodNamed`                                                                               | 1     |
| `src/builders/function-rule-builder.ts`         | Modified — phase-aware `haveNameMatching`                                                                                                                                                           | 1     |
| `src/helpers/body-traversal.ts`                 | Modified — add `searchModuleBody()`                                                                                                                                                                 | 2     |
| `src/conditions/body-analysis-module.ts`        | New — `moduleContain`, `moduleNotContain`, `moduleUseInsteadOf`                                                                                                                                     | 2     |
| `src/conditions/exports.ts`                     | New — `notHaveDefaultExport`, `haveDefaultExport`, `haveMaxExports`                                                                                                                                 | 3     |
| `src/conditions/reverse-dependency.ts`          | New — `onlyBeImportedVia`                                                                                                                                                                           | 4     |
| `src/index.ts`                                  | Modified — export new conditions                                                                                                                                                                    | 2–4   |
| `tests/conditions/phase-tracking.test.ts`       | New                                                                                                                                                                                                 | 1     |
| `tests/conditions/body-analysis-module.test.ts` | New                                                                                                                                                                                                 | 2     |
| `tests/conditions/exports.test.ts`              | New                                                                                                                                                                                                 | 3     |
| `tests/conditions/reverse-dependency.test.ts`   | New                                                                                                                                                                                                 | 4     |
| `tests/fixtures/module-body/`                   | New — fixture files for module body analysis                                                                                                                                                        | 2     |
| `tests/fixtures/exports/`                       | New — fixture files for export conditions                                                                                                                                                           | 3     |
| `tests/fixtures/reverse-deps/`                  | New — fixture project for reverse dependency                                                                                                                                                        | 4     |

## Test strategy

### Phase 1: Phase tracking (~14 tests)

- `modules().should().notImportFrom()` adds a condition (not a predicate)
- `modules().that().notImportFrom()` still adds a predicate
- `classes().should().resideInFolder()` adds a condition
- `classes().that().resideInFolder()` adds a predicate
- `functions().should().haveNameMatching()` adds a condition
- Deprecated aliases (`notImportFromCondition`, `shouldResideInFolder`, etc.) still work
- Phase resets correctly across `should()` fork
- `that()` resets phase: `.should().that().notImportFrom()` adds a predicate (not a condition)
- Chaining: `.that().notImportFrom().should().notImportFrom()` — first is predicate, second is condition
- `satisfy()` still uses structural dispatch regardless of phase

### Phase 2: Module body analysis (~10 tests)

- `modules().should().notContain(access('process.env'))` — catches top-level access
- `modules().should().notContain(call('eval'))` — catches call inside class/function within module (full file mode)
- `modules().should().notContain(call('eval'), { scopeToModule: true })` — catches only module-scope eval, skips class/function bodies
- `modules().should().contain(call('configure'))` — must-contain pattern
- `modules().should().useInsteadOf(call('fetch'), call('httpClient'))` — replacement
- No false positives on modules without the pattern
- Works with `resideInFolder` predicate to scope to specific folders

### Phase 3: Export conditions (~6 tests)

- `notHaveDefaultExport()` — catches `export default`
- `haveDefaultExport()` — catches missing default export
- `haveMaxExports(1)` — catches files with 2+ exports
- `haveMaxExports(1)` — passes file with exactly 1 export
- Works with folder predicates

### Phase 4: Reverse dependency & dead code (~14 tests)

- `onlyBeImportedVia('**/index.ts')` — catches direct import bypassing barrel
- Passes when all importers go through index.ts
- Module with no importers passes `onlyBeImportedVia` (vacuously true)
- Multiple allowed globs — any match is OK
- Works with `resideInFolder` to target specific internal modules
- `beImported()` — violation on module with zero importers
- `beImported()` — passes on module with at least one importer
- `beImported()` — entry point files (index.ts) can be excluded via `.excluding()`
- `haveNoUnusedExports()` — violation on export with zero external references
- `haveNoUnusedExports()` — passes when all exports are referenced
- `haveNoUnusedExports()` — re-exports count as references

## Phase 5: Comment matcher and empty body detection (0.25 day)

### Problem

AI coding agents frequently leave stubs: `// TODO`, `// FIXME`, empty function bodies, `throw new Error('Not implemented')`. The existing `expression()` matcher catches string literals (`'Not implemented'`) but cannot see comments — comments aren't AST nodes, they're trivia attached to nodes.

Empty function bodies are the ultimate stub — they compile, pass type checks, and silently do nothing.

### Two new primitives

#### 1. `comment()` ExpressionMatcher (`src/helpers/matchers.ts`)

A new matcher that scans comments instead of AST nodes. Follows the `call()` / `access()` / `newExpr()` pattern — implements `ExpressionMatcher`.

```ts
comment(pattern: string | RegExp): ExpressionMatcher
```

Implementation: ts-morph exposes comments via `node.getLeadingCommentRanges()` and `node.getTrailingCommentRanges()`. The matcher walks all nodes in the scope, collects their comment ranges, and tests the comment text against the pattern.

Default stub pattern for convenience:

```ts
// src/helpers/matchers.ts
export const STUB_PATTERNS =
  /\b(TODO|FIXME|HACK|XXX|STUB|DEFERRED|PLACEHOLDER)\b|not\s+implemented|coming\s+soon/i
```

This is exported as a constant, not baked into `comment()`. The user always passes the pattern explicitly:

```ts
// Catch all common stub markers in comments
functions(p)
  .should()
  .notContain(comment(STUB_PATTERNS))
  .rule({ id: 'hygiene/no-stub-comments' })
  .check()

// Catch only TODO comments
functions(p).should().notContain(comment(/TODO/)).check()

// Catch stubs in string literals too (throw new Error('Not implemented'))
functions(p)
  .should()
  .notContain(expression(/not.?implemented|todo|stub|deferred|placeholder|coming.?soon/i))
  .check()
```

Both `comment()` (for comments) and `expression()` (for string literals) are needed — they catch different things.

#### 2. `notHaveEmptyBody()` condition

A new condition on `FunctionRuleBuilder` and `ClassRuleBuilder` that checks for empty bodies.

```ts
// src/conditions/body-analysis-function.ts
export function functionNotHaveEmptyBody(): Condition<ArchFunction>

// src/conditions/body-analysis.ts
export function classNotHaveEmptyBody(): Condition<ClassDeclaration>
```

A function body is "empty" if it has zero statements (excluding comments — a function with only a `// TODO` comment is still empty). For classes, a class is "empty" if it has zero members.

```ts
// Catch stub functions with empty bodies
functions(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .notHaveEmptyBody()
  .rule({
    id: 'hygiene/no-empty-functions',
    because: 'Empty functions are unfinished stubs',
    suggestion: 'Implement the function or remove it',
  })
  .check()
```

### What this enables (combined stub detection)

```ts
// The full "no stubs" rule set — catches all forms of deferred work
import { comment, expression, STUB_PATTERNS } from '@nielspeter/ts-archunit'

// 1. No stub comments (TODO, FIXME, HACK, etc.)
functions(p).should().notContain(comment(STUB_PATTERNS)).check()

// 2. No stub string literals (throw new Error('Not implemented'))
functions(p)
  .should()
  .notContain(expression(/not.?implemented|stub|placeholder|coming.?soon/i))
  .check()

// 3. No empty function bodies
functions(p).that().resideInFolder('src/**').should().notHaveEmptyBody().check()
```

### Files (Phase 5)

| File                                       | Type                                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| `src/helpers/matchers.ts`                  | Modified — add `comment()` matcher and `STUB_PATTERNS` constant |
| `src/helpers/body-traversal.ts`            | Modified — add comment scanning support for `findMatchesInNode` |
| `src/conditions/body-analysis-function.ts` | Modified — add `functionNotHaveEmptyBody()`                     |
| `src/conditions/body-analysis.ts`          | Modified — add `classNotHaveEmptyBody()`                        |
| `src/builders/function-rule-builder.ts`    | Modified — wire up `notHaveEmptyBody()`                         |
| `src/builders/class-rule-builder.ts`       | Modified — wire up `notHaveEmptyBody()`                         |
| `src/index.ts`                             | Modified — export `comment`, `STUB_PATTERNS`, new conditions    |
| `tests/conditions/comment-matcher.test.ts` | New                                                             |
| `tests/conditions/empty-body.test.ts`      | New                                                             |
| `tests/fixtures/stubs/`                    | New — fixture files with various stub patterns                  |

### Tests (Phase 5, ~12 tests)

- `comment(/TODO/)` catches `// TODO: implement` in function body
- `comment(/TODO/)` catches `/* TODO */` block comments
- `comment(/TODO/)` does NOT match `'TODO'` string literals (that's `expression()`'s job)
- `comment(STUB_PATTERNS)` catches all 8 patterns: TODO, FIXME, HACK, XXX, STUB, DEFERRED, PLACEHOLDER, not implemented, coming soon
- `notHaveEmptyBody()` catches `function foo() {}`
- `notHaveEmptyBody()` catches `const bar = () => {}` (empty arrow)
- `notHaveEmptyBody()` passes `function foo() { return 1 }`
- `notHaveEmptyBody()` catches function with only a comment (still counts as empty)
- Works with `modules().should().notContain(comment(...))` after Phase 2 module body analysis

## Out of scope

- TypeScript phantom types for builder phases — phase tracking is simpler and backwards compatible
- `onlyExport()` with name pattern matching — export conditions cover cardinality, not naming
- Deprecation removal of old method names — keep aliases through v1.0
- Automatic stub detection presets — users compose from `comment()`, `expression()`, and `notHaveEmptyBody()`

## Verification

```bash
npm run test
npm run typecheck
npm run lint
```
