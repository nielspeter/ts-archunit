import type { Predicate } from '../core/predicate.js'
import type { ArchJsxElement } from '../models/arch-jsx-element.js'

/**
 * Matches HTML intrinsic elements with the given tag names.
 * At least one tag name is required — throws if called with zero tags.
 *
 * @example
 * areHtmlElements('button', 'input', 'select')
 * areHtmlElements(...STANDARD_HTML_TAGS)
 */
export function areHtmlElements(...tags: string[]): Predicate<ArchJsxElement> {
  if (tags.length === 0) {
    throw new Error(
      'areHtmlElements() requires at least one tag name. ' +
        'Use areHtmlElements(...STANDARD_HTML_TAGS) for all standard HTML elements.',
    )
  }
  const tagSet = new Set(tags)
  const desc =
    tags.length <= 5
      ? `are <${tags.join('>, <')}> elements`
      : `are <${tags.slice(0, 5).join('>, <')}> and ${String(tags.length - 5)} more HTML elements`
  return {
    description: desc,
    test: (element) => element.isHtmlElement() && tagSet.has(element.getName()),
  }
}

/**
 * Matches component elements (uppercase first char or dot-notation).
 * No args = all components. With args = only those component names.
 * Use full dotted names for namespaced components (e.g. 'Icons.Check').
 *
 * @example
 * areComponents()                     // all component elements
 * areComponents('Button', 'Input')    // only these components
 * areComponents('Icons.Check')        // dotted component name
 */
export function areComponents(...names: string[]): Predicate<ArchJsxElement> {
  if (names.length === 0) {
    return {
      description: 'are component elements',
      test: (element) => element.isComponent(),
    }
  }
  const nameSet = new Set(names)
  return {
    description:
      names.length === 1
        ? `are <${names[0]}> components`
        : `are <${names.join('>, <')}> components`,
    test: (element) => element.isComponent() && nameSet.has(element.getName()),
  }
}

/**
 * Filter to elements that have the named attribute (any value).
 * Predicate-only — use `haveAttribute` for the condition equivalent.
 *
 * @example
 * withAttribute('onClick')            // elements with onClick
 * withAttribute('data-testid')        // elements with data-testid
 */
export function withAttribute(name: string): Predicate<ArchJsxElement> {
  return {
    description: `have attribute "${name}"`,
    test: (element) => element.hasAttribute(name),
  }
}

/**
 * Filter to elements where the named attribute matches a string or regex.
 * Predicate-only — use `haveAttributeMatching` for the condition equivalent.
 *
 * @example
 * withAttributeMatching('type', 'submit')     // type="submit"
 * withAttributeMatching('className', /error/)  // className contains "error"
 */
export function withAttributeMatching(
  name: string,
  value: string | RegExp,
): Predicate<ArchJsxElement> {
  const valueDesc = typeof value === 'string' ? `"${value}"` : String(value)
  return {
    description: `have attribute "${name}" matching ${valueDesc}`,
    test(element) {
      const attrValue = element.getAttribute(name)
      if (attrValue === undefined) return false
      if (typeof value === 'string') return attrValue === value
      return value.test(attrValue)
    },
  }
}
