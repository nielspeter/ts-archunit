/**
 * F2 — the shared set-difference + non-vacuity core.
 *
 * Pure and engine-neutral: it compares two key sets by **identity** and reports
 * the asymmetric differences plus emptiness. It never counts and never decides
 * policy — the caller chooses which differences are violations (coverage /
 * orphans / bijection) and how to treat an empty side (non-vacuity).
 *
 * Both `correspondence()` (plan 0064+/proposal 017) and `crossLayer`'s
 * existence check (`haveMatchingCounterpart`) build on this one function, so
 * the two "every X has a matching Y" engines can never drift — and neither can
 * silently green on an empty side (ADR-008).
 */

/** The identity comparison of two key sets. No counts — sets of keys. */
export interface CorrespondenceResult {
  /** Side-A keys with no match in side B — coverage gaps. */
  readonly missing: readonly string[]
  /** Side-B keys with no match in side A — orphans. */
  readonly orphans: readonly string[]
  /** True when side A contributed zero keys (non-vacuity signal). */
  readonly aEmpty: boolean
  /** True when side B contributed zero keys (non-vacuity signal). */
  readonly bEmpty: boolean
}

/**
 * Compare two key sets by identity.
 *
 * `missing` = A \ B (every A-key must have a B match for coverage).
 * `orphans` = B \ A (every B-key must have an A source for no-orphans).
 * Bijection holds iff both are empty. Duplicate keys within a side collapse
 * (set semantics); order of `missing`/`orphans` follows first appearance in
 * the respective input for stable, readable output.
 */
export function setCorrespondence(
  aKeys: Iterable<string>,
  bKeys: Iterable<string>,
): CorrespondenceResult {
  const a = new Set(aKeys)
  const b = new Set(bKeys)

  const missing: string[] = []
  for (const key of a) {
    if (!b.has(key)) missing.push(key)
  }

  const orphans: string[] = []
  for (const key of b) {
    if (!a.has(key)) orphans.push(key)
  }

  return { missing, orphans, aEmpty: a.size === 0, bEmpty: b.size === 0 }
}
