import { Node } from 'ts-morph'
import type { ClassDeclaration, SourceFile } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import type { ArchFunction } from '../models/arch-function.js'
import { newExpr } from '../helpers/matchers.js'
import { classNotContain } from '../conditions/body-analysis.js'
import { functionNotContain } from '../conditions/body-analysis-function.js'
import { findSilentCatches } from '../conditions/catch-analysis.js'

/**
 * No throwing generic Error — use typed domain errors instead.
 *
 * @example
 * classes(p).that().extend('BaseService')
 *   .should().satisfy(noGenericErrors())
 *   .because('use DomainError, NotFoundError, etc.')
 *   .check()
 */
export function noGenericErrors(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('Error'))
}

/**
 * No throwing TypeError — usually indicates a programming error, not a domain error.
 */
export function noTypeErrors(): Condition<ClassDeclaration> {
  return classNotContain(newExpr('TypeError'))
}

// ─── Function variants ────────────────────────────────────────────

export function functionNoGenericErrors(): Condition<ArchFunction> {
  return functionNotContain(newExpr('Error'))
}

export function functionNoTypeErrors(): Condition<ArchFunction> {
  return functionNotContain(newExpr('TypeError'))
}

// ─── Silent catch detection ──────────────────────────────────────

/**
 * Catch blocks in class methods, constructors, getters, and setters
 * must reference the caught error variable.
 *
 * Detects catch blocks that silently discard errors — no logging,
 * no rethrowing, no passing to another function. A common source of
 * hidden production bugs.
 */
export function noSilentCatch(): Condition<ClassDeclaration> {
  return {
    description: 'not have silent catch blocks (catch must reference the error)',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const members = [
          ...cls.getMethods(),
          ...cls.getConstructors(),
          ...cls.getGetAccessors(),
          ...cls.getSetAccessors(),
        ]
        for (const member of members) {
          const body = member.getBody()
          if (!body) continue
          for (const result of findSilentCatches(body)) {
            violations.push(createViolation(result.node, result.message, context))
          }
        }
      }
      return violations
    },
  }
}

export function functionNoSilentCatch(): Condition<ArchFunction> {
  return {
    description: 'not have silent catch blocks (catch must reference the error)',
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const body = fn.getBody()
        if (!body || !Node.isBlock(body)) continue
        for (const result of findSilentCatches(body)) {
          violations.push(createViolation(result.node, result.message, context))
        }
      }
      return violations
    },
  }
}

export function moduleNoSilentCatch(): Condition<SourceFile> {
  return {
    description: 'not have silent catch blocks (catch must reference the error)',
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        for (const result of findSilentCatches(sf)) {
          violations.push(createViolation(result.node, result.message, context))
        }
      }
      return violations
    },
  }
}
