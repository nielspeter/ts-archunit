import type { Node } from 'ts-morph'
import { getElementName } from '../core/violation.js'

/**
 * Which family of body-analysis condition produced a match.
 *
 * Part of the identity so that a class-level and a module-level rule reporting
 * the same node stay distinct findings.
 */
export type MatchKind =
  | 'module-body'
  | 'class-body'
  | 'function-body'
  | 'call-callback'
  | 'call-argument'

/**
 * Assign each matched node a baseline identity that is not a coordinate.
 *
 * Body-analysis conditions emit one violation per matching node, and the
 * rendered message distinguishes them by line number. That cannot be the
 * identity: add two lines at the top of a file with matches at lines 2 and 4,
 * and the entry recorded for line 4 now matches the violation that used to be
 * at line 2 — the baseline accepts the **wrong** finding, rather than merely
 * missing one. That is worse than a miss, because it silently keeps a genuinely
 * new violation green.
 *
 * The line cannot simply be dropped either: within one scope, two matches of
 * the same matcher are otherwise identical, and a shared identity means
 * accepting one accepts both. So bucket by the enclosing declaration, then
 * number the matches inside each bucket.
 *
 * Measured over 596 matched nodes in a real 808-file project, this is 1:1 —
 * and strictly better than the line, which merges two `process.env` accesses
 * that happen to share one. Renumbering is the residual cost: adding or
 * removing a match shifts the ordinals of later matches **in the same
 * declaration**, which is a change to that declaration. With the line, editing
 * anything above shifts every finding in the file.
 *
 * Bucketing by declaration is what keeps that blast radius local, so it is
 * load-bearing rather than cosmetic — a single per-file counter would renumber
 * everything downstream of any edit.
 *
 * @param kind - The condition family, so two families cannot collide on a node.
 * @param filePath - Absolute path; normalised away at hash time.
 * @param nodes - The matching nodes, in the order they will be reported.
 * @param matcherDescription - Distinguishes co-located matches of different matchers.
 */
export function identifyMatches(
  kind: MatchKind,
  filePath: string,
  nodes: readonly Node[],
  matcherDescription: string,
): string[] {
  const ordinals = new Map<string, number>()
  return nodes.map((node) => {
    const scope = `${getElementName(node)}::${matcherDescription}`
    const ordinal = (ordinals.get(scope) ?? 0) + 1
    ordinals.set(scope, ordinal)
    return `${kind}::${filePath}::${scope}#${String(ordinal)}`
  })
}
