# Plan 0046: TypeScript Assertion Matchers + Function/Module Variants

## Status

- **State:** COMPLETED 2026-04-12
- **Priority:** P2 — Completes the class/function/module family pattern AND fixes a latent pattern violation in `rules/typescript.ts`
- **Effort:** 0.5 day
- **Created:** 2026-04-12
- **Updated:** 2026-04-12 (rewritten after review — replaces custom-evaluate plan with matcher approach)
- **Implemented:** 2026-04-12 on branch `feat/typescript-assertion-matchers`

## What was built

- **Matchers:** `typeAssertion(options?)` and `nonNullAssertion()` added to `src/helpers/matchers.ts` with `TypeAssertionOptions` type. Both follow the `ExpressionMatcher` pattern, target specific `SyntaxKind`s, use `Node.isAsExpression()` / `Node.isNonNullExpression()` type guards.
- **Rule refactor:** `src/rules/typescript.ts` rewritten — `noTypeAssertions()` / `noNonNullAssertions()` are now one-liners delegating to `classNotContain(matcher())`. Matches the pattern of `security.ts` / `errors.ts`. `noAnyProperties()` kept as custom `evaluate()` with JSDoc explaining why (operates on type resolution, not AST expressions).
- **New rule variants:** `functionNoTypeAssertions()`, `functionNoNonNullAssertions()`, `moduleNoTypeAssertions()`, `moduleNoNonNullAssertions()` — all one-liners delegating to `functionNotContain` / `moduleNotContain`.
- **28 new tests:**
  - 13 matcher tests in `tests/helpers/matchers-typescript.test.ts`
  - 10 function/module variant tests in `tests/rules/typescript-function-module.test.ts`
  - 5 tests added to existing `tests/rules/typescript.test.ts` (new message format assertions, scope widening verification for constructor/getter/setter)
- **Documentation:** `docs/body-analysis.md` (added 2 matchers, updated count 7→9), `docs/standard-rules.md` (function/module variants in TypeScript section), `docs/api-reference.md` (new matcher rows), `CHANGELOG.md` (Unreleased section with Added + Changed subsections).
- **Index exports:** `typeAssertion`, `nonNullAssertion`, `TypeAssertionOptions` exported from `src/index.ts`.
- **`.gitignore`:** added `.playwright-mcp/` to prevent accidental commits.

## What was done differently from the plan

- **Test count grew from ~15 to 28** — the added scope tests for constructors/getters/setters were necessary to lock in the bug fix behavior. Also added additional matcher edge cases (syntaxKinds verification, description string assertions).
- **Plan's "No behavior change" claim for class variants acknowledged — two intentional behavior changes landed:**
  1. Scope widened from `getMethods()` to `searchClassBody` (methods + ctors + getters + setters) — documented in CHANGELOG Changed section
  2. Violation message format changed to generic `<Class> contains <description> at line N` form — documented in CHANGELOG Changed section
- **Plan did not require `src/index.ts` changes for the rule variants** (they go through the `./rules/typescript` sub-path export, which tree-shakes automatically). Only the two matchers needed index.ts exports.

## Verification

- `npm run validate` — typecheck ✓ lint ✓ format ✓ 1852 tests pass ✓
- SonarLint — 0 issues across all 6 new/modified source files
- Net LOC: `src/rules/typescript.ts` reduced from 116 LOC (custom evaluate) to 127 LOC (one-liners with richer JSDoc). Net +11 LOC but the logic moved to reusable matchers.

## Context

### The gap

`src/rules/typescript.ts` currently exposes three class-scoped rules:

- `noAnyProperties()` — class properties typed as `any`
- `noTypeAssertions()` — `as Type` casts in class method bodies (allows `as const`)
- `noNonNullAssertions()` — `!` non-null assertions in class method bodies

Every other rule family (`security`, `errors`) ships class/function/module
variants so users can enforce the same constraint across standalone
functions and module-level code. The TypeScript family is missing these
variants.

### The pattern violation

`rules/security.ts` and `rules/errors.ts` follow a consistent lego-brick
pattern:

```typescript
// src/rules/security.ts
export function noEval(): Condition<ClassDeclaration> {
  return classNotContain(call('eval'))
}
export function functionNoEval(): Condition<ArchFunction> {
  return functionNotContain(call('eval'))
}
export function moduleNoEval(): Condition<SourceFile> {
  return moduleNotContain(call('eval'))
}
```

One matcher (`call('eval')`), three generic conditions
(`classNotContain`/`functionNotContain`/`moduleNotContain`). No custom
`evaluate()` logic. No private helpers.

**`rules/typescript.ts` is the only file in `src/rules/` that bypasses
this pattern.** Its `noTypeAssertions()` and `noNonNullAssertions()` use
custom `evaluate()` bodies with direct
`getDescendantsOfKind(SyntaxKind.AsExpression)` walks — because no matcher
exists for `AsExpression` or `NonNullExpression`.

### The fix

Close the matcher gap. Add two new matchers to `src/helpers/matchers.ts`:

- `typeAssertion(options?)` — matches `SyntaxKind.AsExpression` (allows `as const` by default)
- `nonNullAssertion()` — matches `SyntaxKind.NonNullExpression`

Refactor the existing class rules to delegate to
`classNotContain(typeAssertion())`. Add the 4 missing function/module
variants as trivial one-liners. The typescript.ts file goes from ~120
LOC of custom logic to ~20 LOC of one-liners, matching security.ts
exactly.

### Why this is the right architecture

1. **Lego bricks.** Users can compose the matchers with any entry point
   that consumes `ExpressionMatcher` — `notContain(typeAssertion())`
   works on `classes()`, `functions()`, `modules()`, and any future
   entry point. Pre-canned rule functions only serve pre-canned use cases.

2. **Consistency.** Closes the `typescript.ts` pattern violation. All
   rule files in `src/rules/` follow the same form.

3. **Framework mindset.** `typeAssertion` and `nonNullAssertion` are
   primitives available to all users, including users writing custom
   rules with `satisfy(not(classNotContain(typeAssertion())))` or
   combining via `within(...)`.

## What the matchers detect

### `typeAssertion(options?)`

Matches `as Type` expressions. By default, `as const` is excluded (it
narrows types, doesn't widen — idiomatic for literal preservation).

```typescript
typeAssertion() // matches `as User`, excludes `as const`
typeAssertion({ allowConst: false }) // matches ALL as expressions including `as const`
```

**Implementation:** targets `SyntaxKind.AsExpression`. When `allowConst`
is `true` (default), checks if the type node is a `TypeReference` with
`getText() === 'const'` and skips the match.

**Semantics clarification** — polarity when used with `notContain()`:

| Call                                   | Matcher behavior          | With `notContain()`               |
| -------------------------------------- | ------------------------- | --------------------------------- |
| `typeAssertion()`                      | does NOT match `as const` | `as const` is **allowed** in code |
| `typeAssertion({ allowConst: false })` | matches `as const` too    | `as const` is **banned** in code  |

"Allow const" = permit `as const` to exist in user code (the default).

### `nonNullAssertion()`

Matches `!` non-null expressions. No options.

```typescript
nonNullAssertion() // matches `user!`, `arr[0]!`, `fn()!`
```

**Implementation:** targets `SyntaxKind.NonNullExpression`.

## Proposed API

### Matchers (new)

```typescript
// src/helpers/matchers.ts — additions

export interface TypeAssertionOptions {
  /**
   * Whether to allow `as const` in user code (default: true).
   * - `true` (default): `typeAssertion()` does NOT match `as const` — idiomatic literal preservation stays allowed.
   * - `false`: `typeAssertion()` matches `as const` too — bans ALL `as` expressions.
   */
  readonly allowConst?: boolean
}

/**
 * Match `as Type` type assertion expressions.
 *
 * By default, `as const` is excluded from matches (it narrows types rather
 * than widening them, so it's idiomatic for literal preservation).
 *
 * @example
 * // Allow `as const` in user code (default)
 * classes(p).should().notContain(typeAssertion()).check()
 *
 * @example
 * // Ban `as const` too — no `as` expressions of any kind
 * modules(p).should().notContain(typeAssertion({ allowConst: false })).check()
 */
export function typeAssertion(options?: TypeAssertionOptions): ExpressionMatcher {
  const allowConst = options?.allowConst ?? true
  return {
    description: 'type assertion',
    syntaxKinds: [SyntaxKind.AsExpression],
    matches(node: Node): boolean {
      if (!Node.isAsExpression(node)) return false
      if (!allowConst) return true
      const typeNode = node.getTypeNode()
      if (typeNode && Node.isTypeReference(typeNode) && typeNode.getText() === 'const') {
        return false
      }
      return true
    },
  }
}

/**
 * Match `!` non-null assertion expressions.
 *
 * @example
 * functions(p).should().notContain(nonNullAssertion()).check()
 */
export function nonNullAssertion(): ExpressionMatcher {
  return {
    description: 'non-null assertion',
    syntaxKinds: [SyntaxKind.NonNullExpression],
    matches(node: Node): boolean {
      return Node.isNonNullExpression(node)
    },
  }
}
```

### Rules (refactored + new)

```typescript
// src/rules/typescript.ts — full file after refactor

import type { ClassDeclaration, SourceFile } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import type { ArchFunction } from '../models/arch-function.js'
import { typeAssertion, nonNullAssertion } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'
import { functionNotContain } from '../conditions/body-analysis-function.js'
import { moduleNotContain } from '../conditions/body-analysis-module.js'

/**
 * Class properties must not be typed as `any`.
 * Detects both explicit `any` and untyped properties that resolve to `any`.
 *
 * Note: this rule stays as a custom `evaluate()` — it inspects type
 * resolution via `getType().getText()`, not AST expressions. Matcher
 * primitives target `SyntaxKind` nodes; a `TypeResolutionMatcher` would
 * be a different primitive (out of scope — see Out of Scope section).
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

// ─── Class variants (refactored to matchers) ──────────────────

export function noTypeAssertions(): Condition<ClassDeclaration> {
  return classNotContain(typeAssertion())
}

export function noNonNullAssertions(): Condition<ClassDeclaration> {
  return classNotContain(nonNullAssertion())
}

// ─── Function variants ────────────────────────────────────────

export function functionNoTypeAssertions(): Condition<ArchFunction> {
  return functionNotContain(typeAssertion())
}

export function functionNoNonNullAssertions(): Condition<ArchFunction> {
  return functionNotContain(nonNullAssertion())
}

// ─── Module variants ──────────────────────────────────────────

export function moduleNoTypeAssertions(): Condition<SourceFile> {
  return moduleNotContain(typeAssertion())
}

export function moduleNoNonNullAssertions(): Condition<SourceFile> {
  return moduleNotContain(nonNullAssertion())
}
```

**Result:** typescript.ts goes from ~120 LOC (with custom evaluate
bodies) to ~60 LOC (matching security.ts structure exactly).

### Index exports

`src/index.ts` currently exports matchers around line 186-195. Add
`typeAssertion`, `nonNullAssertion`, and `TypeAssertionOptions`:

```typescript
// Body analysis helpers (plan 0011 + 0046)
export {
  call,
  access,
  newExpr,
  expression,
  property,
  comment,
  jsxElement,
  typeAssertion,
  nonNullAssertion,
  STUB_PATTERNS,
} from './helpers/matchers.js'
export type { ExpressionMatcher, TypeAssertionOptions } from './helpers/matchers.js'
```

The rule variants are already re-exported via the `./rules/typescript`
sub-path; no `index.ts` changes needed there.

## Behavior changes to the existing class variants

Refactoring `noTypeAssertions()` and `noNonNullAssertions()` to use
`classNotContain()` produces two intentional behavior changes:

### 1. Scope widens to constructors, getters, setters

The existing implementation walks `cls.getMethods()` only. `classNotContain`
uses `searchClassBody` (`src/helpers/body-traversal.ts`), which walks
methods + constructors + getters + setters — matching
`noSilentCatch()`'s scope.

**This is a bug fix.** A class with `constructor() { const x = data as User }`
should be flagged. The existing behavior misses it. The refactor closes
this gap.

### 2. Violation message format changes

Existing custom messages:

- `MyClass.myMethod uses type assertion — use type guards instead`
- `MyClass.myMethod uses non-null assertion — handle the null case explicitly`

New messages (from `classNotContain` + matcher description):

- `MyClass contains type assertion (as) at <line>`
- `MyClass contains non-null assertion (!) at <line>`

The new format is consistent with every other rule in the family. Line
numbers are included (code-frame delegation already handles this).

Both changes require test-fixture updates. No behavior regression.

## Implementation

### Phase 1: Matchers (~15 min)

1. Add `TypeAssertionOptions` type, `typeAssertion(options?)`, and
   `nonNullAssertion()` to `src/helpers/matchers.ts`.
2. Add exports to `src/index.ts`.

### Phase 2: Rules refactor (~15 min)

3. Rewrite `noTypeAssertions()` and `noNonNullAssertions()` in
   `src/rules/typescript.ts` as one-line `classNotContain(...)` calls.
4. Add `functionNoTypeAssertions()`, `functionNoNonNullAssertions()`,
   `moduleNoTypeAssertions()`, `moduleNoNonNullAssertions()`.

### Phase 3: Tests (~1-2 hours)

5. Matcher tests in `tests/helpers/matchers.test.ts` (or new
   `tests/helpers/matchers-typescript.test.ts` if the file is large).
6. Smoke tests per rule variant in
   `tests/rules/typescript-function-module.test.ts`.
7. Update existing `tests/rules/typescript-rules.test.ts` for new
   message format and widened scope (add a constructor/getter test).

### Phase 4: Docs (~15 min)

8. `docs/body-analysis.md` — document the two new matchers alongside
   `call`, `access`, `newExpr`, etc.
9. `docs/standard-rules.md` — add function/module variants to the
   TypeScript section.
10. `docs/api-reference.md` — add matchers and rules to the relevant
    tables.

## Files changed

| File                                             | Change                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| `src/helpers/matchers.ts`                        | Add `typeAssertion()`, `nonNullAssertion()`, `TypeAssertionOptions`    |
| `src/rules/typescript.ts`                        | Refactor class rules to matchers, add 4 variants (net ~60 LOC removed) |
| `src/index.ts`                                   | Export the 2 new matchers + type                                       |
| `tests/helpers/matchers.test.ts`                 | Add matcher tests                                                      |
| `tests/rules/typescript-rules.test.ts`           | Update for new message format + widened scope                          |
| `tests/rules/typescript-function-module.test.ts` | New — smoke tests for 4 new variants                                   |
| `docs/body-analysis.md`                          | Document 2 new matchers                                                |
| `docs/standard-rules.md`                         | Add function/module variants to TypeScript section                     |
| `docs/api-reference.md`                          | Update matchers and rules tables                                       |
| `CHANGELOG.md`                                   | Add `### Behavior changes` subsection + `### Added` entries            |

No `package.json` changes. Rules go through existing
`./rules/typescript` sub-path export.

### CHANGELOG entry

Under the next version's `## [x.y.z]` heading:

```markdown
### Added

- **`typeAssertion()` and `nonNullAssertion()` matchers** — compose with
  any body-analysis entry point (`classes`, `functions`, `modules`,
  `within()`). `typeAssertion({ allowConst: false })` bans `as const` too.
- **Function and module variants of the TypeScript rules** —
  `functionNoTypeAssertions()`, `functionNoNonNullAssertions()`,
  `moduleNoTypeAssertions()`, `moduleNoNonNullAssertions()`.

### Behavior changes

- **`noTypeAssertions()` / `noNonNullAssertions()` now scan constructors,
  getters, and setters**, not just methods. Bug fix — matches the scope
  of `noSilentCatch()`. Classes relying on the old narrower scope will
  see new violations.
- **Violation message format for `noTypeAssertions()` /
  `noNonNullAssertions()` changed** to the generic
  `<Class> contains type assertion at line N` / `... non-null assertion ...`
  form. Consistent with every other rule in `rules/security.ts` and
  `rules/errors.ts`. Snapshot tests and log-parsers may need updates.
```

## Test strategy (~15 tests)

### Matcher tests (8 tests in `matchers.test.ts`)

`typeAssertion()`:

- Matches `data as User`
- Does NOT match `['a', 'b'] as const` (default)
- Matches `['a', 'b'] as const` with `{ allowConst: false }`
- Does NOT match `call()`, `new Foo()`, etc. (wrong syntax kind)
- Description is `'type assertion (as)'`

`nonNullAssertion()`:

- Matches `user!`
- Matches `arr[0]!`
- Does NOT match `data as User`, `!x` (LogicalNot), etc.

### Rule smoke tests (7 tests in `typescript-function-module.test.ts`)

- `functionNoTypeAssertions()` catches violation in standalone function
- `functionNoTypeAssertions()` passes when function uses type guards
- `functionNoNonNullAssertions()` catches violation in arrow function
- `moduleNoTypeAssertions()` catches violation at module top-level
- `moduleNoTypeAssertions()` catches violation inside class method
- `moduleNoNonNullAssertions()` catches violation anywhere in file
- All 4 variants pass when file has only `as const`

### Existing test updates (in `typescript-rules.test.ts`)

- Update message assertions for new `<element> contains <matcher description> at <line>` format
- Add test confirming scope now includes constructor
- Add test confirming scope now includes getter

## Documentation updates

### `docs/body-analysis.md`

Add to the matcher section (after `jsxElement()`, before `comment()`):

````markdown
### `typeAssertion(options?)`

Matches `as Type` type assertion expressions. By default, `as const` is
excluded (it's idiomatic for literal preservation). Pass
`{ allowConst: false }` to match `as const` too.

```typescript
import { typeAssertion } from '@nielspeter/ts-archunit'

typeAssertion() // matches `data as User`, skips `as const`
typeAssertion({ allowConst: false }) // matches all `as` expressions
```

```typescript
// No type assertions anywhere in src/
modules(p).that().resideInFolder('**/src/**').should().notContain(typeAssertion()).check()
```

### `nonNullAssertion()`

Matches `!` non-null assertion expressions.

```typescript
import { nonNullAssertion } from '@nielspeter/ts-archunit'

nonNullAssertion() // matches `user!`, `arr[0]!`, `fn()!`
```

```typescript
// No ! assertions in domain code — handle null explicitly
functions(p).that().resideInFolder('**/domain/**').should().notContain(nonNullAssertion()).check()
```
````

Update matcher count in `docs/body-analysis.md` from "Seven matchers" to "Nine matchers".

### `docs/standard-rules.md`

Add the 4 new variants to the TypeScript rules section. Show the full
class/function/module matrix:

```typescript
import {
  noTypeAssertions,
  noNonNullAssertions,
  functionNoTypeAssertions,
  functionNoNonNullAssertions,
  moduleNoTypeAssertions,
  moduleNoNonNullAssertions,
} from '@nielspeter/ts-archunit/rules/typescript'

// Enforce on classes
classes(p).should().satisfy(noTypeAssertions()).check()

// Enforce on functions
functions(p).should().satisfy(functionNoTypeAssertions()).check()

// Enforce on the entire file
modules(p).should().satisfy(moduleNoTypeAssertions()).check()
```

Add note: "Prefer the `typeAssertion()` / `nonNullAssertion()` matchers
directly if you need custom scoping or composition — the rule functions
are thin wrappers over `notContain(matcher)`."

### `docs/api-reference.md`

- Body Analysis Matchers table: add `typeAssertion` and `nonNullAssertion`
- Standard Rules table: add the 4 new function/module rule names

## Out of scope

### "No `any` anywhere" matcher

`SyntaxKind.AnyKeyword` matcher (e.g., `anyType()`) would let users ban
`any` in type annotations, return types, and parameters. Different surface
from `noAnyProperties()` (which checks class property declarations via
`getProperties()`). Separate plan if demand emerges — the matcher pattern
established here makes it additive.

### `as unknown as T` double-cast detection

The `typeAssertion()` matcher already catches each `as` expression
individually. A dedicated double-cast detector would require matching
nested `AsExpression` nodes — a separate concern.

### `satisfies` operator

`x satisfies Type` is the modern, type-safe alternative to `as Type`. No
rule needed — it's the solution, not the problem.

### Class variant message back-compat shim

Not worth the complexity. The new message format is strictly better
(consistent, line-numbered, matches every other rule). Users relying on
the old message format in snapshot tests or log-parsing scripts update
once.
