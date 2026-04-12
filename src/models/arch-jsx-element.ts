import {
  type JsxElement,
  type JsxSelfClosingElement,
  type JsxAttribute,
  type SourceFile,
  type JsxAttributeLike,
  Node,
} from 'ts-morph'

/**
 * Standard HTML tag names per the WHATWG HTML Living Standard.
 * Use with `areHtmlElements(...STANDARD_HTML_TAGS)`
 * for unambiguous "all standard HTML elements" matching (excludes custom
 * elements like `<my-widget>`).
 */
export const STANDARD_HTML_TAGS: readonly string[] = [
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'menu',
  'meta',
  'meter',
  'nav',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'script',
  'search',
  'section',
  'select',
  'slot',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
] as const

/**
 * Unified representation of a JSX element in the project.
 *
 * Wraps both JsxElement (has children) and JsxSelfClosingElement (no children)
 * with a uniform interface for predicate/condition evaluation.
 *
 * Satisfies Named (getName) and Located (getSourceFile) interfaces from
 * identity predicates.
 */
export interface ArchJsxElement {
  /** Tag name: 'div', 'Button', 'Icons.Check', etc. */
  getName(): string

  /** Source file containing this element. */
  getSourceFile(): SourceFile

  /**
   * Whether this is an HTML intrinsic element (lowercase first char, no dot).
   * Dot-notation tags (e.g. `motion.div`) are always classified as components.
   */
  isHtmlElement(): boolean

  /**
   * Whether this is a component element (uppercase first char or dot-notation).
   */
  isComponent(): boolean

  /**
   * Get attribute value by name. Returns undefined if absent or valueless.
   * For valueless attributes (`<input disabled />`), returns undefined —
   * use `hasAttribute('disabled')` for presence checks.
   * For expression attributes (`onClick={() => {}}`), returns the raw
   * initializer text including braces (e.g. `{() => {}}`).
   *
   * Only checks named JsxAttribute nodes — spread attributes are not inspected.
   */
  getAttribute(name: string): string | undefined

  /**
   * Check whether a named attribute exists (including valueless like `disabled`).
   * Spread attributes (`{...props}`) are not inspected.
   */
  hasAttribute(name: string): boolean

  /**
   * Get all named attribute names. Spread attributes are excluded.
   */
  getAttributeNames(): string[]

  /** Whether this element has children (JsxElement vs JsxSelfClosingElement). */
  hasChildren(): boolean

  /** Underlying ts-morph node. */
  getNode(): JsxElement | JsxSelfClosingElement

  /** Start line number in the source file. */
  getStartLineNumber(): number
}

/**
 * Classify a tag name as HTML intrinsic or component.
 * - Dot-notation (contains '.') → always component
 * - Lowercase first char → HTML intrinsic
 * - Uppercase first char → component
 */
function isHtmlTag(tagName: string): boolean {
  if (tagName.includes('.')) return false
  const firstChar = tagName[0]
  return firstChar !== undefined && firstChar === firstChar.toLowerCase()
}

/**
 * Type predicate for filtering JsxAttribute from JsxAttributeLike.
 * Narrows the type so downstream code doesn't need redundant checks.
 */
function isNamedAttribute(a: JsxAttributeLike): a is JsxAttribute {
  return Node.isJsxAttribute(a)
}

/**
 * Shared attribute accessors for both JsxElement and JsxSelfClosingElement.
 * Extracts attribute-access logic into a single place to avoid duplication.
 */
function buildAttributeAccessors(getAttrs: () => JsxAttributeLike[]) {
  function namedAttrs(): JsxAttribute[] {
    return getAttrs().filter(isNamedAttribute)
  }

  return {
    getAttribute(name: string): string | undefined {
      const attr = namedAttrs().find((a) => a.getNameNode().getText() === name)
      if (!attr) return undefined
      const init = attr.getInitializer()
      if (!init) return undefined // valueless attribute
      if (Node.isStringLiteral(init)) return init.getLiteralValue()
      return init.getText()
    },
    hasAttribute(name: string): boolean {
      return namedAttrs().some((a) => a.getNameNode().getText() === name)
    },
    getAttributeNames(): string[] {
      return namedAttrs().map((a) => a.getNameNode().getText())
    },
  }
}

/**
 * Create an ArchJsxElement from a JsxElement (has opening + closing tags).
 */
export function fromJsxElement(el: JsxElement): ArchJsxElement {
  const opening = el.getOpeningElement()
  const tagName = opening.getTagNameNode().getText()
  const htmlTag = isHtmlTag(tagName)
  const attrs = buildAttributeAccessors(() => opening.getAttributes())

  return {
    getName: () => tagName,
    getSourceFile: () => el.getSourceFile(),
    isHtmlElement: () => htmlTag,
    isComponent: () => !htmlTag,
    ...attrs,
    hasChildren: () => true,
    getNode: () => el,
    getStartLineNumber: () => el.getStartLineNumber(),
  }
}

/**
 * Create an ArchJsxElement from a JsxSelfClosingElement (no children).
 */
export function fromJsxSelfClosingElement(el: JsxSelfClosingElement): ArchJsxElement {
  const tagName = el.getTagNameNode().getText()
  const htmlTag = isHtmlTag(tagName)
  const attrs = buildAttributeAccessors(() => el.getAttributes())

  return {
    getName: () => tagName,
    getSourceFile: () => el.getSourceFile(),
    isHtmlElement: () => htmlTag,
    isComponent: () => !htmlTag,
    ...attrs,
    hasChildren: () => false,
    getNode: () => el,
    getStartLineNumber: () => el.getStartLineNumber(),
  }
}

/**
 * Scan a source file for all JSX elements.
 *
 * Short-circuits on non-.tsx/.jsx files. Uses single-pass traversal.
 * Collects both JsxElement (has children) and JsxSelfClosingElement (no children).
 * JsxFragment nodes are intentionally excluded — they have no tag name or attributes.
 * Nested JSX elements ARE collected (consistent with collectCalls).
 */
export function collectJsxElements(sourceFile: SourceFile): ArchJsxElement[] {
  const filePath = sourceFile.getFilePath()
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) return []

  const elements: ArchJsxElement[] = []
  sourceFile.forEachDescendant((node) => {
    if (Node.isJsxElement(node)) {
      elements.push(fromJsxElement(node))
    } else if (Node.isJsxSelfClosingElement(node)) {
      elements.push(fromJsxSelfClosingElement(node))
    }
  })
  return elements
}
