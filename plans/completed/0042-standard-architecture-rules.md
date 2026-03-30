# Plan 0042: Standard Architecture Rule Conditions

## Status

- **State:** COMPLETED 2026-03-30
- **Priority:** P1 — Existing security/error rules are class-only; function and module variants are missing
- **Effort:** 0.5 day
- **Created:** 2026-03-30
- **Depends on:** 0041 (Architecture Rule Primitives — module body analysis)

## Context

ts-archunit has 13 standard rules across 8 files. All security rules (`noEval`, `noProcessEnv`, `noConsoleLog`) return `Condition<ClassDeclaration>` — they only work with `classes(p)`. A user who writes `functions(p).should().satisfy(noProcessEnv())` gets a type error. They have to know that `process.env` needs `access()` not `call()`, and manually write `functions(p).should().notContain(access('process.env'))`.

**The gap:** Function and module variants of existing security and error rules are missing. Plus one genuinely new primitive: `mustCall()` (positive assertion that a body contains a pattern).

### What this plan does NOT add

The original draft included six "logic placement" rules with hardcoded regex defaults (`noDbCalls`, `noHttpCalls`, `noInlineParsing`, `noDateConstruction`, `noValidationCalls`, `noBusinessLogic`). These were removed after review:

1. **False positives.** Default patterns like `/query|execute/` match non-DB code (`executeTask`, `queryString`). `/calculate|compute|process|transform/` matches `process.env`, CSS transforms, stream processors.
2. **Framework coupling.** Hardcoding `/knex|prisma|drizzle|typeorm|mongoose/` means the generic framework "knows about" specific ORMs. When Kysely or MikroORM ships, the defaults are wrong.
3. **Violates lego bricks principle.** These are one-liners: `functionNotContain(call(pattern))`. The abstraction saves one line while adding naming overhead, import overhead, and a false sense of completeness.
4. **Redundant with presets.** Plan 0040's presets already parameterize these patterns via user config (`dbPackages: ['prisma', 'knex']`). The preset is the right abstraction level.

These patterns are documented as **recipes** in the user guide instead (copy-paste examples, not shipped code).

## Naming convention

The existing codebase uses `function` as prefix for function body conditions: `functionContain`, `functionNotContain`, `functionUseInsteadOf`. New function-variant rules follow this convention:

```ts
// Existing pattern (body-analysis-function.ts)
functionContain(matcher)
functionNotContain(matcher)

// New rules follow the same pattern
functionNoEval() // not fnNoEval
functionNoProcessEnv() // not fnNoProcessEnv
```

Module variants use `module` prefix (matching `moduleContain`/`moduleNotContain` from 0041):

```ts
moduleNoEval()
moduleNoProcessEnv()
```

## Changes to `rules/security.ts`

### Function variants of existing rules

```ts
import { functionNotContain } from '../conditions/body-analysis-function.js'
import { call, access } from '../helpers/matchers.js'

// Existing (unchanged)
export function noEval(): Condition<ClassDeclaration>
export function noFunctionConstructor(): Condition<ClassDeclaration>
export function noProcessEnv(): Condition<ClassDeclaration>
export function noConsoleLog(): Condition<ClassDeclaration>

// New — function variants
export function functionNoEval(): Condition<ArchFunction> {
  return functionNotContain(call('eval'))
}

export function functionNoFunctionConstructor(): Condition<ArchFunction> {
  return functionNotContain(newExpr('Function'))
}

export function functionNoProcessEnv(): Condition<ArchFunction> {
  return functionNotContain(access('process.env'))
}

export function functionNoConsoleLog(): Condition<ArchFunction> {
  return functionNotContain(call('console.log'))
}
```

### Module variants (after 0041 phase 2)

```ts
import { moduleNotContain } from '../conditions/body-analysis-module.js'

export function moduleNoEval(): Condition<SourceFile> {
  return moduleNotContain(call('eval'))
}

export function moduleNoProcessEnv(): Condition<SourceFile> {
  return moduleNotContain(access('process.env'))
}

export function moduleNoConsoleLog(): Condition<SourceFile> {
  return moduleNotContain(call('console.log'))
}
```

### Two new rules

```ts
/**
 * No JSON.parse calls — centralize deserialization.
 */
export function noJsonParse(): Condition<ClassDeclaration> {
  return classNotContain(call('JSON.parse'))
}
export function functionNoJsonParse(): Condition<ArchFunction> {
  return functionNotContain(call('JSON.parse'))
}

/**
 * No direct console access (any method: log, warn, error, debug, info).
 * Stricter than noConsoleLog — catches all console methods.
 */
export function noConsole(): Condition<ClassDeclaration> {
  return classNotContain(access('console'))
}
export function functionNoConsole(): Condition<ArchFunction> {
  return functionNotContain(access('console'))
}
```

## Changes to `rules/errors.ts`

```ts
import { functionNotContain } from '../conditions/body-analysis-function.js'
import { newExpr } from '../helpers/matchers.js'

// Existing (unchanged)
export function noGenericErrors(): Condition<ClassDeclaration>
export function noTypeErrors(): Condition<ClassDeclaration>

// New — function variants
export function functionNoGenericErrors(): Condition<ArchFunction> {
  return functionNotContain(newExpr('Error'))
}

export function functionNoTypeErrors(): Condition<ArchFunction> {
  return functionNotContain(newExpr('TypeError'))
}
```

## New primitive: `mustCall()` in `rules/architecture.ts`

The only genuinely new condition — a positive assertion that a body contains at least one call matching a pattern. No hardcoded defaults; the user always provides the pattern.

```ts
import { functionContain } from '../conditions/body-analysis-function.js'
import { classContain } from '../conditions/body-analysis.js'
import { call } from '../helpers/matchers.js'

/**
 * Function body must contain at least one call matching the pattern.
 * Use to enforce that a layer actually delegates to its dependency.
 *
 * @example
 * // Services must call a repository
 * functions(p)
 *   .that().resideInFolder('**/ services /**')
 *   .should().satisfy(mustCall(/Repository/))
 *   .check()
 */
export function mustCall(pattern: RegExp): Condition<ArchFunction> {
  return functionContain(call(pattern))
}

export function classMustCall(pattern: RegExp): Condition<ClassDeclaration> {
  return classContain(call(pattern))
}
```

## New rule file: `rules/hygiene.ts`

Dead code and stub detection rules. Built on 0041 Phase 4 (reverse dependency) and Phase 5 (comment matcher, empty body). These are unambiguous — dead code and stubs are always bad code.

```ts
import { beImported, haveNoUnusedExports } from '../conditions/reverse-dependency.js'
import {
  functionNotContain,
  functionNotHaveEmptyBody,
} from '../conditions/body-analysis-function.js'
import { comment, STUB_PATTERNS } from '../helpers/matchers.js'

/**
 * Module must be imported by at least one other module.
 * Detects dead/orphaned files that nobody references.
 *
 * Exclude entry points (index.ts, main.ts) via .excluding().
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noDeadModules())
 *   .excluding('index.ts', 'main.ts')
 *   .check()
 */
export function noDeadModules(): Condition<SourceFile> {
  return beImported()
}

/**
 * Every exported symbol must be referenced by at least one other file.
 * Detects exports that bloat the public API without consumers.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noUnusedExports())
 *   .check()
 */
export function noUnusedExports(): Condition<SourceFile> {
  return haveNoUnusedExports()
}

/**
 * No stub/TODO/FIXME comments in function bodies.
 * Catches: TODO, FIXME, HACK, XXX, STUB, DEFERRED, PLACEHOLDER,
 * "not implemented", "coming soon".
 *
 * Pass a custom pattern to override the defaults.
 *
 * @example
 * functions(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noStubComments())
 *   .check()
 */
export function noStubComments(pattern: RegExp = STUB_PATTERNS): Condition<ArchFunction> {
  return functionNotContain(comment(pattern))
}

/**
 * Functions must not have empty bodies.
 * An empty function compiles and passes type checks but does nothing.
 *
 * @example
 * functions(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noEmptyBodies())
 *   .check()
 */
export function noEmptyBodies(): Condition<ArchFunction> {
  return functionNotHaveEmptyBody()
}
```

## Sub-path export

```jsonc
// package.json
"./rules/architecture": {
  "types": "./dist/rules/architecture.d.ts",
  "import": "./dist/rules/architecture.js"
}
```

## Files

| File                                     | Type                                                                |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `src/rules/security.ts`                  | Modified — add function/module variants, `noJsonParse`, `noConsole` |
| `src/rules/errors.ts`                    | Modified — add function variants                                    |
| `src/rules/architecture.ts`              | New — `mustCall`, `classMustCall`                                   |
| `src/rules/hygiene.ts`                   | New — `noDeadModules`, `noUnusedExports`                            |
| `package.json`                           | Modified — add `./rules/architecture` and `./rules/hygiene` exports |
| `src/index.ts`                           | Modified — re-export new conditions                                 |
| `tests/rules/security-functions.test.ts` | New                                                                 |
| `tests/rules/security-modules.test.ts`   | New                                                                 |
| `tests/rules/errors-functions.test.ts`   | New                                                                 |
| `tests/rules/architecture.test.ts`       | New                                                                 |

## Test strategy

### Security function variants (~10 tests)

Mirror existing class tests but with `functions(p)`:

- `functionNoEval()` catches `eval()` in functions
- `functionNoProcessEnv()` catches `process.env` in functions
- `functionNoConsoleLog()` catches `console.log` in functions
- `functionNoJsonParse()` catches `JSON.parse` in functions
- `functionNoConsole()` catches `console.warn` / `console.error` / `console.debug`
- No false positives on clean functions

### Security module variants (~6 tests)

Mirror function tests but with `modules(p)`:

- `moduleNoEval()` catches eval anywhere in module
- `moduleNoProcessEnv()` catches process.env in module
- `moduleNoConsoleLog()` catches console.log in module

### Error function variants (~4 tests)

- `functionNoGenericErrors()` catches `new Error()` in functions
- `functionNoGenericErrors()` allows `new CustomError()` in functions
- `functionNoTypeErrors()` catches `new TypeError()` in functions

### Architecture rules (~4 tests)

- `mustCall(/Repository/)` — violation when no call matches
- `mustCall(/Repository/)` — passes when matching call exists
- `classMustCall(/Service/)` — class variant works
- Pattern is user-provided, not hardcoded

### Hygiene rules (~12 tests)

- `noDeadModules()` — violation on module with zero importers
- `noDeadModules()` — passes on module that is imported
- `noDeadModules()` — entry points excluded via `.excluding()`
- `noUnusedExports()` — violation on export with zero external references
- `noUnusedExports()` — passes when all exports are referenced
- `noUnusedExports()` — re-exports count as references
- `noStubComments()` — catches `// TODO` in function body
- `noStubComments()` — catches `// FIXME`, `// HACK`, `// STUB`, `// DEFERRED`, `// PLACEHOLDER`, `// coming soon`, `// not implemented`
- `noStubComments()` — custom pattern overrides defaults
- `noStubComments()` — no false positives on clean functions
- `noEmptyBodies()` — catches `function foo() {}`
- `noEmptyBodies()` — passes `function foo() { return 1 }`

## Out of scope

- Logic placement rules with hardcoded defaults (`noDbCalls`, `noHttpCalls`, etc.) — moved to presets (0040) and documentation recipes
- Module variants of error rules — add when needed
- Naming convention rules — already covered by `mustMatchName()` in `rules/naming.ts`
- Layer dependency rules — already covered by `mustNotDependOn()` / `onlyDependOn()` in `rules/dependencies.ts`
- Framework-specific rules — separate packages per ADR-006

## Verification

```bash
npm run test
npm run typecheck
npm run lint
```
