import { type Node, type ClassDeclaration } from 'ts-morph'
import type { ExpressionMatcher } from './matchers.js'
import type { ArchFunction } from '../models/arch-function.js'

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
 * Find all nodes in a body that match the given matcher.
 *
 * Uses getDescendantsOfKind when the matcher specifies syntaxKinds
 * (efficient — only walks nodes of that kind). Falls back to
 * getDescendants() for matchers without syntaxKinds (expression()).
 */
function findMatchesInBody(body: Node, matcher: ExpressionMatcher): Node[] {
  const matches: Node[] = []

  if (matcher.syntaxKinds && matcher.syntaxKinds.length > 0) {
    // Targeted traversal: only check nodes of the specified kinds
    for (const kind of matcher.syntaxKinds) {
      for (const node of body.getDescendantsOfKind(kind)) {
        if (matcher.matches(node)) {
          matches.push(node)
        }
      }
    }
  } else {
    // Broad traversal: check every descendant node
    for (const node of body.getDescendants()) {
      if (matcher.matches(node)) {
        matches.push(node)
      }
    }
  }

  return matches
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
    matchingNodes.push(...findMatchesInBody(body, matcher))
  }

  // Also check constructor body
  const ctor = cls.getConstructors()[0]
  if (ctor) {
    const body = ctor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInBody(body, matcher))
    }
  }

  // Also check getters and setters
  for (const accessor of cls.getGetAccessors()) {
    const body = accessor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInBody(body, matcher))
    }
  }
  for (const accessor of cls.getSetAccessors()) {
    const body = accessor.getBody()
    if (body) {
      matchingNodes.push(...findMatchesInBody(body, matcher))
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

  const matchingNodes = findMatchesInBody(body, matcher)
  return {
    found: matchingNodes.length > 0,
    matchingNodes,
  }
}
