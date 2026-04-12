import { type CallExpression, type Node, Node as NodeUtils, SyntaxKind } from 'ts-morph'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Represents a callback function extracted from a call expression argument.
 * Wraps the arrow function or function expression as an ArchFunction.
 */
export interface ExtractedCallback {
  /** The ArchFunction wrapping the callback. */
  fn: ArchFunction
  /** The call expression this callback was extracted from. */
  callSite: CallExpression
  /** Argument index within the call expression (0-based). */
  argIndex: number
}

/**
 * Extract all inline function arguments from a call expression.
 *
 * Handles:
 * - Arrow functions: `app.get('/path', (req, res) => { ... })`
 * - Function expressions: `app.get('/path', function(req, res) { ... })`
 *
 * Does NOT resolve named references (e.g., `app.get('/path', myHandler)`).
 * Reference resolution requires type-checker lookups and is deferred.
 *
 * @returns Array of extracted callbacks with their source metadata
 */
export function extractCallbacks(callExpr: CallExpression): ExtractedCallback[] {
  const callbacks: ExtractedCallback[] = []
  const args = callExpr.getArguments()

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    const fn = extractInlineFunction(arg, callExpr, i)
    if (fn) {
      callbacks.push(fn)
    } else {
      // Search object literal arguments for function-valued properties
      callbacks.push(...extractFromObjectLiteral(arg, callExpr, i, 0))
    }
  }

  return callbacks
}

/**
 * Maximum depth to recurse into nested object literals.
 * Prevents extracting unintended callbacks from deep config/schema structures.
 */
const MAX_OBJECT_DEPTH = 3

/**
 * Recursively search an ObjectLiteralExpression for function-like property values.
 *
 * Handles:
 * - Arrow function properties: `{ handler: (req) => { ... } }`
 * - Function expression properties: `{ handler: function(req) { ... } }`
 * - Method shorthand: `{ handler(req) { ... } }`
 * - Nested object literals: `{ hooks: { onRequest: (req) => { ... } } }`
 *
 * Stops at MAX_OBJECT_DEPTH to avoid false positives from schema defaults.
 */
function extractFromObjectLiteral(
  arg: Node,
  callSite: CallExpression,
  argIndex: number,
  depth: number,
): ExtractedCallback[] {
  if (!NodeUtils.isObjectLiteralExpression(arg)) return []
  if (depth >= MAX_OBJECT_DEPTH) return []
  const results: ExtractedCallback[] = []
  for (const prop of arg.getProperties()) {
    // Method shorthand: { handler(req, res) { ... } }
    if (NodeUtils.isMethodDeclaration(prop)) {
      results.push({
        fn: fromMethodDeclaration(prop),
        callSite,
        argIndex,
      })
      continue
    }
    if (!NodeUtils.isPropertyAssignment(prop)) continue
    const init = prop.getInitializer()
    if (!init) continue
    // Direct function property
    const direct = extractInlineFunction(init, callSite, argIndex)
    if (direct) {
      results.push(direct)
      continue
    }
    // Recurse into nested object literals (depth-limited)
    results.push(...extractFromObjectLiteral(init, callSite, argIndex, depth + 1))
  }
  return results
}

/**
 * Try to extract an ArchFunction from a single argument node.
 */
function extractInlineFunction(
  arg: Node,
  callSite: CallExpression,
  argIndex: number,
): ExtractedCallback | null {
  // Arrow function: (req, res) => { ... }
  if (arg.getKind() === SyntaxKind.ArrowFunction) {
    return {
      fn: fromArrowExpression(arg),
      callSite,
      argIndex,
    }
  }

  // Function expression: function(req, res) { ... }
  if (arg.getKind() === SyntaxKind.FunctionExpression) {
    return {
      fn: fromFunctionExpression(arg),
      callSite,
      argIndex,
    }
  }

  return null
}

/**
 * Wrap an arrow function argument as an ArchFunction.
 * Unlike fromArrowVariableDeclaration (plan 0009), this has no variable name.
 * The name is synthesized from the call site context.
 */
function fromArrowExpression(node: Node): ArchFunction {
  const arrow = node.asKindOrThrow(SyntaxKind.ArrowFunction)
  return {
    getName: () => undefined, // anonymous --- name derived from context
    getSourceFile: () => arrow.getSourceFile(),
    isExported: () => false, // callbacks are never exported
    isAsync: () => arrow.isAsync(),
    getParameters: () => arrow.getParameters(),
    getReturnType: () => arrow.getReturnType(),
    getBody: () => arrow.getBody(),
    getNode: () => arrow,
    getStartLineNumber: () => arrow.getStartLineNumber(),
    getScope: () => 'public',
  }
}

/**
 * Wrap a function expression argument as an ArchFunction.
 */
function fromFunctionExpression(node: Node): ArchFunction {
  const funcExpr = node.asKindOrThrow(SyntaxKind.FunctionExpression)
  return {
    getName: () => funcExpr.getName(), // may have a name: `function handler() {}`
    getSourceFile: () => funcExpr.getSourceFile(),
    isExported: () => false,
    isAsync: () => funcExpr.isAsync(),
    getParameters: () => funcExpr.getParameters(),
    getReturnType: () => funcExpr.getReturnType(),
    getBody: () => funcExpr.getBody(),
    getNode: () => funcExpr,
    getStartLineNumber: () => funcExpr.getStartLineNumber(),
    getScope: () => 'public',
  }
}

/**
 * Wrap an object literal method declaration as an ArchFunction.
 * Handles: `{ handler(req, res) { ... } }`
 */
function fromMethodDeclaration(node: Node): ArchFunction {
  const method = node.asKindOrThrow(SyntaxKind.MethodDeclaration)
  return {
    getName: () => method.getName(),
    getSourceFile: () => method.getSourceFile(),
    isExported: () => false,
    isAsync: () => method.isAsync(),
    getParameters: () => method.getParameters(),
    getReturnType: () => method.getReturnType(),
    getBody: () => method.getBody(),
    getNode: () => method,
    getStartLineNumber: () => method.getStartLineNumber(),
    getScope: () => 'public',
  }
}
