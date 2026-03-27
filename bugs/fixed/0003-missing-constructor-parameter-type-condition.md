# Feature Request: Check parameter types on classes and functions

**Type:** Feature request
**Date:** 2026-03-27

## Problem

Enforcing "services must not access the database directly" currently requires fragile string matching on method bodies (`notContain(call(/^this\.db[.(]/))`). This is brittle — it matches helper method names like `this.dbToApiTeam`, misses other database access patterns, and ties the rule to a specific naming convention.

The real architectural constraint is: **a service should not receive a database instance (`Knex`) as a parameter** — whether through a constructor, method, or function call. If it never receives one, it can't access the database directly.

## Proposed API

```typescript
// Classes: services must not accept Knex anywhere (constructor, methods, setters)
classes(p).that().haveNameEndingWith('Service').should().notAcceptParameterOfType('Knex').check()

// Functions: factory functions must not accept Knex
functions(p)
  .that()
  .haveNameMatching(/create.*Service/)
  .should()
  .notAcceptParameterOfType('Knex')
  .check()

// Positive: repositories MUST accept Knex
classes(p).that().haveNameEndingWith('Repository').should().acceptParameterOfType('Knex').check()
```

## Current workaround

```typescript
// From cmless: apps/identity-gateway/tests/unit/architecture/db-patterns.test.ts
// Fragile — matches this.dbToApiTeam as a false positive
classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .notContain(call(/^this\.db[.(]/))
  .check()
```

## Use case

Enforcing layered architecture where only repositories have database access. This is a common pattern in DDD/clean architecture codebases. The check should work on any parameter — constructor, method, setter, or standalone function — since DI can happen through any of these.

## Resolution

**Status:** Fixed
**Fixed by:** Plan 0031 (Parameter Type Conditions)
**Conditions added:** `acceptParameterOfType(matcher)`, `notAcceptParameterOfType(matcher)` on both ClassRuleBuilder and FunctionRuleBuilder

The original request for `notAcceptParameterOfType('Knex')` is now `notAcceptParameterOfType(matching(/Knex/))` — composable with the full TypeMatcher system.
