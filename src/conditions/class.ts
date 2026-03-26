import type { ClassDeclaration } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import { elementCondition } from './helpers.js'
import { getElementName } from '../core/violation.js'

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
