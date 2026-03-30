import type { ClassDeclaration, ParameterDeclaration } from 'ts-morph'
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
/**
 * Scan parameters of class members (constructors, methods, set accessors) for
 * types matching the given matcher. Returns a violation for each matching parameter.
 */
function scanParametersForType(
  cls: ClassDeclaration,
  typeMatcher: TypeMatcher,
  context: ConditionContext,
): ArchViolation[] {
  const violations: ArchViolation[] = []
  const className = getElementName(cls)

  const members: Array<{ memberName: string; params: ParameterDeclaration[] }> = [
    ...cls.getConstructors().map((c) => ({ memberName: 'constructor', params: c.getParameters() })),
    ...cls.getMethods().map((m) => ({ memberName: m.getName(), params: m.getParameters() })),
    ...cls.getSetAccessors().map((s) => ({ memberName: s.getName(), params: s.getParameters() })),
  ]

  for (const { memberName, params } of members) {
    for (const param of params) {
      if (typeMatcher(param.getType())) {
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

  return violations
}

export function notAcceptParameterOfType(matcher: TypeMatcher): Condition<ClassDeclaration> {
  return {
    description: 'not accept parameter of matching type',
    evaluate(elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const cls of elements) {
        violations.push(...scanParametersForType(cls, matcher, context))
      }
      return violations
    },
  }
}
