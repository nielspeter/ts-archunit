# Plan 0024: Standard Rules Library

## Status

- **State:** Done
- **Priority:** P2 — High adoption impact, low effort per rule
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** 0008 (Class Entry Point), 0009 (Function Entry Point), 0011 (Body Analysis)

## Purpose

Ship ready-to-use architecture rules as categorized sub-path exports. Users import what they need without writing custom conditions:

```typescript
import { noAnyProperties, noTypeAssertions, noNonNullAssertions } from 'ts-archunit/rules/typescript'
import { noEval, noConsoleLog, noProcessEnv } from 'ts-archunit/rules/security'
import { noGenericErrors } from 'ts-archunit/rules/errors'
```

This is the ts-archunit equivalent of ArchUnit's `GeneralCodingRules`. The difference: categorized imports instead of one flat namespace.

## Design Decision: Sub-Path Exports

Each category gets its own entry point in `package.json` exports:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./rules/typescript": {
      "types": "./dist/rules/typescript.d.ts",
      "import": "./dist/rules/typescript.js"
    },
    "./rules/security": {
      "types": "./dist/rules/security.d.ts",
      "import": "./dist/rules/security.js"
    },
    "./rules/errors": {
      "types": "./dist/rules/errors.d.ts",
      "import": "./dist/rules/errors.js"
    },
    "./rules/naming": {
      "types": "./dist/rules/naming.d.ts",
      "import": "./dist/rules/naming.js"
    },
    "./rules/dependencies": {
      "types": "./dist/rules/dependencies.d.ts",
      "import": "./dist/rules/dependencies.js"
    }
  }
}
```

**Why sub-paths, not one flat export:**
- Users import only what they need — no autocomplete pollution
- Categories are self-documenting — `rules/security` is obvious
- Scales: adding a new category doesn't touch existing imports
- Follows the pattern planned for `ts-archunit/graphql` (plan 0021)

**Why not `ts-archunit/rules` as a single flat export:**
- Would grow into a grab bag of 30+ rules
- No structure — users can't tell which rules relate to what
- Adding rules changes the flat export surface

## Phase 1: Package Structure

### Directory layout

```
src/rules/
├── typescript.ts     # Type safety rules
├── security.ts       # Security and unsafe pattern rules
├── errors.ts         # Error handling rules
├── naming.ts         # Naming convention rules
└── dependencies.ts   # Dependency direction rules
```

Each file exports condition factory functions. The rules return `Condition<ClassDeclaration>` or `Condition<ArchFunction>` — users plug them into `.should().satisfy()`.

### Rule signature convention

Every standard rule is a function that returns a `Condition`. This keeps them composable — users can combine standard rules with custom ones:

```typescript
// Each rule is a zero-arg function returning a Condition
export function noAnyProperties(): Condition<ClassDeclaration>
export function noTypeAssertions(): Condition<ClassDeclaration>

// Some rules take configuration
export function noConsoleLog(options?: { allow?: string[] }): Condition<ClassDeclaration>
```

## Phase 2: TypeScript Rules (`ts-archunit/rules/typescript`)

Rules enforcing TypeScript type safety beyond what `strict` mode catches.

### `src/rules/typescript.ts`

```typescript
import { Node, SyntaxKind } from 'ts-morph'
import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'

/**
 * Class properties must not be typed as `any`.
 *
 * Detects both explicit `any` and untyped properties that resolve to `any`.
 * Use `unknown` with type narrowing instead.
 *
 * @example
 * import { noAnyProperties } from 'ts-archunit/rules/typescript'
 *
 * classes(p).that().resideInFolder('**/src/**')
 *   .should().satisfy(noAnyProperties())
 *   .because('any bypasses the type checker')
 *   .check()
 */
export function noAnyProperties(): Condition<ClassDeclaration> {
  return {
    description: 'have no properties typed as any',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const prop of cls.getProperties()) {
          if (prop.getType().getText() === 'any') {
            violations.push(
              createViolation(
                prop,
                `${cls.getName() ?? '<anonymous>'}.${prop.getName()} is typed as 'any' — use a specific type or 'unknown'`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * Method bodies must not contain `as` type assertions.
 *
 * Allows `as const` (narrows types, doesn't widen).
 * Use type guards or explicit type annotations instead.
 *
 * @example
 * import { noTypeAssertions } from 'ts-archunit/rules/typescript'
 *
 * classes(p).that().haveNameEndingWith('Service')
 *   .should().satisfy(noTypeAssertions())
 *   .check()
 */
export function noTypeAssertions(): Condition<ClassDeclaration> {
  return {
    description: 'have no type assertions (as) in method bodies',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const body = method.getBody()
          if (!body) continue
          for (const asExpr of body.getDescendantsOfKind(SyntaxKind.AsExpression)) {
            const typeNode = asExpr.getTypeNode()
            if (typeNode && Node.isTypeReference(typeNode) && typeNode.getText() === 'const') {
              continue
            }
            violations.push(
              createViolation(
                asExpr,
                `${cls.getName() ?? '<anonymous>'}.${method.getName()} uses type assertion — use type guards instead`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * Method bodies must not contain non-null assertions (`!`).
 *
 * Handle null/undefined explicitly instead of asserting it away.
 *
 * @example
 * import { noNonNullAssertions } from 'ts-archunit/rules/typescript'
 *
 * classes(p).that().resideInFolder('**/domain/**')
 *   .should().satisfy(noNonNullAssertions())
 *   .check()
 */
export function noNonNullAssertions(): Condition<ClassDeclaration> {
  return {
    description: 'have no non-null assertions (!) in method bodies',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const body = method.getBody()
          if (!body) continue
          for (const expr of body.getDescendantsOfKind(SyntaxKind.NonNullExpression)) {
            violations.push(
              createViolation(
                expr,
                `${cls.getName() ?? '<anonymous>'}.${method.getName()} uses non-null assertion — handle the null case explicitly`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}
```

## Phase 3: Security Rules (`ts-archunit/rules/security`)

### `src/rules/security.ts`

```typescript
import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { call, newExpr, access } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'

/**
 * No eval() calls in class methods.
 *
 * @example
 * import { noEval } from 'ts-archunit/rules/security'
 *
 * classes(p).should().satisfy(noEval()).check()
 */
export function noEval(): Condition<ClassDeclaration> {
  return classNotContain(call('eval'))
}

/**
 * No new Function() constructor (equivalent to eval).
 *
 * @example
 * import { noFunctionConstructor } from 'ts-archunit/rules/security'
 *
 * classes(p).should().satisfy(noFunctionConstructor()).check()
 */
export function noFunctionConstructor(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('Function'))
}

/**
 * No direct process.env access in class methods.
 *
 * Use dependency injection for configuration instead.
 *
 * @example
 * import { noProcessEnv } from 'ts-archunit/rules/security'
 *
 * classes(p).that().resideInFolder('**/domain/**')
 *   .should().satisfy(noProcessEnv())
 *   .because('use Config injection instead')
 *   .check()
 */
export function noProcessEnv(): Condition<ClassDeclaration> {
  return classNotContain(access('process.env'))
}

/**
 * No console.log calls in class methods.
 *
 * Use a logger abstraction instead.
 *
 * @example
 * import { noConsoleLog } from 'ts-archunit/rules/security'
 *
 * classes(p).that().resideInFolder('**/src/**')
 *   .should().satisfy(noConsoleLog())
 *   .check()
 */
export function noConsoleLog(): Condition<ClassDeclaration> {
  return classNotContain(call('console.log'))
}
```

## Phase 4: Error Handling Rules (`ts-archunit/rules/errors`)

### `src/rules/errors.ts`

```typescript
import type { ClassDeclaration } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import { newExpr } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'

/**
 * No throwing generic Error — use typed domain errors instead.
 *
 * @example
 * import { noGenericErrors } from 'ts-archunit/rules/errors'
 *
 * classes(p).that().extend('BaseService')
 *   .should().satisfy(noGenericErrors())
 *   .because('use DomainError, NotFoundError, etc.')
 *   .check()
 */
export function noGenericErrors(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('Error'))
}

/**
 * No throwing TypeError — usually indicates a programming error, not a domain error.
 */
export function noTypeErrors(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('TypeError'))
}
```

## Phase 5: Naming Rules (`ts-archunit/rules/naming`)

### `src/rules/naming.ts`

Naming rules are typically project-specific, but some patterns are universal:

```typescript
import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'

/**
 * Class name must match a regex pattern.
 *
 * This is the condition version of the `haveNameMatching` predicate.
 * Use when you want to assert naming, not filter by it.
 *
 * @example
 * import { mustMatchName } from 'ts-archunit/rules/naming'
 *
 * classes(p).that().resideInFolder('**/controllers/**')
 *   .should().satisfy(mustMatchName(/Controller$/))
 *   .check()
 */
export function mustMatchName(pattern: RegExp): Condition<ClassDeclaration> {
  return {
    description: `have name matching ${String(pattern)}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const name = cls.getName() ?? '<anonymous>'
        if (!pattern.test(name)) {
          violations.push(
            createViolation(cls, `${name} does not match naming convention ${String(pattern)}`, context),
          )
        }
      }
      return violations
    },
  }
}

/**
 * Class must not have a specific suffix (anti-pattern detection).
 *
 * @example
 * import { mustNotEndWith } from 'ts-archunit/rules/naming'
 *
 * // JPA entities should not have Entity suffix
 * classes(p).that().resideInFolder('**/domain/**')
 *   .should().satisfy(mustNotEndWith('Entity'))
 *   .check()
 */
export function mustNotEndWith(suffix: string): Condition<ClassDeclaration> {
  return {
    description: `not have name ending with "${suffix}"`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const name = cls.getName() ?? '<anonymous>'
        if (name.endsWith(suffix)) {
          violations.push(
            createViolation(cls, `${name} should not end with "${suffix}"`, context),
          )
        }
      }
      return violations
    },
  }
}
```

## Phase 6: Dependency Rules (`ts-archunit/rules/dependencies`)

### `src/rules/dependencies.ts`

```typescript
import type { SourceFile } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import {
  onlyImportFrom,
  notImportFrom,
  onlyHaveTypeImportsFrom,
} from '../conditions/dependency.js'

/**
 * Module must only import from allowed paths.
 *
 * Convenience wrapper around the onlyImportFrom condition.
 *
 * @example
 * import { onlyDependOn } from 'ts-archunit/rules/dependencies'
 *
 * modules(p).that().resideInFolder('**/domain/**')
 *   .should().satisfy(onlyDependOn('**/domain/**', '**/shared/**'))
 *   .check()
 */
export function onlyDependOn(...globs: string[]): Condition<SourceFile> {
  return onlyImportFrom(...globs)
}

/**
 * Module must not import from forbidden paths.
 *
 * @example
 * import { mustNotDependOn } from 'ts-archunit/rules/dependencies'
 *
 * modules(p).that().resideInFolder('**/domain/**')
 *   .should().satisfy(mustNotDependOn('**/infrastructure/**'))
 *   .check()
 */
export function mustNotDependOn(...globs: string[]): Condition<SourceFile> {
  return notImportFrom(...globs)
}

/**
 * Imports from specific paths must be type-only.
 *
 * @example
 * import { typeOnlyFrom } from 'ts-archunit/rules/dependencies'
 *
 * modules(p).that().resideInFolder('**/services/**')
 *   .should().satisfy(typeOnlyFrom('**/domain/**'))
 *   .check()
 */
export function typeOnlyFrom(...globs: string[]): Condition<SourceFile> {
  return onlyHaveTypeImportsFrom(...globs)
}
```

## Phase 7: Update package.json exports

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./rules/typescript": {
      "types": "./dist/rules/typescript.d.ts",
      "import": "./dist/rules/typescript.js"
    },
    "./rules/security": {
      "types": "./dist/rules/security.d.ts",
      "import": "./dist/rules/security.js"
    },
    "./rules/errors": {
      "types": "./dist/rules/errors.d.ts",
      "import": "./dist/rules/errors.js"
    },
    "./rules/naming": {
      "types": "./dist/rules/naming.d.ts",
      "import": "./dist/rules/naming.js"
    },
    "./rules/dependencies": {
      "types": "./dist/rules/dependencies.d.ts",
      "import": "./dist/rules/dependencies.js"
    }
  }
}
```

## Phase 8: Update tsconfig.build.json

Ensure `src/rules/` is included in the build output.

Currently `rootDir: "src"` and `include: ["src"]` — rules are already under `src/`, so no change needed. The sub-path exports point to `dist/rules/` which tsc produces automatically.

## Phase 9: Update tests/archunit to use standard rules

Refactor `tests/archunit/arch-rules.test.ts` to import from the standard rules instead of inline custom conditions:

```typescript
// Before (inline 30-line custom condition)
const noAnyProperties = defineCondition<ClassDeclaration>(...)

// After (one import)
import { noAnyProperties, noTypeAssertions } from '../../src/rules/typescript.js'
import { noEval, noConsoleLog } from '../../src/rules/security.js'
import { noGenericErrors } from '../../src/rules/errors.js'
```

## Phase 10: Tests

### `tests/rules/typescript.test.ts`

Test against PoC fixtures — need a fixture with `any` properties and `as` casts. The PoC fixtures don't have these (they're intentionally well-typed). Add a small fixture:

```
tests/fixtures/rules/
├── tsconfig.json
└── src/
    ├── any-class.ts          # class with any-typed property
    ├── assertion-class.ts    # class with as casts
    ├── nonnull-class.ts      # class with ! assertions
    └── clean-class.ts        # no violations
```

### Test inventory per category

| Category | Tests |
|----------|-------|
| typescript | 8 — noAnyProperties (pass/fail), noTypeAssertions (pass/fail/as const allowed), noNonNullAssertions (pass/fail) |
| security | 6 — noEval, noFunctionConstructor, noProcessEnv, noConsoleLog (pass/fail each) |
| errors | 4 — noGenericErrors (pass/fail), noTypeErrors (pass/fail) |
| naming | 4 — mustMatchName (pass/fail), mustNotEndWith (pass/fail) |
| dependencies | 4 — onlyDependOn, mustNotDependOn (pass/fail each) |

## Files Changed

| File | Change |
|------|--------|
| `src/rules/typescript.ts` | New — noAnyProperties, noTypeAssertions, noNonNullAssertions |
| `src/rules/security.ts` | New — noEval, noFunctionConstructor, noProcessEnv, noConsoleLog |
| `src/rules/errors.ts` | New — noGenericErrors, noTypeErrors |
| `src/rules/naming.ts` | New — mustMatchName, mustNotEndWith |
| `src/rules/dependencies.ts` | New — onlyDependOn, mustNotDependOn, typeOnlyFrom |
| `package.json` | Modified — add sub-path exports for each category |
| `tests/archunit/arch-rules.test.ts` | Modified — use standard rules instead of inline conditions |
| `tests/fixtures/rules/` | New — fixtures with type safety violations |
| `tests/rules/typescript.test.ts` | New |
| `tests/rules/security.test.ts` | New |
| `tests/rules/errors.test.ts` | New |
| `tests/rules/naming.test.ts` | New |
| `tests/rules/dependencies.test.ts` | New |

## Out of Scope

- **Function-level rules** — the initial standard rules operate on `ClassDeclaration`. Function equivalents (for `ArchFunction`) can be added later as demand emerges.
- **Auto-discovery** — no `importAll('ts-archunit/rules')` that loads every category. Users explicitly import what they need.
- **Configuration objects** — rules are simple functions. No `RuleConfig` objects or `enable/disable` toggles. Users compose with predicates for scoping.
- **Framework-specific rules** — no NestJS, Express, Fastify rules. Those belong in separate packages or user-defined rules via `definePredicate`/`defineCondition`.

## Future Categories

When demand emerges:

| Category | Potential rules |
|----------|----------------|
| `rules/async` | noFloatingPromises, noCallbackPattern, noSyncFileOps |
| `rules/immutability` | noMutableProperties, noLetDeclarations, noArrayMutation |
| `rules/testing` | testFilesMatchSource, noSkippedTests, noFocusedTests |
| `rules/react` | noClassComponents, useEffectCleanup (separate package) |
