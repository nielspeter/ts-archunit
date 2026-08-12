import { SyntaxKind, type Node, Node as NodeClass } from 'ts-morph'

// Deliberately not exhaustive over every text-bearing kind — `TemplateHead`/
// `TemplateMiddle`/`TemplateTail` (interpolated templates), `BigIntLiteral` and
// `RegularExpressionLiteral` are omitted. Every omission UNDERcounts vocabulary,
// which only makes the floor (plan 0103) more conservative — fewer pairs
// compared, never a false positive from a body that reads as emptier than it
// is. Widen this set if a real interpolated-template-heavy corpus needs it.
const TEXT_KINDS = new Set<SyntaxKind>([
  SyntaxKind.Identifier,
  SyntaxKind.PrivateIdentifier,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.NumericLiteral,
])

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
  /**
   * Count of DISTINCT identifier/literal texts in the body — the vocabulary
   * a body actually carries, as opposed to its punctuation/keyword shape.
   * Plan 0103's floor reads this; `computeSimilarity()` does not — see that
   * function's own docs for why.
   */
  readonly distinctVocabulary: number
}

/**
 * Build a structural fingerprint from a function body AST node.
 * Walks all descendants, records their SyntaxKind in order,
 * and extracts call expression targets.
 */
export function buildFingerprint(body: Node): Fingerprint {
  const kinds: SyntaxKind[] = []
  const calls: string[] = []
  const distinct = new Set<string>()

  for (const node of body.getDescendants()) {
    const kind = node.getKind()
    kinds.push(kind)
    if (NodeClass.isCallExpression(node)) {
      calls.push(node.getExpression().getText().replace(/\?\./g, '.'))
    }
    if (TEXT_KINDS.has(kind)) {
      distinct.add(node.getText())
    }
  }

  return { kinds, calls, nodeCount: kinds.length, distinctVocabulary: distinct.size }
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
      const prevDiag = prev[j - 1] ?? 0
      const prevAbove = prev[j] ?? 0
      const currLeft = curr[j - 1] ?? 0
      curr[j] = a[i - 1] === b[j - 1] ? prevDiag + 1 : Math.max(prevAbove, currLeft)
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }

  return prev[n] ?? 0
}
