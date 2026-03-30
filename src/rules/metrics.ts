import type {
  ClassDeclaration,
  MethodDeclaration,
  ConstructorDeclaration,
  GetAccessorDeclaration,
  SetAccessorDeclaration,
} from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import { cyclomaticComplexity, linesOfCode } from '../helpers/complexity.js'

/** All callable members of a class: methods, constructors, getters, setters */
type ClassMember =
  | MethodDeclaration
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

function getClassMembers(cls: ClassDeclaration): ClassMember[] {
  return [
    ...cls.getMethods(),
    ...cls.getConstructors(),
    ...cls.getGetAccessors(),
    ...cls.getSetAccessors(),
  ]
}

function getMemberName(cls: ClassDeclaration, member: ClassMember): string {
  const clsName = cls.getName() ?? '<anonymous>'
  if ('getName' in member && typeof member.getName === 'function') {
    const memberName = String(member.getName())
    return `${clsName}.${memberName}`
  }
  return `${clsName}.constructor`
}

/**
 * No method/constructor/getter/setter in the class may exceed the given
 * cyclomatic complexity.
 *
 * @example
 * ```ts
 * import { maxCyclomaticComplexity } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()
 * ```
 */
export function maxCyclomaticComplexity(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no method with cyclomatic complexity > ${String(threshold)}`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const member of getClassMembers(cls)) {
          const cc = cyclomaticComplexity(member.getBody())
          if (cc > threshold) {
            violations.push(
              createViolation(
                member,
                `${getMemberName(cls, member)} has cyclomatic complexity ${String(cc)} (max: ${String(threshold)}) — split into smaller methods`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * No class may exceed the given number of lines (span lines).
 *
 * @example
 * ```ts
 * import { maxClassLines } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxClassLines(300)).warn()
 * ```
 */
export function maxClassLines(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no more than ${String(threshold)} lines`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const loc = linesOfCode(cls)
        if (loc > threshold) {
          violations.push(
            createViolation(
              cls,
              `${cls.getName() ?? '<anonymous>'} has ${String(loc)} lines (max: ${String(threshold)}) — consider splitting into focused classes`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}

/**
 * No method/constructor/getter/setter may exceed the given number of lines.
 *
 * @example
 * ```ts
 * import { maxMethodLines } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxMethodLines(50)).warn()
 * ```
 */
export function maxMethodLines(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no method longer than ${String(threshold)} lines`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const member of getClassMembers(cls)) {
          const loc = linesOfCode(member)
          if (loc > threshold) {
            violations.push(
              createViolation(
                member,
                `${getMemberName(cls, member)} has ${String(loc)} lines (max: ${String(threshold)})`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * No class may have more than the given number of methods.
 *
 * Counts methods only (not constructors/getters/setters).
 *
 * @example
 * ```ts
 * import { maxMethods } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxMethods(15)).warn()
 * ```
 */
export function maxMethods(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no more than ${String(threshold)} methods`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const count = cls.getMethods().length
        if (count > threshold) {
          violations.push(
            createViolation(
              cls,
              `${cls.getName() ?? '<anonymous>'} has ${String(count)} methods (max: ${String(threshold)}) — consider splitting into focused classes`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}

/**
 * No method/constructor may have more than the given number of parameters.
 *
 * @example
 * ```ts
 * import { maxParameters } from '@nielspeter/ts-archunit/rules/metrics'
 *
 * classes(p).should().satisfy(maxParameters(4))
 *   .because('use an options object for >4 parameters')
 *   .check()
 * ```
 */
export function maxParameters(threshold: number): Condition<ClassDeclaration> {
  return {
    description: `have no method with more than ${String(threshold)} parameters`,
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        for (const member of getClassMembers(cls)) {
          const params = member.getParameters().length
          if (params > threshold) {
            violations.push(
              createViolation(
                member,
                `${getMemberName(cls, member)} has ${String(params)} parameters (max: ${String(threshold)}) — use an options object`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

// Re-export function-level metric conditions from the same sub-path
export {
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from './metrics-function.js'
