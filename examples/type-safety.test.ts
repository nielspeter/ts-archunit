/**
 * Example: Enforce strict type safety across a codebase
 *
 * Bans `any` types, type assertions (`as`), non-null assertions (`!`),
 * and other type safety violations. These rules complement TypeScript's
 * strict mode and ESLint's @typescript-eslint rules with architecture-level
 * enforcement.
 */
import { describe, it } from 'vitest'
import {
  project,
  classes,
  functions,
  types,
  call,
  access,
  expression,
  notType,
  isString,
  definePredicate,
  defineCondition,
  createViolation,
} from 'ts-archunit'
import type { ClassDeclaration } from 'ts-morph'
import { SyntaxKind, Node } from 'ts-morph'
import type { ArchViolation, ConditionContext, ArchFunction } from 'ts-archunit'

const p = project('tsconfig.json')

// ─── Ban `any` in Type Definitions ───────────────────────────────────

describe('No any Types', () => {
  // Custom condition: interfaces must not have properties typed as `any`
  const noAnyProperties = defineCondition<ClassDeclaration>(
    'have no properties typed as any',
    (elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] => {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const prop of cls.getProperties()) {
          const propType = prop.getType()
          // Check if the type is `any` — getText() returns 'any' for untyped or explicitly any
          if (propType.getText() === 'any') {
            violations.push(
              createViolation(
                prop,
                `${cls.getName() ?? 'anonymous'}.${prop.getName()} is typed as 'any' — use a specific type or 'unknown'`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  )

  it('classes must not have any-typed properties', () => {
    classes(p)
      .that().areExported()
      .should().satisfy(noAnyProperties)
      .because('any bypasses the type checker (ADR-005)')
      .check()
  })

  it('query options must use typed unions, not bare string', () => {
    types(p)
      .that().haveNameMatching(/Options$/)
      .and().haveProperty('orderBy')
      .should().havePropertyType('orderBy', notType(isString()))
      .because('bare string types defeat the purpose of TypeScript')
      .check()
  })
})

// ─── Ban Type Assertions in Method Bodies ────────────────────────────

describe('No Type Assertions', () => {
  // Custom condition: method bodies must not contain `as` type assertions
  const noTypeAssertions = defineCondition<ClassDeclaration>(
    'have no type assertions (as) in method bodies',
    (elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] => {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const body = method.getBody()
          if (!body) continue

          // AsExpression is the AST node for `expr as Type`
          const asExprs = body.getDescendantsOfKind(SyntaxKind.AsExpression)
          for (const asExpr of asExprs) {
            // Allow `as const` — it narrows types, not widens them
            const typeNode = asExpr.getTypeNode()
            if (typeNode && Node.isTypeReference(typeNode) && typeNode.getText() === 'const') {
              continue
            }

            violations.push(
              createViolation(
                asExpr,
                `${cls.getName() ?? 'anonymous'}.${method.getName()} uses type assertion '${asExpr.getText()}' — use type guards instead`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  )

  it('service classes must not use type assertions', () => {
    classes(p)
      .that().haveNameEndingWith('Service')
      .should().satisfy(noTypeAssertions)
      .because('use type guards or explicit type annotations instead of as casts (ADR-005)')
      .check()
  })
})

// ─── Ban Non-Null Assertions ─────────────────────────────────────────

describe('No Non-Null Assertions', () => {
  // Custom condition: method bodies must not contain `!` non-null assertions
  const noNonNullAssertions = defineCondition<ClassDeclaration>(
    'have no non-null assertions (!) in method bodies',
    (elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] => {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const method of cls.getMethods()) {
          const body = method.getBody()
          if (!body) continue

          const nonNullExprs = body.getDescendantsOfKind(SyntaxKind.NonNullExpression)
          for (const expr of nonNullExprs) {
            violations.push(
              createViolation(
                expr,
                `${cls.getName() ?? 'anonymous'}.${method.getName()} uses non-null assertion '${expr.getText()}' — handle the null case explicitly`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  )

  it('domain classes must not use non-null assertions', () => {
    classes(p)
      .that().resideInFolder('**/domain/**')
      .should().satisfy(noNonNullAssertions)
      .because('non-null assertions hide potential runtime errors')
      .check()
  })
})

// ─── Ban Unsafe Patterns ─────────────────────────────────────────────

describe('Unsafe Pattern Detection', () => {
  it('no eval() calls', () => {
    classes(p)
      .should().notContain(call('eval'))
      .because('eval is a security risk')
      .check()
  })

  it('no Function constructor', () => {
    classes(p)
      .should().notContain(call('Function'))
      .because('new Function() is equivalent to eval')
      .check()
  })

  it('no direct process.env access in domain layer', () => {
    functions(p)
      .that().resideInFolder('**/domain/**')
      .should().notContain(access('process.env'))
      .because('use dependency injection for configuration')
      .check()
  })
})
