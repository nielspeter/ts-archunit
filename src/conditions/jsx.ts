import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation } from '../core/violation.js'
import type { ArchJsxElement } from '../models/arch-jsx-element.js'

/**
 * Create a violation from an ArchJsxElement.
 *
 * Delegates to the core createViolation() to get code frames, suggestions,
 * and docs links. Overrides the element name with the JSX tag name.
 */
function createJsxViolation(
  element: ArchJsxElement,
  message: string,
  context: ConditionContext,
): ArchViolation {
  const violation = createViolation(element.getNode(), message, {
    rule: context.rule,
    because: context.because,
    suggestion: context.suggestion,
    ruleId: context.ruleId,
    docs: context.docs,
  })
  // Override element name with the JSX tag name (core helper walks ancestors
  // which produces meaningless output for JSX nodes inside components)
  return { ...violation, element: `<${element.getName()}>` }
}

/**
 * The filtered JSX element set must be empty — no elements should match the predicates.
 *
 * @example
 * jsxElements(p).that().areHtmlElements('button').should().notExist().check()
 */
export function notExist(): Condition<ArchJsxElement> {
  return {
    description: 'not exist',
    evaluate(elements: ArchJsxElement[], context: ConditionContext): ArchViolation[] {
      return elements.map((el) =>
        createJsxViolation(el, `<${el.getName()}> should not exist`, context),
      )
    },
  }
}

/**
 * Every matched element must have the named attribute.
 *
 * @example
 * jsxElements(p).that().areHtmlElements('img').should().haveAttribute('alt').check()
 */
export function haveAttribute(name: string): Condition<ArchJsxElement> {
  return {
    description: `have attribute "${name}"`,
    evaluate(elements: ArchJsxElement[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const el of elements) {
        if (!el.hasAttribute(name)) {
          violations.push(
            createJsxViolation(
              el,
              `<${el.getName()}> is missing required attribute "${name}"`,
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
 * No matched element may have the named attribute.
 *
 * @example
 * jsxElements(p).should().notHaveAttribute('style').check()
 */
export function notHaveAttribute(name: string): Condition<ArchJsxElement> {
  return {
    description: `not have attribute "${name}"`,
    evaluate(elements: ArchJsxElement[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const el of elements) {
        if (el.hasAttribute(name)) {
          violations.push(
            createJsxViolation(
              el,
              `<${el.getName()}> should not have attribute "${name}"`,
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
 * Every matched element must have the named attribute with a value matching
 * the given string or regex.
 *
 * @example
 * jsxElements(p).that().areHtmlElements('input').should().haveAttributeMatching('type', 'text').check()
 */
export function haveAttributeMatching(
  name: string,
  value: string | RegExp,
): Condition<ArchJsxElement> {
  const valueDesc = typeof value === 'string' ? `"${value}"` : String(value)
  return {
    description: `have attribute "${name}" matching ${valueDesc}`,
    evaluate(elements: ArchJsxElement[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const el of elements) {
        if (!el.hasAttribute(name)) {
          violations.push(
            createJsxViolation(el, `<${el.getName()}> is missing attribute "${name}"`, context),
          )
          continue
        }
        const attrValue = el.getAttribute(name)
        if (attrValue === undefined) {
          // Attribute is present but valueless (e.g. <input disabled />)
          violations.push(
            createJsxViolation(
              el,
              `<${el.getName()}> attribute "${name}" is valueless, expected a value matching ${valueDesc}`,
              context,
            ),
          )
          continue
        }
        const matches = typeof value === 'string' ? attrValue === value : value.test(attrValue)
        if (!matches) {
          violations.push(
            createJsxViolation(
              el,
              `<${el.getName()}> attribute "${name}" value "${attrValue}" does not match ${valueDesc}`,
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
 * No matched element may have the named attribute matching the given value.
 * Elements without the attribute pass.
 *
 * @example
 * jsxElements(p).should().notHaveAttributeMatching('className', /hidden/).check()
 */
export function notHaveAttributeMatching(
  name: string,
  value: string | RegExp,
): Condition<ArchJsxElement> {
  const valueDesc = typeof value === 'string' ? `"${value}"` : String(value)
  return {
    description: `not have attribute "${name}" matching ${valueDesc}`,
    evaluate(elements: ArchJsxElement[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const el of elements) {
        const attrValue = el.getAttribute(name)
        if (attrValue === undefined) continue // absent = pass
        const matches = typeof value === 'string' ? attrValue === value : value.test(attrValue)
        if (matches) {
          violations.push(
            createJsxViolation(
              el,
              `<${el.getName()}> should not have attribute "${name}" matching ${valueDesc}`,
              context,
            ),
          )
        }
      }
      return violations
    },
  }
}
