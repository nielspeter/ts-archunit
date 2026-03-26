import {
  type CallExpression,
  type SourceFile,
  type Node,
  Node as NodeUtils,
  SyntaxKind,
} from 'ts-morph'

/**
 * Unified representation of a call expression in the project.
 *
 * Wraps a ts-morph CallExpression with precomputed fields for
 * efficient predicate evaluation.
 *
 * Satisfies Named and Located interfaces from identity predicates.
 * Does NOT satisfy Exportable --- call expressions cannot be exported.
 */
export interface ArchCall {
  /** Full expression text, e.g. "app.get", "router.post", "db.query" */
  getName(): string | undefined

  /** Source file containing this call expression. */
  getSourceFile(): SourceFile

  /** The object the method is called on, or undefined for bare calls. */
  getObjectName(): string | undefined

  /** The method name, or the function name for bare calls. */
  getMethodName(): string | undefined

  /** The arguments to the call expression. */
  getArguments(): Node[]

  /** Underlying ts-morph CallExpression node. */
  getNode(): CallExpression

  /** Start line number in the source file. */
  getStartLineNumber(): number
}

/**
 * Create an ArchCall from a CallExpression.
 *
 * Precomputes object name and method name from the call expression.
 * For `app.get(...)`, objectName is "app" and methodName is "get".
 * For `handleError(...)`, objectName is undefined and methodName is "handleError".
 */
export function fromCallExpression(expr: CallExpression): ArchCall {
  const callExpr = expr.getExpression()

  let objectName: string | undefined
  let methodName: string | undefined

  if (NodeUtils.isPropertyAccessExpression(callExpr)) {
    // app.get(...) => object="app", method="get"
    // router.route.get(...) => object="router.route", method="get"
    methodName = callExpr.getName()
    objectName = callExpr.getExpression().getText()
  } else if (NodeUtils.isIdentifier(callExpr)) {
    // handleError(...) => object=undefined, method="handleError"
    methodName = callExpr.getText()
  } else {
    // Computed or other expression, e.g. getHandler()()
    methodName = callExpr.getText()
  }

  const fullName = objectName !== undefined ? `${objectName}.${methodName}` : methodName

  return {
    getName: () => fullName,
    getSourceFile: () => expr.getSourceFile(),
    getObjectName: () => objectName,
    getMethodName: () => methodName,
    getArguments: () => expr.getArguments(),
    getNode: () => expr,
    getStartLineNumber: () => expr.getStartLineNumber(),
  }
}

/**
 * Scan a source file for all call expressions.
 *
 * Walks all descendants of kind CallExpression. This includes
 * nested calls (e.g., calls inside callbacks), which is intentional ---
 * users filter with predicates to select the calls they care about.
 */
export function collectCalls(sourceFile: SourceFile): ArchCall[] {
  const calls: ArchCall[] = []
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    calls.push(fromCallExpression(callExpr))
  }
  return calls
}
