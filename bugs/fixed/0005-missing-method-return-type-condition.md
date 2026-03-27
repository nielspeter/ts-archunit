# Feature Request: Check method return types by name pattern

**Type:** Feature request
**Date:** 2026-03-27
**Related:** BUG-0002 (property names), BUG-0004 (parameter names)

## Problem

Checking that methods matching a naming pattern return a specific type requires ~30 lines of custom `defineCondition` per check. Three near-identical conditions exist in cmless for list/create/delete method conventions.

From cmless (`packages/sdk/tests/unit/architecture/sdk-patterns.test.ts`):

```typescript
// 30 lines of boilerplate — repeated 3x for list/create/delete
const listMethodsReturnCollection = defineCondition(
  'list methods return Collection<T>',
  (elements: any[], context: ConditionContext): ArchViolation[] => {
    const violations: ArchViolation[] = []
    for (const cls of elements) {
      for (const method of cls.getMethods?.() ?? []) {
        const name = String(method.getName?.() ?? '')
        if (!/^(get|list)\w+s$/.test(name)) continue
        if (method.getScope?.() === 'private') continue
        const returnType = String(method.getReturnType?.().getText?.() ?? '')
        if (!returnType.includes('Collection')) {
          violations.push(createViolation(method, `...`, context))
        }
      }
    }
    return violations
  },
)
```

## Proposed API

```typescript
// List methods must return Collection<T>
classes(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .haveMethodsMatching(/^(get|list)\w+s$/)
  .withReturnTypeContaining('Collection')
  .check()

// Create methods must not return void
classes(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .haveMethodsMatching(/^create\w+/)
  .withReturnTypeNotContaining('void')
  .check()

// Delete methods must return void
classes(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .haveMethodsMatching(/^delete\w+/)
  .withReturnTypeContaining('void')
  .check()
```

## Use case

Enforcing SDK/API conventions where method naming implies a contract on the return type. Common in wrapper libraries, service layers, and repository patterns.

## Resolution

**Status:** Fixed
**Fixed by:** Plan 0033 (Return Type Condition)
**Condition added:** `haveReturnTypeMatching(matcher)` on FunctionRuleBuilder

The original 30-line `defineCondition` repeated 3x becomes:

```typescript
functions(p)
  .that()
  .haveNameMatching(/^list/)
  .should()
  .haveReturnTypeMatching(matching(/Collection/))
  .check()
```
