# Feature Request: Built-in condition for forbidden/required property names on types

**Type:** Feature request
**Date:** 2026-03-27

## Problem

Checking that interface/type properties don't use certain names requires a custom `defineCondition` with manual AST traversal:

```typescript
// From cmless: apps/api/tests/unit/architecture/code-standards.test.ts
const noForbiddenPaginationParams = defineCondition(
  'no forbidden pagination param names',
  (elements: any[], context: ConditionContext): ArchViolation[] => {
    const forbidden = ['offset', 'pageSize', 'page', 'size']
    const violations: ArchViolation[] = []
    for (const iface of elements) {
      const props = iface.getProperties?.() ?? []
      for (const prop of props) {
        const propName = String(prop.getName?.() ?? '')
        if (forbidden.includes(propName)) {
          violations.push(createViolation(prop, `...`, context))
        }
      }
    }
    return violations
  },
)
```

This is a common pattern that should be a built-in condition.

## Proposed API

```typescript
// Forbid specific property names
types(p)
  .that()
  .resideInFolder('**/src/**')
  .should()
  .notHavePropertyNamed('offset', 'pageSize', 'page', 'size')
  .check()

// Require specific property names
types(p)
  .that()
  .haveNameMatching(/QueryOptions$/)
  .should()
  .havePropertyNamed('skip', 'limit')
  .check()
```

## Use case

Enforcing naming conventions across TypeScript interfaces — e.g., all pagination uses `skip`/`limit` (Contentful style), not `offset`/`page`/`pageSize`.

## Resolution

**Status:** Fixed
**Fixed by:** Plan 0030 (Member Property Conditions)
**Conditions added:** `havePropertyNamed(...names)`, `notHavePropertyNamed(...names)`, `havePropertyMatching(pattern)`, `notHavePropertyMatching(pattern)`, `haveOnlyReadonlyProperties()`, `maxProperties(n)`

The original request for `notHavePropertyNamed('offset', 'pageSize', 'page', 'size')` is now a one-liner on both `types()` and `classes()` builders.
