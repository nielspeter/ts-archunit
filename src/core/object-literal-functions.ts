/**
 * Object-literal function traversal. **In `core/` because it was the wrong way up.**
 *
 * It lived in `helpers/` and was imported by `models/arch-function.ts` — a
 * `models → helpers` edge, which is backwards: helpers may depend on models, not
 * the reverse. That edge sat harmlessly until
 * [plan 0082](../../plans/completed/0082-an-object-literal-callback-keeps-its-name.md)
 * added `helpers/callback-extractor.ts → models/arch-function.ts` as a **value**
 * import, closing a runtime cycle.
 *
 * Measured: at v0.45.6 no file in `helpers/` had a value import from `models/` —
 * only `import type`. So the cycle was one day old when
 * [plan 0084](../../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md)
 * found it, and the rule that exists to catch exactly this was pinned at `.warn()`
 * with a comment explaining why. A rule that cannot fail let a cycle in overnight.
 *
 * This module imports nothing but ts-morph, so `core/` costs it no dependency and
 * both `models → core` and `helpers → core` are permitted directions.
 */

import { Node } from 'ts-morph'
import type { PropertyAssignment, MethodDeclaration } from 'ts-morph'

/**
 * A function found as a value in an object literal, with the property-key path
 * that reached it.
 */
export interface ObjectLiteralFunction {
  /** The function node: `ArrowFunction | FunctionExpression | MethodDeclaration`. */
  readonly node: Node
  /** Property-key path from the root object literal, e.g. `['routes', '/x', 'GET']`. */
  readonly keyPath: readonly string[]
}

/** Default recursion depth into nested object literals (matches the callback path). */
export const MAX_OBJECT_LITERAL_DEPTH = 3

/**
 * Walk an object literal and collect every function-valued property — arrow,
 * function expression, or method shorthand — recursing into nested object
 * literals up to `maxDepth`. Call-agnostic (F3): the single traversal shared by
 * `functions()` object-literal collection (proposal 016) and the
 * callback-extractor (`within()` / call path), so the two cannot drift.
 *
 * Only descends into nested object-literal property values, never into function
 * bodies. Returns `[]` when `node` is not an object literal.
 */
export function collectObjectLiteralFunctions(
  node: Node,
  maxDepth: number = MAX_OBJECT_LITERAL_DEPTH,
): ObjectLiteralFunction[] {
  const out: ObjectLiteralFunction[] = []
  walk(node, [], 0, maxDepth, out)
  return out
}

function walk(
  node: Node,
  keyPath: readonly string[],
  depth: number,
  maxDepth: number,
  out: ObjectLiteralFunction[],
): void {
  if (!Node.isObjectLiteralExpression(node)) return
  if (depth >= maxDepth) return

  for (const prop of node.getProperties()) {
    // Method shorthand: { GET(req) { ... } }
    if (Node.isMethodDeclaration(prop)) {
      out.push({ node: prop, keyPath: [...keyPath, keyOf(prop)] })
      continue
    }
    if (!Node.isPropertyAssignment(prop)) continue
    const init = prop.getInitializer()
    if (!init) continue
    const key = keyOf(prop)
    // Arrow / function-expression property value.
    if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
      out.push({ node: init, keyPath: [...keyPath, key] })
      continue
    }
    // Nested object literal — recurse (depth-limited).
    if (Node.isObjectLiteralExpression(init)) {
      walk(init, [...keyPath, key], depth + 1, maxDepth, out)
    }
  }
}

/** Property key as a string; computed keys degrade to a defined `<computed>` sentinel. */
function keyOf(prop: PropertyAssignment | MethodDeclaration): string {
  const nameNode = prop.getNameNode()
  if (Node.isComputedPropertyName(nameNode)) return '<computed>'
  if (Node.isStringLiteral(nameNode)) return nameNode.getLiteralValue()
  return nameNode.getText()
}
