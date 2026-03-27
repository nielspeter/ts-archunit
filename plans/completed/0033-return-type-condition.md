# Plan 0033: Return Type Condition

## Status

- **State:** Done
- **Priority:** P2 — Completes the function signature condition layer
- **Effort:** 0.25 day
- **Created:** 2026-03-27
- **Depends on:** 0009 (Function Entry Point)

## Broader Context

Part of the **member inspection** capability layer. `haveReturnType(pattern)` already exists as a **predicate** (filter in `.that()`). The condition variant (assert in `.should()`) is missing — same predicate-to-condition gap that 0031 fills for parameter types.

**Resolves:** bug 0005 (method return type checking). The user's 30-line `defineCondition` repeated 3 times for list/create/delete methods reduces to composing existing predicates with this single new brick.

## Problem

No condition exists to assert on return types. Users must use the awkward predicate + `notExist()` workaround:

```typescript
// Awkward: filter to methods NOT returning Collection, assert they don't exist
functions(p)
  .that()
  .haveNameMatching(/^list/)
  .and()
  .satisfy(not(haveReturnType(/Collection/)))
  .should()
  .notExist()
  .check()
```

The missing brick makes this direct:

```typescript
functions(p)
  .that()
  .haveNameMatching(/^list/)
  .should()
  .haveReturnTypeMatching(matching(/Collection/))
  .check()
```

## Design Decisions

### 1. Use `TypeMatcher`, not `RegExp`

The existing predicate `haveReturnType(pattern: RegExp | string)` uses regex on `getReturnType().getText()`. The new condition uses `TypeMatcher` instead — this is more powerful (supports `isString()`, `arrayOf()`, `not()`, `matching()`, `exactly()`) and consistent with `havePropertyType(name, matcher)` and `acceptParameterOfType(matcher)` from 0031.

### 2. Single brick: `haveReturnTypeMatching(matcher)`

Not `haveReturnType` — that name is taken by the predicate. `haveReturnTypeMatching` is distinct and mirrors `havePropertyMatching` from 0030.

### 3. Functions only (via FunctionRuleBuilder)

`ArchFunction` wraps standalone functions, arrows, AND class methods. So this brick already works for class methods — no separate class condition needed.

## Phase 1: Condition Factory

### `src/conditions/function.ts` — add to existing file

**`haveReturnTypeMatching(matcher: TypeMatcher)`**

- Passes if `matcher(fn.getReturnType())` returns true
- Violation message: `"{functionName} has return type '{typeText}' which does not match the expected type constraint"`
- Uses the existing `functionCondition` helper in the same file

## Phase 2: Wire Into Builder

### `src/builders/function-rule-builder.ts`

```
haveReturnTypeMatching(matcher: TypeMatcher): this
```

## Phase 3: Exports

### `src/index.ts`

Export `haveReturnTypeMatching` from `conditions/function.js` (aliased as `functionHaveReturnTypeMatching` if needed to avoid collision).

## Files Changed

| File                                       | Change                                  |
| ------------------------------------------ | --------------------------------------- |
| `src/conditions/function.ts`               | Modified — add `haveReturnTypeMatching` |
| `src/builders/function-rule-builder.ts`    | Modified — add 1 condition method       |
| `src/index.ts`                             | Modified — export new condition         |
| `tests/conditions/function.test.ts`        | Modified — add unit tests               |
| `tests/integration/function-rules.test.ts` | Modified — add integration tests        |

## Test Inventory

### Unit tests

1. **passes when return type matches** — function returning `Promise<string>` matches `matching(/Promise/)`
2. **fails when return type does not match** — function returning `void` does not match `matching(/Collection/)`
3. **works with `isString()` matcher** — function returning `string` passes
4. **works with `not()` combinator** — function returning `void` passes `not(isString())`
5. **works with `exactly()` matcher** — exact type text match
6. **works on class methods via functions()** — method returning `Collection<T>` matches

### Integration tests

7. **functions(p).that().haveNameMatching(/^list/).should().haveReturnTypeMatching(matching(/Collection/)).check()** — the 0005 list method use case
8. **functions(p).that().haveNameMatching(/^create/).should().haveReturnTypeMatching(not(exactly('void'))).check()** — create must not return void
9. **Compose with 0032: functions(p).that().arePublic().should().haveReturnTypeMatching(not(matching(/any/))).check()** — public functions should not return `any`

## Out of Scope

- **Class-level return type condition** — Not needed; `functions()` already collects class methods.
- **Multiple return type assertions** — Users chain `.andShould().haveReturnTypeMatching(...)` for AND semantics. No special API needed.
