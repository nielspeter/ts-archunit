# Feature Request: Check call expression arguments for required properties

**Type:** Feature request
**Date:** 2026-03-27

## Problem

Checking that function call expressions include specific properties in their object literal arguments requires ~40 lines of custom AST traversal with `defineCondition`. This is used in cmless to enforce that Fastify route registrations include `schema` and `preHandler` properties.

From cmless (`apps/api/tests/unit/architecture/fastify-rules.test.ts`):

```typescript
// 40 lines of manual AST walking — walks descendants, finds CallExpressions,
// checks if expression matches app.get/post/etc, then inspects object literal args
function routeRegistrationMustHave(propertyName: string): ReturnType<typeof defineCondition> {
  return defineCondition(
    `route registrations include ${propertyName}`,
    (fns: any[], context: ConditionContext): ArchViolation[] => {
      const violations: ArchViolation[] = []
      for (const fn of fns) {
        const body = fn.getBody?.()
        if (!body) continue
        body.forEachDescendant((node) => {
          if (node.getKindName() !== 'CallExpression') return
          const exprText = node.getExpression().getText()
          if (!/^app\.(get|post|put|patch|delete|route)$/.test(exprText)) return
          const args = node.getArguments()
          const hasProp = args.some((arg) => {
            if (arg.getKindName() !== 'ObjectLiteralExpression') return false
            return arg.getProperties().some((prop) => prop.getName() === propertyName)
          })
          if (!hasProp) {
            violations.push(createViolation(node, `missing ${propertyName}`, context))
          }
        })
      }
      return violations
    },
  )
}
```

## Proposed API

```typescript
// Route registrations must include schema property
functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .containCallMatching(/^app\.(get|post|put|patch|delete)$/)
  .withArgumentProperty('schema')
  .check()

// Route registrations must include preHandler
functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .containCallMatching(/^app\.(get|post|put|patch|delete)$/)
  .withArgumentProperty('preHandler')
  .check()
```

## Alternative simpler API

If the chained builder is too complex, a standalone condition factory:

```typescript
import { callArgumentHasProperty } from '@nielspeter/ts-archunit/conditions'

functions(p)
  .that()
  .resideInFolder('**/routes/**')
  .should()
  .satisfy(callArgumentHasProperty(/^app\.(get|post)$/, 'schema'))
  .check()
```

## Use case

Framework convention enforcement — ensuring that framework API calls (Fastify routes, Express middleware, React hooks) include required configuration properties. The pattern is: find specific function calls within a scope, then verify their arguments contain required object properties.

## Resolution

**Status:** Fixed
**Fixed by:** Plan 0034 (Call Argument Property Condition)
**Conditions added:** `haveArgumentWithProperty(...names)`, `notHaveArgumentWithProperty(...names)` on CallRuleBuilder

The original 40-line custom condition becomes:

```typescript
calls(p)
  .that()
  .onObject('app')
  .and()
  .withMethod(/^(get|post|put|delete)$/)
  .should()
  .haveArgumentWithProperty('schema')
  .check()
```
