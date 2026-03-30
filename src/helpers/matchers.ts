import { Node, SyntaxKind, type CommentRange } from 'ts-morph'

/**
 * A matcher that tests whether a ts-morph AST node matches a specific pattern.
 *
 * Matchers are created by helper functions (call, access, newExpr, expression)
 * and consumed by body analysis conditions (contain, notContain, useInsteadOf).
 */
export interface ExpressionMatcher {
  /** Human-readable description for violation messages */
  readonly description: string

  /**
   * The SyntaxKind(s) this matcher targets.
   * Used to narrow the AST traversal — only nodes of these kinds are tested.
   * If undefined, all descendant nodes are tested (used by expression()).
   */
  readonly syntaxKinds?: SyntaxKind[]

  /**
   * Test whether a single AST node matches this pattern.
   *
   * Precondition: the node's kind is one of `syntaxKinds` (if specified).
   * The condition layer enforces this — matchers can assume the kind is correct.
   */
  matches(node: Node): boolean
}

/**
 * Normalize expression text for matching.
 * Replaces optional chaining `?.` with `.` so users don't need to
 * account for both forms.
 *
 * PoC finding: `this?.normalizeCount` getText() includes the `?`.
 */
function normalizeText(text: string): string {
  return text.replace(/\?\./g, '.')
}

/**
 * Match a CallExpression by function/method name.
 *
 * Matches against `CallExpression.getExpression().getText()` after
 * normalizing optional chaining.
 *
 * @param nameOrRegex - Exact name (e.g. 'parseInt', 'this.normalizeCount')
 *                      or regex for flexible matching.
 *
 * @example
 * call('parseInt')                    // matches parseInt(x)
 * call('this.normalizeCount')         // matches this.normalizeCount(x) AND this?.normalizeCount(x)
 * call(/^console\./)                  // matches console.log, console.warn, etc.
 */
export function call(nameOrRegex: string | RegExp): ExpressionMatcher {
  if (typeof nameOrRegex === 'string') {
    return {
      description: `call to '${nameOrRegex}'`,
      syntaxKinds: [SyntaxKind.CallExpression],
      matches(node: Node): boolean {
        if (!Node.isCallExpression(node)) return false
        const text = normalizeText(node.getExpression().getText())
        return text === nameOrRegex
      },
    }
  }
  return {
    description: `call matching ${String(nameOrRegex)}`,
    syntaxKinds: [SyntaxKind.CallExpression],
    matches(node: Node): boolean {
      if (!Node.isCallExpression(node)) return false
      const text = normalizeText(node.getExpression().getText())
      return nameOrRegex.test(text)
    },
  }
}

/**
 * Match a PropertyAccessExpression by the dotted chain.
 *
 * Matches against `PropertyAccessExpression.getText()` after normalizing
 * optional chaining. Useful for detecting direct property access patterns
 * like `process.env`, `this.db`, `window.location`.
 *
 * @param chain - Exact dotted chain (e.g. 'process.env') or regex.
 *
 * @example
 * access('process.env')               // matches process.env.FOO (the inner access)
 * access(/^this\.db/)                 // matches this.db, this.db.query, etc.
 */
export function access(chain: string | RegExp): ExpressionMatcher {
  if (typeof chain === 'string') {
    return {
      description: `access to '${chain}'`,
      syntaxKinds: [SyntaxKind.PropertyAccessExpression],
      matches(node: Node): boolean {
        if (!Node.isPropertyAccessExpression(node)) return false
        const text = normalizeText(node.getText())
        return text === chain
      },
    }
  }
  return {
    description: `access matching ${String(chain)}`,
    syntaxKinds: [SyntaxKind.PropertyAccessExpression],
    matches(node: Node): boolean {
      if (!Node.isPropertyAccessExpression(node)) return false
      const text = normalizeText(node.getText())
      return chain.test(text)
    },
  }
}

/**
 * Match a NewExpression by constructor name.
 *
 * Matches against `NewExpression.getExpression().getText()`.
 * The PoC confirmed this correctly distinguishes 'Error' from 'DomainError'.
 *
 * @param nameOrRegex - Exact constructor name or regex.
 *
 * @example
 * newExpr('Error')                    // matches new Error(...) but NOT new DomainError(...)
 * newExpr('DomainError')              // matches new DomainError(...)
 * newExpr(/Error$/)                   // matches new Error, new DomainError, new TypeError, etc.
 */
export function newExpr(nameOrRegex: string | RegExp): ExpressionMatcher {
  if (typeof nameOrRegex === 'string') {
    return {
      description: `new '${nameOrRegex}'`,
      syntaxKinds: [SyntaxKind.NewExpression],
      matches(node: Node): boolean {
        if (!Node.isNewExpression(node)) return false
        const text = node.getExpression().getText()
        return text === nameOrRegex
      },
    }
  }
  return {
    description: `new matching ${String(nameOrRegex)}`,
    syntaxKinds: [SyntaxKind.NewExpression],
    matches(node: Node): boolean {
      if (!Node.isNewExpression(node)) return false
      const text = node.getExpression().getText()
      return nameOrRegex.test(text)
    },
  }
}

/**
 * Escape hatch: match any node whose getText() contains or matches the given pattern.
 *
 * This is intentionally broad and should be used sparingly. It walks ALL
 * descendant nodes and checks getText() against the pattern. A runtime
 * console.warn is emitted the first time expression() is used, encouraging
 * users to prefer call/access/newExpr where possible.
 *
 * @param textOrRegex - Substring to search for (string) or regex pattern.
 *
 * @example
 * expression('eval')                  // matches any node containing 'eval'
 * expression(/document\.write/)       // matches document.write calls
 */
export function expression(textOrRegex: string | RegExp): ExpressionMatcher {
  let warned = false
  if (typeof textOrRegex === 'string') {
    return {
      description: `expression containing '${textOrRegex}'`,
      // No syntaxKinds — walks all descendants
      matches(node: Node): boolean {
        if (!warned) {
          console.warn(
            `[ts-archunit] expression('${textOrRegex}') is a broad matcher. ` +
              `Prefer call(), access(), or newExpr() for precise matching.`,
          )
          warned = true
        }
        return node.getText().includes(textOrRegex)
      },
    }
  }
  return {
    description: `expression matching ${String(textOrRegex)}`,
    // No syntaxKinds — walks all descendants
    matches(node: Node): boolean {
      if (!warned) {
        console.warn(
          `[ts-archunit] expression(${String(textOrRegex)}) is a broad matcher. ` +
            `Prefer call(), access(), or newExpr() for precise matching.`,
        )
        warned = true
      }
      return textOrRegex.test(node.getText())
    },
  }
}

/**
 * Match a PropertyAssignment by name and optional value.
 *
 * Targets `SyntaxKind.PropertyAssignment` for efficient traversal via
 * `getDescendantsOfKind`. Does NOT match ShorthandPropertyAssignment
 * (`{ schema }`) — those have no initializer.
 *
 * Value matching uses semantic comparison for primitives:
 * - `boolean` — matches TrueKeyword / FalseKeyword
 * - `number` — matches NumericLiteral via getLiteralValue()
 * - `string` — matches StringLiteral via getLiteralValue() (no quotes needed)
 * - `RegExp` — matches initializer getText() (raw text including quotes)
 *
 * @param name - Exact property name or regex for flexible matching.
 * @param value - Optional value constraint. Omit for name-only matching.
 *
 * @example
 * property('additionalProperties', true)   // matches additionalProperties: true
 * property('type', 'object')               // matches type: 'object'
 * property('maximum', 100)                 // matches maximum: 100
 * property(/^additional/)                  // matches any property starting with 'additional'
 * property('mode', /^'(strict|loose)'$/)   // matches mode: 'strict' or 'loose' (getText() includes quotes)
 */
/**
 * Test whether an initializer matches the expected value.
 */
function matchPropertyValue(initializer: Node, value: boolean | number | string | RegExp): boolean {
  if (typeof value === 'boolean') {
    const kind = initializer.getKind()
    return value ? kind === SyntaxKind.TrueKeyword : kind === SyntaxKind.FalseKeyword
  }
  if (typeof value === 'number') {
    return Node.isNumericLiteral(initializer) && initializer.getLiteralValue() === value
  }
  if (typeof value === 'string') {
    return Node.isStringLiteral(initializer) && initializer.getLiteralValue() === value
  }
  return value.test(initializer.getText())
}

/**
 * Test whether a property assignment's name matches the expected pattern.
 */
function matchPropertyName(node: Node, name: string | RegExp): boolean {
  if (!Node.isPropertyAssignment(node)) return false
  if (node.getNameNode().getKind() === SyntaxKind.ComputedPropertyName) return false
  const nameNode = node.getNameNode()
  const propName = Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : node.getName()
  if (typeof name === 'string') return propName === name
  return name.test(propName)
}

export function property(
  name: string | RegExp,
  value?: boolean | number | string | RegExp,
): ExpressionMatcher {
  const nameDesc = typeof name === 'string' ? `'${name}'` : String(name)
  const valueDesc = value === undefined ? '' : ` = ${String(value)}`
  const description = `property ${nameDesc}${valueDesc}`

  return {
    description,
    syntaxKinds: [SyntaxKind.PropertyAssignment],
    matches(node: Node): boolean {
      if (!matchPropertyName(node, name)) return false
      if (value === undefined) return true
      const initializer = Node.isPropertyAssignment(node) ? node.getInitializer() : undefined
      if (!initializer) return false
      return matchPropertyValue(initializer, value)
    },
  }
}

/**
 * Default stub/deferred-work patterns found in comments.
 * Matches common markers (see regex) and phrases like
 * "not implemented" or "coming soon".
 *
 * Exported as a constant for use with `comment()`. Users can pass
 * their own RegExp to `comment()` for narrower matching.
 */
export const STUB_PATTERNS =
  /\b(TODO|FIXME|HACK|XXX|STUB|DEFERRED|PLACEHOLDER)\b|\bnot\s+implemented\b|\bcoming\s+soon\b/i

/**
 * Match comments attached to AST nodes.
 *
 * Unlike other matchers that test AST nodes, this matcher tests the
 * leading and trailing comment ranges of each node. It uses
 * `syntaxKinds: undefined` so the broad traversal path visits every node,
 * and `matches(node)` checks that node's comment ranges.
 *
 * A Set tracks matched comment positions to avoid duplicates (the same
 * comment may be visited as leading trivia of multiple nested nodes).
 *
 * @param pattern - String substring or RegExp to test against comment text.
 *
 * @example
 * comment(/HACK/)                     // matches hack marker comments
 * comment(STUB_PATTERNS)              // matches all common stub markers
 * comment('HACK')                     // matches hack comments
 */
export function comment(pattern: string | RegExp): ExpressionMatcher {
  // Dedup by (filePath, pos) — prevents the same comment from matching
  // multiple times when visited as leading trivia of nested nodes.
  // Using a composite string key avoids cross-file collisions.
  const matchedComments = new Set<string>()

  function testComment(range: CommentRange): boolean {
    const text = range.getText()
    if (typeof pattern === 'string') {
      return text.includes(pattern)
    }
    // Reset lastIndex for stateful (g-flag) regexes
    pattern.lastIndex = 0
    return pattern.test(text)
  }

  return {
    description:
      typeof pattern === 'string'
        ? `comment containing '${pattern}'`
        : `comment matching ${String(pattern)}`,
    // No syntaxKinds — broad traversal to visit all nodes and their comments
    matches(node: Node): boolean {
      const filePath = node.getSourceFile().getFilePath()
      const ranges = [...node.getLeadingCommentRanges(), ...node.getTrailingCommentRanges()]
      for (const range of ranges) {
        const key = `${filePath}:${String(range.getPos())}`
        if (matchedComments.has(key)) continue
        if (testComment(range)) {
          matchedComments.add(key)
          return true
        }
      }
      return false
    },
  }
}
