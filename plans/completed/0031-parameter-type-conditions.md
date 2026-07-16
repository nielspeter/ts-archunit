# Plan 0031: Parameter Type Conditions

## Status

- **State:** Done
- **Priority:** P2 — Enables type-safe DI boundary enforcement; currently requires fragile body string matching
- **Effort:** 0.5 day
- **Created:** 2026-03-27
- **Depends on:** 0007 (Class Entry Point), 0009 (Function Entry Point), 0029 (Signature Predicates)

## Broader Context

Part of the **member inspection conditions** capability layer (see plan 0030). Bug reports 0002 (property names), 0003 (parameter types), and 0004 (method parameter names/types) are all symptoms of the same gap — users can filter by shape but can't assert on shape. This plan delivers the parameter type bricks; 0030 delivers the property bricks.

**Resolves:** bug 0003 (constructor/function parameter types). Together with plan 0032 (visibility predicates), also resolves bug 0004 (method parameter types with visibility filtering) — the multi-tenant use case becomes `functions(p).that().arePublic().should().acceptParameterOfType(matching(/TenancyContext/))` by composing bricks from both plans.

## Problem

Enforcing "services must not access the database directly" requires fragile body string matching:

```typescript
// From the originating project — brittle, matches this.dbToApiTeam as false positive
classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .notContain(call(/^this\.db[.(]/))
  .check()
```

The real constraint is: **a service should not receive a `Knex` instance as a parameter.** If it never receives one, it can't access the database. This is a common DDD/clean architecture pattern.

## Design Decisions

### 1. Two generic conditions: `acceptParameterOfType` / `notAcceptParameterOfType`

These compose with the existing `TypeMatcher` system (`matching(/Knex/)`, `exactly('Knex')`, `isString()`, etc.) — same matchers used by `havePropertyType` and `haveParameterOfType`.

### 2. Work on both classes and functions

- **Classes:** Scan constructor + all methods + setters. DI can happen through any of these. Uses `cls.getConstructors()`, `cls.getMethods()`, `cls.getSetAccessors()` — each returns declarations with `.getParameters()`.
- **Functions (ArchFunction):** Scan all parameters via `fn.getParameters()`. Covers standalone factory functions, arrow functions, and class methods (via `collectFunctions`).

**Scope asymmetry to document:** The class-side condition scans set accessors, but `collectFunctions()` does not collect set accessors (only methods). So `classes(p).should().notAcceptParameterOfType(...)` catches setter injection while `functions(p).should().notAcceptParameterOfType(...)` does not. This is by design — different scopes — but must be documented in JSDoc.

Separate condition files per element type (matching existing `conditions/class.ts` and `conditions/function.ts`), not a shared generic file — because the parameter extraction logic differs fundamentally (class scans multiple member signatures; ArchFunction has a single parameter list).

### 3. Relationship to existing predicates

Functions already have `haveParameterOfType(index, matcher)` as a **predicate** (plan 0029). The new conditions are complementary, not redundant:

| Existing predicate                         | New condition                                  |
| ------------------------------------------ | ---------------------------------------------- |
| Index-based: check parameter at position N | Scan-based: check ALL parameters               |
| Filter (`.that()`)                         | Assert (`.should()`)                           |
| Single function                            | Classes: scans constructor + methods + setters |

### 4. Violation granularity

`notAcceptParameterOfType` reports one violation **per parameter** that matches — not per class/function. This gives actionable output: "OrderService.constructor parameter `db` has type `Knex`" pinpoints exactly where the violation is.

`acceptParameterOfType` reports one violation **per element** that has no matching parameter — "OrderRepository has no parameter matching type `Knex`".

### 5. Builder method naming

- **ClassRuleBuilder:** `acceptParameterOfType(matcher)` / `notAcceptParameterOfType(matcher)` — no `should` prefix needed (no predicate collision).
- **FunctionRuleBuilder:** Same names, same pattern.

## Phase 1: Class Parameter Type Conditions

### `src/conditions/class.ts` — add to existing file

Two new condition factories:

**`acceptParameterOfType(matcher: TypeMatcher)`**

- Scans all constructors, methods, and set accessors on the class
- Collects all `ParameterDeclaration` across these members
- Passes if at least one parameter's type satisfies `matcher`
- Violation message: `"{ClassName} has no parameter with matching type"`

**`notAcceptParameterOfType(matcher: TypeMatcher)`**

- Same scan: constructors, methods, set accessors
- Reports violation for each parameter whose type satisfies `matcher`
- Violation message: `"{ClassName}.{memberName} parameter "{paramName}" has type "{typeText}""`
- Include member name (e.g., `constructor`, `connect`, `setDb`) in the message for actionability
- Note: `ConstructorDeclaration` has no `getName()` — hardcode `"constructor"` as the member name

Parameter type resolution: use `param.getType()` which resolves through the type checker. `TypeMatcher` already calls `getNonNullableType()` internally (per type-matchers.ts contract), so optional parameters are handled.

## Phase 2: Function Parameter Type Conditions

### `src/conditions/function.ts` — add to existing file

Same two condition factories, typed over `ArchFunction`:

**`acceptParameterOfType(matcher: TypeMatcher)`**

- Uses `fn.getParameters()` to get the parameter list
- Passes if at least one parameter's type satisfies `matcher`
- Violation message: `"{functionName} has no parameter with matching type"`

**`notAcceptParameterOfType(matcher: TypeMatcher)`**

- Reports violation per parameter whose type satisfies `matcher`
- Violation message: `"{functionName} parameter "{paramName}" has type "{typeText}""`

## Phase 3: Wire Into Builders

### `src/builders/class-rule-builder.ts`

```
acceptParameterOfType(matcher: TypeMatcher): this
notAcceptParameterOfType(matcher: TypeMatcher): this
```

### `src/builders/function-rule-builder.ts`

```
acceptParameterOfType(matcher: TypeMatcher): this
notAcceptParameterOfType(matcher: TypeMatcher): this
```

## Phase 4: Exports

### `src/index.ts`

Export from `conditions/class.ts` (aliased with `class` prefix if needed) and `conditions/function.ts` (aliased with `function` prefix if needed). Follow existing aliasing patterns in index.ts.

## Phase 5: Fixtures

### `tests/fixtures/poc/src/members.ts` — extend fixture from plan 0030

Add classes and functions with various parameter types for testing:

```typescript
// Classes with typed constructor/method params
export class ServiceWithKnex {
  constructor(private db: import('knex').Knex) {}
}
export class ServiceWithoutKnex {
  constructor(private logger: Logger) {}
}
export class ServiceWithKnexMethod {
  connect(db: import('knex').Knex): void {
    /* ... */
  }
}
```

Since we can't import Knex in fixtures, use local stand-in types:

```typescript
// Stand-in types for DI boundary testing
interface DatabaseClient {
  query(sql: string): void
}
interface Logger {
  log(msg: string): void
}

export class ServiceAcceptingDb {
  constructor(private db: DatabaseClient) {}
}
export class CleanService {
  constructor(private logger: Logger) {}
}
export class ServiceWithDbMethod {
  connect(db: DatabaseClient): void {
    void db
  }
}
export class RepoAcceptingDb {
  constructor(
    private db: DatabaseClient,
    private logger: Logger,
  ) {}
}

export function createServiceWithDb(db: DatabaseClient): void {
  void db
}
export function createCleanService(logger: Logger): void {
  void logger
}
```

## Files Changed

| File                                       | Change                                                             |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `src/conditions/class.ts`                  | Modified — add `acceptParameterOfType`, `notAcceptParameterOfType` |
| `src/conditions/function.ts`               | Modified — add `acceptParameterOfType`, `notAcceptParameterOfType` |
| `src/builders/class-rule-builder.ts`       | Modified — add 2 condition methods                                 |
| `src/builders/function-rule-builder.ts`    | Modified — add 2 condition methods                                 |
| `src/index.ts`                             | Modified — export new conditions                                   |
| `tests/fixtures/poc/src/members.ts`        | Modified — add DI boundary fixtures (extend 0030 fixture)          |
| `tests/conditions/class-params.test.ts`    | **New** — unit tests for class parameter conditions                |
| `tests/conditions/function-params.test.ts` | **New** — unit tests for function parameter conditions             |
| `tests/integration/class-rules.test.ts`    | Modified — add integration tests                                   |
| `tests/integration/function-rules.test.ts` | Modified — add integration tests                                   |

## Test Inventory

### `tests/conditions/class-params.test.ts`

**acceptParameterOfType:**

1. **passes when constructor has matching param** — `ServiceAcceptingDb` has `DatabaseClient`
2. **passes when method has matching param** — `ServiceWithDbMethod.connect` has `DatabaseClient`
3. **fails when no param matches** — `CleanService` has only `Logger`
4. **scans constructor AND methods** — class with matching param only in a method still passes

**notAcceptParameterOfType:** 5. **passes when no param matches** — `CleanService` has only `Logger` 6. **reports violation per matching param** — `RepoAcceptingDb` constructor has `DatabaseClient` → 1 violation 7. **reports violations across members** — class with `DatabaseClient` in both constructor and method → 2 violations 8. **violation message includes member name and param name** — verify format 9. **violation message includes type text** — verify type is shown

### `tests/conditions/function-params.test.ts`

**acceptParameterOfType:** 10. **passes when function has matching param** — `createServiceWithDb` has `DatabaseClient` 11. **fails when no param matches** — `createCleanService` has only `Logger`

**notAcceptParameterOfType:** 12. **passes when no param matches** — `createCleanService` 13. **reports violation for matching param** — `createServiceWithDb` has `DatabaseClient`

### Integration tests

14. **classes(p).that().haveNameEndingWith('Service').should().notAcceptParameterOfType(matching(/DatabaseClient/)).check()** — the DI boundary rule
15. **classes(p).that().haveNameEndingWith('Repo').should().acceptParameterOfType(matching(/DatabaseClient/)).check()** — repos must accept DB
16. **functions(p).that().haveNameMatching(/create.\*Service/).should().notAcceptParameterOfType(matching(/DatabaseClient/)).check()** — factory function enforcement
17. **Compose with TypeMatcher: `exactly()`, `matching()`, `isString()`** — verify all matchers work

## Out of Scope

- **`acceptParameterNamed` / `notAcceptParameterNamed`** — Parameter names are internal implementation details. Less useful as architectural constraints than types. Defer unless demand appears.
- **Method visibility filtering** — Bug 0004 mentions checking only public methods. Currently this plan scans all members regardless of visibility. Plan 0032 adds `arePublic()` / `arePrivate()` predicates on `FunctionRuleBuilder` — together with this plan, that fully resolves 0004.
- **Getter parameter checking** — Getters have no parameters. Not applicable.
- **Generic type parameter conditions** — `haveTypeParameter('T')`. Niche. Defer.
- **Cross-element parameter consistency** — "predicate and condition must have same parameter types." Complex. Defer.
