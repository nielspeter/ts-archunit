# Plan 0032: Member Visibility Predicates

## Status

- **State:** Done
- **Priority:** P2 — Missing axis of inspection; blocks precise method-level assertions
- **Effort:** 0.5 day
- **Created:** 2026-03-27
- **Depends on:** 0007 (Class Entry Point), 0009 (Function Entry Point)

## Broader Context

Part of the **member inspection** capability layer (plans 0030, 0031, 0032).

ts-archunit is a testing framework — it ships primitives, not opinions. Currently users can filter **classes** by predicates and assert conditions on them as a whole. But they cannot scope assertions to **specific members** of a class by visibility. This plan adds the visibility axis.

Bug 0004 (multi-tenant repo methods) exposed this gap: the user wanted to assert "all public methods on repositories accept TenancyContext" but couldn't filter to public methods only. The real missing primitive isn't tenancy checking — it's **member visibility filtering**.

## Problem

Today, `functions()` with `collectFunctions(includeMethods: true)` collects class methods into `ArchFunction`. But there's no way to filter by visibility:

```typescript
// Can't express today:
// "public methods on Service classes should not return void"
// "private methods should not be async"
// "protected methods should have parameter count < 5"
```

The `ArchFunction` model already wraps methods via `fromMethodDeclaration()`. It has `getName()`, `getParameters()`, `isAsync()`, `isExported()`, `getReturnType()`. But no visibility info is exposed.

## Design Decisions

### 1. Visibility predicates on ArchFunction

Add predicates that work on the `functions()` entry point:

- `arePublic()` — no access modifier or explicitly `public`
- `areProtected()` — `protected` modifier
- `arePrivate()` — `private` modifier

These filter `ArchFunction` elements. Since `ArchFunction` wraps both standalone functions and class methods, the predicates need defined behavior for non-method functions:

- **Standalone functions / arrow functions:** Always match `arePublic()` (they're module-level, no visibility modifier concept). Never match `areProtected()` or `arePrivate()`.
- **Class methods:** Check the actual modifier via ts-morph's `MethodDeclaration.getScope()`.

### 2. Expose visibility on ArchFunction model

Add `getScope(): 'public' | 'protected' | 'private'` to the `ArchFunction` interface. Implementation:

- `fromFunctionDeclaration` → always `'public'`
- `fromArrowVariableDeclaration` → always `'public'`
- `fromMethodDeclaration` → delegates to `method.getScope()` (ts-morph returns `Scope.Public | Scope.Protected | Scope.Private`, defaulting to `Public` when no modifier is present)

### 3. Composability with 0031

With visibility predicates, 0004's full use case becomes composable:

```typescript
// "Public methods on repositories must accept TenancyContext"
functions(p)
  .that()
  .resideInFolder('**/repositories/**')
  .and()
  .arePublic()
  .should()
  .acceptParameterOfType(matching(/TenancyContext/))
  .check()
```

No special API needed — just two independent bricks composed in a fluent chain.

### 4. Class-level visibility predicates

Also add predicates on `ClassRuleBuilder` for filtering classes by member visibility patterns:

- `havePublicMethodNamed(name)` — class has a public method with this name
- `havePublicMethodMatching(regex)` — class has a public method matching pattern

These are convenience predicates — the same thing can be achieved via `functions()` + `arePublic()`, but having them on the class builder reads more naturally for class-level rules.

**Decision: defer class-level convenience predicates.** The `functions()` + `arePublic()` composition covers all use cases. Adding class-level variants is sugar that can come later if demand appears. Ship the primitive first.

## Phase 1: Extend ArchFunction Model

### `src/models/arch-function.ts`

Add to the `ArchFunction` interface:

```
getScope(): 'public' | 'protected' | 'private'
```

Implement in all three factory functions:

- `fromFunctionDeclaration` → `'public'`
- `fromArrowVariableDeclaration` → `'public'`
- `fromMethodDeclaration` → map `method.getScope()` to the string union

## Phase 2: Visibility Predicates

### `src/predicates/function.ts` — add to existing file

Three predicate factories:

- `arePublic()` → `fn.getScope() === 'public'`
- `areProtected()` → `fn.getScope() === 'protected'`
- `arePrivate()` → `fn.getScope() === 'private'`

## Phase 3: Wire Into Builder

### `src/builders/function-rule-builder.ts`

Three new predicate methods:

```
arePublic(): this
areProtected(): this
arePrivate(): this
```

## Phase 4: Exports

### `src/index.ts`

Export `arePublic`, `areProtected`, `arePrivate` from `predicates/function.js`.

## Phase 5: Fixtures

Extend `tests/fixtures/poc/src/members.ts` (shared with 0030/0031) with a class that has methods of different visibility:

```typescript
export class MixedVisibility {
  public getPublicData(): string {
    return ''
  }
  protected loadInternal(): void {}
  private validate(): boolean {
    return true
  }
  noModifier(): string {
    return ''
  } // implicitly public
}
```

## Files Changed

| File                                           | Change                                                         |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `src/models/arch-function.ts`                  | Modified — add `getScope()` to interface + 3 factory functions |
| `src/predicates/function.ts`                   | Modified — add `arePublic`, `areProtected`, `arePrivate`       |
| `src/builders/function-rule-builder.ts`        | Modified — add 3 predicate methods                             |
| `src/index.ts`                                 | Modified — export 3 new predicates                             |
| `tests/fixtures/poc/src/members.ts`            | Modified — add `MixedVisibility` class                         |
| `tests/predicates/function-visibility.test.ts` | **New** — unit tests                                           |
| `tests/integration/function-rules.test.ts`     | Modified — add integration tests                               |

## Test Inventory

### `tests/predicates/function-visibility.test.ts`

**arePublic:**

1. **matches explicitly public method** — `MixedVisibility.getPublicData`
2. **matches method with no modifier (implicitly public)** — `MixedVisibility.noModifier`
3. **does not match protected method** — `MixedVisibility.loadInternal`
4. **does not match private method** — `MixedVisibility.validate`
5. **matches standalone function** — always public
6. **matches arrow function** — always public

**areProtected:** 7. **matches protected method** — `MixedVisibility.loadInternal` 8. **does not match public method** 9. **does not match standalone function** — never protected

**arePrivate:** 10. **matches private method** — `MixedVisibility.validate` 11. **does not match public method** 12. **does not match standalone function** — never private

### Integration tests

13. **functions(p).that().arePublic().and().haveNameMatching(/^get/).should().beExported().check()** — public getters must be exported
14. **functions(p).that().arePrivate().and().haveParameterCountGreaterThan(5).should().notExist().check()** — private methods with too many params
15. **Compose with 0031: functions(p).that().arePublic().and().resideInFolder('**/repos/**').should().acceptParameterOfType(matching(/TenancyContext/)).check()** — the full 0004 use case

## Out of Scope

- **Class-level convenience predicates** (`havePublicMethodNamed`, `havePublicMethodMatching`) — Sugar over `functions()` + `arePublic()`. Defer unless demand appears.
- **`areStatic()` predicate** — Static vs instance is another axis. Useful but separate. Defer.
- **Constructor visibility** — Constructors can be private/protected (singleton pattern). Could add, but niche. Defer.
- **Property visibility** — `arePublic` on properties, not just methods. Different ts-morph API surface. Defer as separate brick.
