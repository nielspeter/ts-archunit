import {
  type Node,
  type ClassDeclaration,
  type SourceFile,
  Node as NodeUtils,
  SyntaxKind,
} from 'ts-morph'
import type { ExpressionMatcher } from './matchers.js'
import type { ArchFunction } from '../models/arch-function.js'
import { allDescendants, descendantsOfKind } from '../core/descendant-cache.js'

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
  /**
   * Parallel to {@link matchingNodes}: which comment each match is about, for
   * trivia matchers. `undefined` entries mean the node itself is the match.
   *
   * Bug 0034. One node can carry several matching comments, so the node alone
   * cannot identify a finding — four stacked `// TODO` lines lead one
   * statement and are four findings, not one.
   */
  triviaPositions: (number | undefined)[]
}

/** One match: the node to report on, and which comment it is about. */
export interface Match {
  readonly node: Node
  readonly triviaPos?: number
}

/** Split matches into the parallel arrays `MatchResult` carries. */
function toResult(matches: readonly Match[]): MatchResult {
  return {
    found: matches.length > 0,
    matchingNodes: matches.map((m) => m.node),
    triviaPositions: matches.map((m) => m.triviaPos),
  }
}

/**
 * Targeted traversal: only check nodes of the specified syntax kinds.
 */
function findMatchesByKind(node: Node, matcher: ExpressionMatcher): Match[] {
  const matches: Match[] = []
  for (const kind of matcher.syntaxKinds ?? []) {
    // Cached: the walk is a function of (node, kind) and only the matcher's
    // filter differs, so N matchers over one body did N identical traversals.
    // `agentGuardrails` emits one rule per banned API and paid exactly that.
    for (const descendant of descendantsOfKind(node, kind)) {
      if (matcher.matches(descendant)) {
        matches.push({ node: descendant })
      }
    }
  }
  return matches
}

/**
 * The line a finding about `node` should name.
 *
 * For a trivia matcher that is the **comment's** line, not the node's — the
 * position comes from `MatchResult.triviaPositions`, alongside the node. One
 * accessor rather than ten open-coded `node.getStartLineNumber()` calls,
 * because the `notContain` family computes the line twice per finding (the
 * `line` field and the message text) and the two must not disagree.
 */
export function reportedLine(node: Node, triviaPos: number | undefined): number {
  if (triviaPos === undefined) return node.getStartLineNumber()
  return node.getSourceFile().getLineAndColumnAtPos(triviaPos).line
}

/**
 * Broad traversal: check every descendant, then deduplicate.
 *
 * Parent nodes' getText() includes children's text, so regex-based
 * matchers (expression()) match at multiple ancestor levels.
 * Keep only the deepest (most specific) matching nodes.
 */
function findMatchesBroad(node: Node, matcher: ExpressionMatcher): Match[] {
  const matches: Node[] = []
  // Cached: the walk is kind-independent and identical across matchers, and
  // measured it is ~three quarters of a broad matcher's cost. Only the filter
  // below is per-matcher.
  for (const descendant of allDescendants(node)) {
    if (matcher.matches(descendant)) {
      matches.push(descendant)
    }
  }
  return matches
    .filter(
      (m) =>
        !matches.some(
          (other) =>
            other !== m && other.getStart() >= m.getStart() && other.getEnd() <= m.getEnd(),
        ),
    )
    .map((n) => ({ node: n }))
}

/**
 * Find all nodes in a subtree that match the given matcher.
 *
 * Uses getDescendantsOfKind when the matcher specifies syntaxKinds
 * (efficient — only walks nodes of that kind). Falls back to
 * getDescendants() for matchers without syntaxKinds (expression()).
 */
export function findMatchesInNode(node: Node, matcher: ExpressionMatcher): Match[] {
  // TRIVIA first, and at the dispatcher rather than inside the broad walk.
  // A trivia matcher may also narrow by `syntaxKinds` for speed — plan 0047's
  // `tsDirective()` wants exactly that — and with the branch one level down it
  // took the by-kind path and got no expansion at all.
  if (matcher.matchedTriviaPositions !== undefined) {
    return triviaMatches(node, matcher)
  }
  if (matcher.syntaxKinds && matcher.syntaxKinds.length > 0) {
    return findMatchesByKind(node, matcher)
  }
  return findMatchesBroad(node, matcher)
}

/**
 * One match per distinct COMMENT, not per node.
 *
 * The deepest-node filter is skipped deliberately: it exists because
 * `expression()` matches at every ancestor level, and a comment's node is where
 * it is **attached** rather than something containing it. Applying it made two
 * nodes with identical spans each remove the other — measured at zero findings
 * for three comments.
 *
 * The same comment is trivia of several nested nodes, so positions are
 * deduplicated globally and the first node to name one wins.
 */
function triviaMatches(node: Node, matcher: ExpressionMatcher): Match[] {
  const seen = new Set<number>()
  const out: Match[] = []
  const candidates =
    matcher.syntaxKinds && matcher.syntaxKinds.length > 0
      ? matcher.syntaxKinds.flatMap((kind) => [...descendantsOfKind(node, kind)])
      : allDescendants(node)
  for (const descendant of [node, ...candidates]) {
    for (const pos of matcher.matchedTriviaPositions?.(descendant) ?? []) {
      if (seen.has(pos)) continue
      seen.add(pos)
      out.push({ node: descendant, triviaPos: pos })
    }
  }
  // Source order. Pre-order visits an enclosing node's TRAILING range before
  // the statements it spans, so raw order is not the reader's.
  return out.sort((a, b) => (a.triviaPos ?? 0) - (b.triviaPos ?? 0))
}

/**
 * Search all method bodies in a class for matches.
 *
 * Iterates over every method (instance and static), gets the body,
 * and tests each body against the matcher. Returns aggregated results.
 */
export function searchClassBody(cls: ClassDeclaration, matcher: ExpressionMatcher): MatchResult {
  const matchingNodes: Match[] = []

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

  return toResult(matchingNodes)
}

/**
 * The node a function's own docstring is attached to.
 *
 * For a `function` declaration that is the declaration itself. For an arrow or
 * function expression assigned to a `const`, `ArchFunction.getNode()` returns the
 * **VariableDeclaration**, and the comment attaches two levels up on the
 * `VariableStatement` — measured: `nodeLeading: 0`, `parentLeading: 0`,
 * `grandparentLeading: 1`. So the first version of bug 0052's fix repaired
 * `function f()` and left `const f = () => …` broken, which is half the codebases
 * that would use the rule.
 *
 * `getFirstAncestorByKind` finds the NEAREST enclosing statement, so a nested
 * arrow inside a function does not reach out to the outer function's docstring —
 * pinned by a control, because that over-reach is the obvious way to fix this
 * wrongly.
 */
function triviaRoot(node: Node): Node {
  if (!NodeUtils.isVariableDeclaration(node)) return node
  return node.getFirstAncestorByKind(SyntaxKind.VariableStatement) ?? node
}

/**
 * Search a function body for matches.
 *
 * Uses ArchFunction.getBody() which returns the function/arrow body.
 * For expression-bodied arrows (`() => expr`), getDescendantsOfKind
 * still works — it walks the expression subtree.
 */
export function searchFunctionBody(fn: ArchFunction, matcher: ExpressionMatcher): MatchResult {
  // A TRIVIA matcher searches from the DECLARATION; everything else from the body.
  //
  // [Bug 0052](../../bugs/fixed/0052-nostubcomments-cannot-see-a-functions-own-docstring.md):
  // a function's own leading comment attaches to the declaration, not to anything
  // inside the body — so `noStubComments()` saw a `TODO` inside a body and trailing
  // a function, and missed both `// TODO` and `/** TODO */` **above** it, which are
  // the two placements anyone actually writes. Measured 1/1/0/0 across those four.
  // `comment()` reads leading ranges perfectly well; the traversal never offered it
  // the declaration.
  //
  // Searching from the declaration rather than *also* searching it: `triviaMatches`
  // visits `[node, ...allDescendants(node)]` and deduplicates by comment position,
  // so the body is still covered and no comment can be reported twice. Testing the
  // declaration separately would have needed its own dedup against the body's.
  //
  // Only for trivia matchers, and that discrimination is the point rather than a
  // shortcut: `functionNotContain` is general-purpose, and handing the declaration
  // node to `expression(/…/)` would match the function's entire source text —
  // turning every body-analysis rule into a whole-declaration one. A matcher that
  // reads trivia is exactly the set that needs the attachment point.
  if (matcher.matchedTriviaPositions !== undefined) {
    return toResult(findMatchesInNode(triviaRoot(fn.getNode()), matcher))
  }

  const body = fn.getBody()
  if (!body) {
    return toResult([])
  }

  const matchingNodes = findMatchesInNode(body, matcher)
  return toResult(matchingNodes)
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
function collectVariableStatementMatches(statement: Node, matcher: ExpressionMatcher): Match[] {
  if (!NodeUtils.isVariableStatement(statement)) return []
  const matches: Match[] = []
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
    return toResult(matchingNodes)
  }

  // Module-scope only — walk each top-level statement but skip class/function internals
  const matchingNodes: Match[] = []
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

  return toResult(matchingNodes)
}
