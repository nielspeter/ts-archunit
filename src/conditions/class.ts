import type { ClassDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { elementCondition } from './helpers.js'
import { createViolation, getElementName } from '../core/violation.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'

/**
 * Assert that classes extend the named base class.
 */
export function shouldExtend(className: string): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `extend "${className}"`,
    (cls) => cls.getExtends()?.getExpression().getText() === className,
    (cls) => `${getElementName(cls)} does not extend "${className}"`,
  )
}

/**
 * Assert that classes implement the named interface.
 */
export function shouldImplement(interfaceName: string): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `implement "${interfaceName}"`,
    (cls) => cls.getImplements().some((impl) => impl.getExpression().getText() === interfaceName),
    (cls) => `${getElementName(cls)} does not implement "${interfaceName}"`,
  )
}

/**
 * Assert that classes have a method with the given name.
 */
export function shouldHaveMethodNamed(name: string): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `have method named "${name}"`,
    (cls) => cls.getMethod(name) !== undefined,
    (cls) => `${getElementName(cls)} does not have method "${name}"`,
  )
}

/**
 * Assert that classes do NOT have any methods matching the regex.
 */
export function shouldNotHaveMethodMatching(regex: RegExp): Condition<ClassDeclaration> {
  return elementCondition<ClassDeclaration>(
    `not have methods matching ${String(regex)}`,
    (cls) => !cls.getMethods().some((m) => regex.test(m.getName())),
    (cls) => {
      const matching = cls
        .getMethods()
        .filter((m) => regex.test(m.getName()))
        .map((m) => m.getName())
      return `${getElementName(cls)} has methods matching ${String(regex)}: ${matching.join(', ')}`
    },
  )
}

/**
 * Assert that at least one parameter across the class's constructors,
 * methods, and set accessors has a type matching the given matcher.
 *
 * Passes when at least one parameter satisfies `matcher`.
 * Reports one violation per class that has no matching parameter.
 *
 * **Scope note:** This scans constructors, methods, AND set accessors.
 * The function-level counterpart (`functions(p).should().acceptParameterOfType(...)`)
 * does NOT scan set accessors because `collectFunctions()` excludes them.
 */
export function acceptParameterOfType(matcher: TypeMatcher): Condition<ClassDeclaration> {
  return {
    description: 'accept parameter of matching type',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const allParams = [
          ...cls.getConstructors().flatMap((c) => c.getParameters()),
          ...cls.getMethods().flatMap((m) => m.getParameters()),
          ...cls.getSetAccessors().flatMap((s) => s.getParameters()),
        ]
        const hasMatch = allParams.some((p) => matcher(p.getType()))
        if (!hasMatch) {
          violations.push(
            createViolation(
              cls,
              `${getElementName(cls)} has no parameter with matching type`,
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
 * Assert that NO parameter across the class's constructors, methods,
 * and set accessors has a type matching the given matcher.
 *
 * Reports one violation **per parameter** whose type satisfies `matcher`,
 * with actionable messages including the member name and parameter name.
 *
 * **Scope note:** This scans constructors, methods, AND set accessors.
 * The function-level counterpart (`functions(p).should().notAcceptParameterOfType(...)`)
 * does NOT scan set accessors because `collectFunctions()` excludes them.
 */
export function notAcceptParameterOfType(matcher: TypeMatcher): Condition<ClassDeclaration> {
  return {
    description: 'not accept parameter of matching type',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        const className = getElementName(cls)

        // Scan constructors — ConstructorDeclaration has no getName()
        for (const ctor of cls.getConstructors()) {
          for (const param of ctor.getParameters()) {
            if (matcher(param.getType())) {
              const paramName = param.getName()
              const typeText = param.getType().getText()
              violations.push(
                createViolation(
                  cls,
                  `${className}.constructor parameter "${paramName}" has type "${typeText}"`,
                  context,
                ),
              )
            }
          }
        }

        // Scan methods
        for (const method of cls.getMethods()) {
          for (const param of method.getParameters()) {
            if (matcher(param.getType())) {
              const memberName = method.getName()
              const paramName = param.getName()
              const typeText = param.getType().getText()
              violations.push(
                createViolation(
                  cls,
                  `${className}.${memberName} parameter "${paramName}" has type "${typeText}"`,
                  context,
                ),
              )
            }
          }
        }

        // Scan set accessors
        for (const setter of cls.getSetAccessors()) {
          for (const param of setter.getParameters()) {
            if (matcher(param.getType())) {
              const memberName = setter.getName()
              const paramName = param.getName()
              const typeText = param.getType().getText()
              violations.push(
                createViolation(
                  cls,
                  `${className}.${memberName} parameter "${paramName}" has type "${typeText}"`,
                  context,
                ),
              )
            }
          }
        }
      }
      return violations
    },
  }
}
