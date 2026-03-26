import type { SyntaxKind } from 'ts-morph'
import { type Node, Node as NodeClass } from 'ts-morph'

/**
 * Structural fingerprint of a function body.
 * Captures the shape (node kinds, call targets) while ignoring
 * identifiers, literals, and whitespace.
 */
export interface Fingerprint {
  /** Ordered sequence of syntax node kinds in the body */
  readonly kinds: readonly SyntaxKind[]
  /** Normalized call targets (e.g. ['parseInt', 'this.extractCount']) */
  readonly calls: readonly string[]
  /** Total AST node count (for line-count filtering) */
  readonly nodeCount: number
}

/**
 * Build a structural fingerprint from a function body AST node.
 * Walks all descendants, records their SyntaxKind in order,
 * and extracts call expression targets.
 */
export function buildFingerprint(body: Node): Fingerprint {
  const kinds: SyntaxKind[] = []
  const calls: string[] = []

  for (const node of body.getDescendants()) {
    kinds.push(node.getKind())
    if (NodeClass.isCallExpression(node)) {
      calls.push(node.getExpression().getText().replace(/\?\./g, '.'))
    }
  }

  return { kinds, calls, nodeCount: kinds.length }
}

/**
 * Compute similarity between two fingerprints.
 * Uses longest common subsequence on the kinds array,
 * normalized to [0, 1].
 */
export function computeSimilarity(a: Fingerprint, b: Fingerprint): number {
  if (a.kinds.length === 0 && b.kinds.length === 0) return 1.0
  if (a.kinds.length === 0 || b.kinds.length === 0) return 0.0

  const lcs = lcsLength(a.kinds, b.kinds)
  return lcs / Math.max(a.kinds.length, b.kinds.length)
}

/** Standard LCS length computation (space-optimized two-row DP). */
function lcsLength(a: readonly number[], b: readonly number[]): number {
  const m = a.length
  const n = b.length
  let prev = new Array<number>(n + 1).fill(0)
  let curr = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!)
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }

  return prev[n]!
}
