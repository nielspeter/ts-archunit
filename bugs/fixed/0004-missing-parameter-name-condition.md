# Feature Request: Check method parameter names and types

**Type:** Feature request
**Date:** 2026-03-27
**Related:** BUG-0003 (constructor parameter type condition)

## Problem

Enforcing "repository methods must accept a tenancy parameter" currently requires ~70 lines of custom `defineCondition` code with manual AST traversal, exempt lists, delegation chain detection, and string matching on method bodies.

From cmless (`apps/identity-gateway/tests/unit/architecture/db-patterns.test.ts`):

```typescript
// 70 lines of fragile heuristics:
// - SPACE_ID_EXEMPT_REPOS manual exempt list (grows over time)
// - String matching on method bodies to detect DB access
// - String matching on parameter names (misses spaceUuid, organizationId, etc.)
// - String matching on delegation chains (incomplete)
const repositoryMethodsMustAcceptTenancy = defineCondition(
  'accept TenancyContext in query methods',
  (elements: any[], context: ConditionContext): ArchViolation[] => {
    // ... 70 lines of manual AST walking
  },
)
```

This pattern is common in multi-tenant systems but hard to express with current ts-archunit APIs.

## Proposed API

```typescript
// Repository public methods must have a parameter named spaceId or typed TenancyContext
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .should()
  .haveMethodsWithParameterNamed('spaceId')
  .check()

// Or by type
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .should()
  .haveMethodsWithParameterOfType('TenancyContext')
  .check()

// Combined: any public method that touches the DB must accept one of these
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .should()
  .publicMethodsSatisfy(
    (method) =>
      method.hasParameterNamed('spaceId', 'organizationId') ||
      method.hasParameterOfType('TenancyContext'),
  )
  .check()
```

## Scope

This is broader than BUG-0003 (which covers constructor/function parameters). This is about **method-level** parameter inspection:

- `haveMethodsWithParameterNamed(...names)` — at least one public method parameter matches
- `haveMethodsWithParameterOfType(...types)` — at least one parameter's type matches
- Optionally filter which methods are checked (e.g., only public, skip getters)

## Use case

Multi-tenant systems where every data-access method must accept a tenant identifier. Without this, projects write ~70 lines of brittle custom conditions that break on naming conventions, delegation patterns, and exempt lists.

## Resolution

**Status:** Fixed
**Fixed by:** Plan 0031 (Parameter Type Conditions) + Plan 0032 (Member Visibility Predicates)

The multi-tenant use case is now composable from two generic bricks:

```typescript
functions(p)
  .that()
  .resideInFolder('**/repositories/**')
  .and()
  .arePublic()
  .should()
  .acceptParameterOfType(matching(/TenancyContext/))
  .check()
```

`acceptParameterNamed` was deferred — types are stronger constraints than names for architectural rules.
