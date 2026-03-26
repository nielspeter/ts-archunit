/**
 * Example: Custom rules for team-specific conventions
 *
 * Shows how to use definePredicate() and defineCondition()
 * to encode conventions that aren't covered by built-in rules.
 */
import { describe, it } from 'vitest'
import {
  project,
  classes,
  functions,
  definePredicate,
  defineCondition,
  createViolation,
} from 'ts-archunit'
import type { ClassDeclaration } from 'ts-morph'
import { SyntaxKind } from 'ts-morph'
import type { ArchViolation, ConditionContext } from 'ts-archunit'
import type { ArchFunction } from 'ts-archunit'

const p = project('tsconfig.json')

// ─── Custom Predicates ───────────────────────────────────────────────

// Predicate: classes with more than N methods (god class smell)
const hasManyMethods = (max: number) =>
  definePredicate<ClassDeclaration>(
    `has more than ${String(max)} methods`,
    (cls) => cls.getMethods().length > max,
  )

// Predicate: async functions (works on ArchFunction wrapper)
const isToplevelExport = definePredicate<ArchFunction>('is a top-level export', (fn) =>
  fn.isExported(),
)

describe('Custom Predicates', () => {
  it('no god classes (>15 methods)', () => {
    classes(p)
      .that()
      .satisfy(hasManyMethods(15))
      .should()
      .notExist()
      .because('split large classes into focused services')
      .check()
  })

  it('all top-level exports must be async', () => {
    functions(p)
      .that()
      .satisfy(isToplevelExport)
      .and()
      .resideInFolder('**/handlers/**')
      .should()
      .beAsync()
      .because('route handlers must be async')
      .check()
  })
})

// ─── Custom Conditions ───────────────────────────────────────────────

// Condition: every public method must have JSDoc
const haveJsDocOnPublicMethods = defineCondition<ClassDeclaration>(
  'have JSDoc on all public methods',
  (elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] => {
    const violations: ArchViolation[] = []
    for (const cls of elements) {
      for (const method of cls.getMethods()) {
        const isPublic = method.getScope() === undefined || method.getScope() === 'public'
        if (isPublic && method.getJsDocs().length === 0) {
          violations.push(
            createViolation(
              method,
              `${cls.getName() ?? 'anonymous'}.${method.getName()} is public but has no JSDoc`,
              context,
            ),
          )
        }
      }
    }
    return violations
  },
)

// Condition: classes must not have public fields (use getters/setters)
const noPublicFields = defineCondition<ClassDeclaration>(
  'have no public fields',
  (elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] => {
    const violations: ArchViolation[] = []
    for (const cls of elements) {
      for (const prop of cls.getProperties()) {
        const scope = prop.getScope()
        if (scope === undefined || scope === 'public') {
          // Allow static readonly (constants)
          if (prop.isStatic() && prop.isReadonly()) continue

          violations.push(
            createViolation(
              prop,
              `${cls.getName() ?? 'anonymous'}.${prop.getName()} is a public field — use private + getter/setter`,
              context,
            ),
          )
        }
      }
    }
    return violations
  },
)

// Condition: no magic numbers in method bodies
const noMagicNumbers = defineCondition<ClassDeclaration>(
  'have no magic numbers in method bodies',
  (elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] => {
    const violations: ArchViolation[] = []
    const allowedNumbers = new Set([0, 1, -1, 2, 10, 100])

    for (const cls of elements) {
      for (const method of cls.getMethods()) {
        const body = method.getBody()
        if (!body) continue

        const literals = body.getDescendantsOfKind(SyntaxKind.NumericLiteral)
        for (const lit of literals) {
          const value = Number(lit.getText())
          if (!allowedNumbers.has(value)) {
            violations.push(
              createViolation(
                lit,
                `${cls.getName() ?? 'anonymous'}.${method.getName()} contains magic number ${String(value)} — extract to a named constant`,
                context,
              ),
            )
          }
        }
      }
    }
    return violations
  },
)

describe('Custom Conditions', () => {
  it('exported classes must have JSDoc on public methods', () => {
    classes(p)
      .that()
      .areExported()
      .should()
      .satisfy(haveJsDocOnPublicMethods)
      .because('public API must be documented')
      .warn() // advisory, not blocking
  })

  it('domain entities must not have public fields', () => {
    classes(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .satisfy(noPublicFields)
      .because('encapsulate state behind methods')
      .check()
  })

  it('services should not use magic numbers', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Service')
      .should()
      .satisfy(noMagicNumbers)
      .because('extract constants for readability')
      .warn()
  })
})
