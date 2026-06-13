import {
  type CallExpression,
  type SourceFile,
  type Node,
  Node as NodeUtils,
  SyntaxKind,
} from 'ts-morph'

/**
 * Options for {@link ArchCall.getName}.
 *
 * Both fields are opt-in. With no options, `getName()` returns the bare
 * `${object}.${method}` form (e.g. `app.post`) — the predicate-visible
 * identity.
 */
export interface GetNameOptions {
  /**
   * Index of an argument whose source text should be folded into the
   * returned name. When the indexed argument is a `StringLiteral` or
   * `NoSubstitutionTemplateLiteral`, the returned name becomes
   * `` `${callee}(${arg.getText()})` ``. Otherwise the bare name is
   * returned unchanged (graceful degrade — see plan 0057 edge cases).
   */
  readonly withArgument?: number

  /**
   * When `true` and `withArgument` produced an enriched name, elide
   * the middle of a literal whose `getText()` exceeds 80 characters
   * with `…`. Uses `slice(0, 38) + '…' + slice(-38)` so the resulting
   * literal portion is exactly 77 characters.
   *
   * Used at violation-message sites to keep CI output scannable.
   * The element field passes `elide: false` (the default) so exclusion
   * patterns key on stable, verbatim identities.
   */
  readonly elide?: boolean
}

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
  /**
   * Full expression text, e.g. "app.get", "router.post", "db.query".
   *
   * With `options.withArgument` set, folds the indexed argument's raw
   * source text into the name when it's a `StringLiteral` or
   * `NoSubstitutionTemplateLiteral`. See {@link GetNameOptions}.
   *
   * Identity predicates (`haveNameMatching`, etc.) call this with no
   * arguments and see the bare name — argument enrichment is an
   * identity/exclusion concern, not a filtering concern. To filter by
   * argument value, use `withStringArg(i, glob)` or
   * `withArgMatching(i, pattern)`.
   */
  getName(options?: GetNameOptions): string | undefined

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
 * Build the argument-enriched suffix for `ArchCall.getName`.
 *
 * Returns the raw source text of `expr.getArguments()[index]` iff that
 * argument is a `StringLiteral` or `NoSubstitutionTemplateLiteral`.
 * Otherwise returns undefined → caller falls back to the bare name.
 *
 * Degrade cases (all return undefined):
 * - Out-of-bounds index
 * - `AsExpression` (e.g. `'/foo' as const`)
 * - `ParenthesizedExpression` (e.g. `('/foo')`)
 * - `TemplateExpression` with substitutions (e.g. `` `/foo/${x}` ``)
 * - Tagged templates (e.g. `` sql`SELECT ...` ``)
 * - Identifiers and member expressions
 * - Spread elements
 * - Non-string literals (numeric, boolean, etc.)
 */
function buildEnrichedSuffix(
  expr: CallExpression,
  index: number,
  elide: boolean,
): string | undefined {
  const args = expr.getArguments()
  const arg = args[index]
  if (!arg) return undefined
  if (!NodeUtils.isStringLiteral(arg) && !NodeUtils.isNoSubstitutionTemplateLiteral(arg)) {
    return undefined
  }
  const raw = arg.getText()
  if (elide && raw.length > 80) {
    return `${raw.slice(0, 38)}…${raw.slice(-38)}`
  }
  return raw
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
    getName: (options?: GetNameOptions): string | undefined => {
      if (options?.withArgument === undefined) return fullName
      const suffix = buildEnrichedSuffix(expr, options.withArgument, options.elide ?? false)
      if (suffix === undefined) return fullName
      return `${fullName}(${suffix})`
    },
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
