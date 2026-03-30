import { type Node, type ClassDeclaration, type SourceFile, Node as NodeUtils } from 'ts-morph'
import type { ExpressionMatcher } from './matchers.js'
import type { ArchFunction } from '../models/arch-function.js'

/**
 * Options for module body analysis.
 */
export interface ModuleBodyOptions {
  /**
   * When true, only traverse top-level (module-scope) statements.
   * Skips class bodies, function bodies, and arrow function bodies.
   * Default: false (full file traversal).
   */
  scopeToModule?: boolean
}

/**
 * Result of searching a body for matcher hits.
 */
export interface MatchResult {
  /** Whether at least one match was found */
  found: boolean
  /** The matching nodes (for violation reporting: file, line, text) */
  matchingNodes: Node[]
}

/**
 * Targeted traversal: only check nodes of the specified syntax kinds.
 */
function findMatchesByKind(node: Node, matcher: ExpressionMatcher): Node[] {
  const matches: Node[] = []
  for (const kind of matcher.syntaxKinds!) {
    for (const descendant of node.getDescendantsOfKind(kind)) {
      if (matcher.matches(descendant)) {
        matches.push(descendant)
      }
    }
  }
  return matches
}

/**
 * Broad traversal: check every descendant, then deduplicate.
 *
 * Parent nodes' getText() includes children's text, so regex-based
 * matchers (expression()) match at multiple ancestor levels.
 * Keep only the deepest (most specific) matching nodes.
 */
function findMatchesBroad(node: Node, matcher: ExpressionMatcher): Node[] {
  const matches: Node[] = []
  for (const descendant of node.getDescendants()) {
    if (matcher.matches(descendant)) {
      matches.push(descendant)
    }
  }
  return matches.filter(
    (m) =>
      !matches.some(
        (other) => other !== m && other.getStart() >= m.getStart() && other.getEnd() <= m.getEnd(),
      ),
  )
}

/**
 * Find all nodes in a subtree that match the given matcher.
 *
 * Uses getDescendantsOfKind when the matcher specifies syntaxKinds
 * (efficient — only walks nodes of that kind). Falls back to
 * getDescendants() for matchers without syntaxKinds (expression()).
 */
export function findMatchesInNode(node: Node, matcher: ExpressionMatcher): Node[] {
  if (matcher.syntaxKinds && matcher.syntaxKinds.length > 0) {
    return findMatchesByKind(node, matcher)
  }
  return findMatchesBroad(node, matcher)
}

/**
 * Search all method bodies in a class for matches.
 *
 * Iterates over every method (instance and static), gets the body,
 * and tests each body against the matcher. Returns aggregated results.
 */
export function searchClassBody(cls: ClassDeclaration, matcher: ExpressionMatcher): MatchResult {
  const matchingNodes: Node[] = []

  for (const method of cls.getMethods()) {
    const body = method.getBody()
    if (!body) continue
    matchingNodes.push(...findMatchesInNode(body, matcher))
  }

  // Also check constructor body (use last constructor — earlier ones are overload signatures without bodies)
  const ctors = cls.getConstructors()
  const ctor = ctors[ctors.length - 1]
  if (ctor) {
    const body = ctor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInNode(body, matcher))
    }
  }

  // Also check getters and setters
  for (const accessor of cls.getGetAccessors()) {
    const body = accessor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInNode(body, matcher))
    }
  }
  for (const accessor of cls.getSetAccessors()) {
    const body = accessor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInNode(body, matcher))
    }
  }

  return {
    found: matchingNodes.length > 0,
    matchingNodes,
  }
}

/**
 * Search a function body for matches.
 *
 * Uses ArchFunction.getBody() which returns the function/arrow body.
 * For expression-bodied arrows (`() => expr`), getDescendantsOfKind
 * still works — it walks the expression subtree.
 */
export function searchFunctionBody(fn: ArchFunction, matcher: ExpressionMatcher): MatchResult {
  const body = fn.getBody()
  if (!body) {
    return { found: false, matchingNodes: [] }
  }

  const matchingNodes = findMatchesInNode(body, matcher)
  return {
    found: matchingNodes.length > 0,
    matchingNodes,
  }
}

/**
 * Extract the body from a function-like argument node.
 *
 * Handles:
 * - ArrowFunction: () => { ... } or () => expr
 * - FunctionExpression: function() { ... }
 *
 * Returns undefined if the node is not a function-like expression.
 */
export function getFunctionBody(node: Node): Node | undefined {
  if (NodeUtils.isArrowFunction(node)) {
    return node.getBody()
  }
  if (NodeUtils.isFunctionExpression(node)) {
    return node.getBody()
  }
  return undefined
}

/**
 * Search a module (SourceFile) for matches.
 *
 * Default: walks the entire file (all descendants), including inside
 * class methods and function bodies. This makes `modules().notContain()`
 * a file-level policy check.
 *
 * With `scopeToModule: true`: walks only top-level statements,
 * skipping class bodies, function declaration bodies, and arrow/function
 * expression bodies. Use when you already have class/function rules and
 * want to avoid duplicate violations.
 */
/**
 * Collect matches from top-level variable statement initializers,
 * skipping arrow/function expressions (covered by function rules).
 */
function collectVariableStatementMatches(statement: Node, matcher: ExpressionMatcher): Node[] {
  if (!NodeUtils.isVariableStatement(statement)) return []
  const matches: Node[] = []
  for (const decl of statement.getDeclarationList().getDeclarations()) {
    const initializer = decl.getInitializer()
    if (!initializer) continue
    // Skip arrow/function expressions entirely — function rules cover them
    if (NodeUtils.isArrowFunction(initializer) || NodeUtils.isFunctionExpression(initializer)) {
      continue
    }
    matches.push(...findMatchesInNode(initializer, matcher))
  }
  return matches
}

export function searchModuleBody(
  sourceFile: SourceFile,
  matcher: ExpressionMatcher,
  options?: ModuleBodyOptions,
): MatchResult {
  if (!options?.scopeToModule) {
    // Full file traversal — walk all descendants
    const matchingNodes = findMatchesInNode(sourceFile, matcher)
    return { found: matchingNodes.length > 0, matchingNodes }
  }

  // Module-scope only — walk each top-level statement but skip class/function internals
  const matchingNodes: Node[] = []
  for (const statement of sourceFile.getStatements()) {
    // Skip class declarations entirely (their bodies are covered by class rules)
    if (NodeUtils.isClassDeclaration(statement)) continue

    // Skip function declarations entirely (their bodies are covered by function rules)
    if (NodeUtils.isFunctionDeclaration(statement)) continue

    // For variable statements (const/let/var), check the initializer but skip
    // arrow function and function expression bodies within it
    if (NodeUtils.isVariableStatement(statement)) {
      matchingNodes.push(...collectVariableStatementMatches(statement, matcher))
      continue
    }

    // All other statements: walk their descendants
    matchingNodes.push(...findMatchesInNode(statement, matcher))
  }

  return { found: matchingNodes.length > 0, matchingNodes }
}
