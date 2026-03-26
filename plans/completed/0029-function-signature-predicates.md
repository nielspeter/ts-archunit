# Plan 0029: Function Signature Predicates & Conditions

## Status

- **State:** Done
- **Priority:** P3 — Enables dogfooding rules that prevent API inconsistencies
- **Effort:** 0.5 day
- **Created:** 2026-03-26
- **Depends on:** 0009 (Function Entry Point)

## Problem

ts-archunit can inspect what happens **inside** function bodies (call, newExpr, access), but cannot assert on **function signatures** beyond basic parameter count and return type. This gap was exposed by a real user bug: `.notImportFrom('fastify', 'knex', 'bullmq')` silently ignored arguments 2 and 3 because the predicate accepted `(glob: string)` while the condition variant accepted `(...globs: string[])`.

We want to write a dogfooding rule that catches this class of bug:

```typescript
// Predicate functions in predicates/ must not accept a single 'glob' parameter
// — they should use ...globs to match their condition counterparts
functions(p)
  .that()
  .resideInFolder('**/src/predicates/**')
  .and()
  .areExported()
  .and()
  .haveParameterNamed('glob')
  .and()
  .haveParameterCount(1)
  .should()
  .notExist()
  .because('use ...globs variadic to match condition variants')
  .check()
```

And more generally, users need signature-level predicates for rules like:

```typescript
// Event handlers must accept exactly one Event parameter — filter to
// handlers with an Event param AND more than 1 param, assert none exist
functions(p)
  .that()
  .haveNameMatching(/^handle/)
  .and()
  .haveParameterOfType(0, matching(/Event$/))
  .and()
  .haveParameterCountGreaterThan(1)
  .should()
  .notExist()
  .check()

// No rest parameters in route handlers (forces explicit typing)
functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .and()
  .haveRestParameter()
  .should()
  .notExist()
  .check()
```

## Design Decisions

### Predicates on ArchFunction

All new predicates operate on `ArchFunction` which already exposes `getParameters(): ParameterDeclaration[]`. ts-morph's `ParameterDeclaration` has:

- `.isRestParameter()` — `...args`
- `.isOptional()` — `arg?: type`
- `.hasInitializer()` — `arg = default`
- `.getType()` — resolved type
- `.getName()` — parameter name
- `.getTypeNode()` — type annotation node

No changes to `ArchFunction` needed.

### Predicate vs condition

These are all **predicates** (filtering in `.that()`), not conditions. "Has a rest parameter" is a property you filter by, not a rule you assert. The assertion comes from combining with conditions: `.should().notExist()`, `.should().beExported()`, etc.

### Parameter type matching

For `haveParameterOfType(index, matcher)`, reuse the existing `TypeMatcher` from `src/helpers/type-matchers.ts`. This gives users `isString()`, `isNumber()`, `matching(/Event$/)`, `exactly('string[]')`, etc.

**Type semantics to document:**

- **Rest parameters:** `...args: string[]` has type `string[]`, not `string`. So `haveParameterOfType(0, isString())` returns `false` for a rest parameter — use `haveParameterOfType(0, arrayOf(isString()))` or `exactly('string[]')` instead.
- **Optional parameters:** `x?: string` has type `string | undefined`, but `TypeMatcher` functions like `isString()` call `getNonNullableType()` internally, stripping the `undefined`. So `haveParameterOfType(0, isString())` returns `true` for `x?: string`. This is intentional — the TypeMatcher contract strips nullability.
- **Index validation:** Negative or non-integer indices return `false` (array access returns `undefined`). Document this as safe behavior, not an error.

## Phase 1: New Function Predicates

### `src/predicates/function.ts` — add to existing file

```typescript
/**
 * Matches functions that have at least one rest parameter (...args).
 */
export function haveRestParameter(): Predicate<ArchFunction> {
  return {
    description: 'have a rest parameter',
    test: (fn) => fn.getParameters().some((p) => p.isRestParameter()),
  }
}

/**
 * Matches functions that have at least one optional parameter.
 */
export function haveOptionalParameter(): Predicate<ArchFunction> {
  return {
    description: 'have an optional parameter',
    test: (fn) => fn.getParameters().some((p) => p.isOptional() || p.hasInitializer()),
  }
}

/**
 * Matches functions that have a parameter at the given index
 * whose type matches the given TypeMatcher.
 *
 * Note: For rest parameters (...args: string[]), the type is string[] not string.
 * Use arrayOf(isString()) or exactly('string[]') to match rest param types.
 * For optional parameters (x?: string), TypeMatcher strips undefined automatically.
 *
 * @example
 * functions(p).that().haveParameterOfType(0, isString()).should()...
 * functions(p).that().haveParameterOfType(0, matching(/Event$/)).should()...
 */
export function haveParameterOfType(index: number, matcher: TypeMatcher): Predicate<ArchFunction> {
  return {
    description: `have parameter at index ${String(index)} with matching type`,
    test: (fn) => {
      const params = fn.getParameters()
      const param = params[index]
      if (!param) return false
      return matcher(param.getType())
    },
  }
}

/**
 * Matches functions that have a parameter whose name matches the given pattern.
 * Unlike haveParameterNamed (exact match), this accepts a regex.
 */
export function haveParameterMatching(pattern: RegExp): Predicate<ArchFunction> {
  return {
    description: `have a parameter matching ${String(pattern)}`,
    test: (fn) => fn.getParameters().some((p) => pattern.test(p.getName())),
  }
}
```

## Phase 2: Builder Methods

### `src/builders/function-rule-builder.ts` — add methods

```typescript
haveRestParameter(): this {
  return this.addPredicate(haveRestParameterPredicate())
}

haveOptionalParameter(): this {
  return this.addPredicate(haveOptionalParameterPredicate())
}

haveParameterOfType(index: number, matcher: TypeMatcher): this {
  return this.addPredicate(haveParameterOfTypePredicate(index, matcher))
}

haveParameterMatching(pattern: RegExp): this {
  return this.addPredicate(haveParameterMatchingPredicate(pattern))
}
```

## Phase 3: Exports

### `src/index.ts`

```typescript
export {
  // existing...
  haveRestParameter,
  haveOptionalParameter,
  haveParameterOfType,
  haveParameterMatching,
} from './predicates/function.js'
```

## Phase 4: Dogfooding Rule

### `tests/archunit/arch-rules.test.ts` — add rule

```typescript
describe('API consistency', () => {
  it('no rest-parameter functions in predicates/ should have a single-glob condition twin', () => {
    // This is the "meta" rule that would have caught the .notImportFrom() bug.
    // If a predicate takes ...globs (rest param), the pattern is consistent.
    // If it takes (glob: string) while a condition takes (...globs), that's a mismatch.
    // For now, enforce: exported predicate functions should not have
    // single-string parameters named "glob" — use ...globs instead.
    functions(p)
      .that()
      .resideInFolder('**/src/predicates/**')
      .and()
      .areExported()
      .and()
      .haveParameterNamed('glob')
      .and()
      .haveParameterCount(1)
      .should()
      .notExist()
      .rule({
        id: 'api/no-single-glob-predicates',
        because: 'Single-glob predicates silently ignore extra arguments — use ...globs variadic',
        suggestion: 'Change (glob: string) to (...globs: string[]) to match condition variants',
      })
      .check()
  })
})
```

## Phase 5: Tests

### Fixtures

Reuse `tests/fixtures/poc/` — it has functions with various parameter signatures.

### `tests/predicates/function-signature.test.ts`

1. **haveRestParameter matches function with ...args** — positive
2. **haveRestParameter does not match function without rest param** — negative
3. **haveOptionalParameter matches function with optional param** — positive
4. **haveOptionalParameter matches function with default value** — positive
5. **haveOptionalParameter does not match function with only required params** — negative
6. **haveParameterOfType matches first param type** — positive with isString()
7. **haveParameterOfType rejects wrong type** — negative
8. **haveParameterOfType returns false for out-of-bounds index** — edge case
9. **haveParameterOfType on rest param returns array type, not element type** — isString() returns false for ...args: string[]
10. **haveParameterOfType on optional param — isString() matches despite string|undefined** — TypeMatcher strips nullability
11. **haveParameterMatching matches param names by regex** — positive
12. **haveParameterMatching rejects non-matching names** — negative

### Integration test

11. **Full fluent chain: functions(p).that().haveRestParameter().should().notExist().check()**
12. **Full fluent chain: functions(p).that().haveOptionalParameter().should().beExported().check()**
13. **Full fluent chain: functions(p).that().haveParameterOfType(0, matching(/string/)).should()...**

### Fixture additions

Add to `tests/fixtures/poc/src/`:

```typescript
// signature-variants.ts
export function withRest(...items: string[]): void {
  void items
}
export function withOptional(name?: string): void {
  void name
}
export function withDefault(count = 10): void {
  void count
}
export function allRequired(a: string, b: number): void {
  void [a, b]
}
```

## Files Changed

| File                                           | Change                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/predicates/function.ts`                   | Modified — add haveRestParameter, haveOptionalParameter, haveParameterOfType, haveParameterMatching |
| `src/builders/function-rule-builder.ts`        | Modified — add 4 builder methods                                                                    |
| `src/index.ts`                                 | Modified — export new predicates                                                                    |
| `tests/fixtures/poc/src/signature-variants.ts` | New — fixture with rest/optional/default params                                                     |
| `tests/predicates/function-signature.test.ts`  | New — 10 unit tests                                                                                 |
| `tests/integration/function-rules.test.ts`     | Modified — add 3 integration tests                                                                  |
| `tests/archunit/arch-rules.test.ts`            | Modified — add API consistency dogfooding rule                                                      |

## Out of Scope

- **Class method signature predicates** — same predicates on `ClassDeclaration` methods. Add when demand emerges. Users can use `defineCondition` with ts-morph to inspect method signatures today.
- **Return type conditions** — `shouldReturnType(matcher)` as a condition (not just a predicate). Defer — `haveReturnType` as a predicate + `.notExist()` covers most cases.
- **Parameter order validation** — "optional before required" detection. Interesting but TypeScript already warns about this. Defer.
- **Generic type parameter predicates** — `haveTypeParameter('T')`. Niche. Defer.
- **Cross-function signature comparison** — "predicate X and condition X must have same arity." This is the full version of the dogfooding rule. Too complex for v1 — the simpler "no single-glob predicates" rule catches the pattern.
