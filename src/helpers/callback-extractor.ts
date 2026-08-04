import { type CallExpression, Node, SyntaxKind } from 'ts-morph'
import type { ArchFunction } from '../models/arch-function.js'
import { fromObjectLiteralFunction } from '../models/arch-function.js'
import { collectObjectLiteralFunctions } from '../core/object-literal-functions.js'

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
      callbacks.push(...extractFromObjectLiteral(arg, callExpr, i))
    }
  }

  return callbacks
}

/**
 * Extract function-valued properties from an object-literal argument as
 * callbacks, using the shared object-literal traversal (F3). Handles arrows,
 * function expressions, method shorthand, and nested object literals
 * (depth-limited). F3 supplies the traversal AND, since plan 0082, the naming:
 * `keyPath` reaches `fromObjectLiteralFunction`, so a property callback carries its
 * property name. (This said "names stay context-derived, arrows anonymous, exactly
 * as before" for one release after that stopped being true — directly contradicted
 * by the code six lines below it.) **Positional** callbacks are still anonymous and
 * identified by `argIndex`.
 */
function extractFromObjectLiteral(
  arg: Node,
  callSite: CallExpression,
  argIndex: number,
): ExtractedCallback[] {
  // `olf.keyPath` used to be dropped here, one line from where it is produced —
  // [plan 0082](../../plans/completed/0082-an-object-literal-callback-keeps-its-name.md).
  // `callbackArchFunction` routes an arrow to `fromArrowExpression`, which hardcodes
  // `getName: () => undefined`, so both callbacks on `{ preHandler, handler }` came
  // back anonymous AND shared an `argIndex` (the object's). Nothing in the shape
  // told them apart, so a rule about the `handler` callback was writable and
  // selected nothing — expressible, plausible, and empty.
  //
  // `fromObjectLiteralFunction` already existed, already exported, already
  // computing the name from exactly this `keyPath`. The gap was one call.
  return collectObjectLiteralFunctions(arg).map((olf) => ({
    // Falls back rather than dropping: `fromObjectLiteralFunction` returns
    // `undefined` for a node shape it does not recognise, and filtering those out
    // would turn an unnamed callback into a MISSING one — a silent under-report,
    // which is worse than the anonymity this change removes.
    //
    // **Unreachable today, and recorded rather than claimed load-bearing.**
    // `collectObjectLiteralFunctions` emits only arrows, function expressions and
    // method declarations — exactly the three kinds `fromObjectLiteralFunction`
    // accepts — so no runtime test covers this branch and none can while the
    // collector stays closed over those kinds. What guards it is the type: removing
    // the `??` is a compile error (TS2322), and CI runs `typecheck` before `test`.
    fn: fromObjectLiteralFunction(olf.node, olf.keyPath) ?? callbackArchFunction(olf.node),
    callSite,
    argIndex,
  }))
}

/** Wrap an object-literal function node as an ArchFunction for the callback path. */
function callbackArchFunction(node: Node): ArchFunction {
  if (Node.isArrowFunction(node)) return fromArrowExpression(node)
  if (Node.isFunctionExpression(node)) return fromFunctionExpression(node)
  return fromMethodDeclaration(node)
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
