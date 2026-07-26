import picomatch from 'picomatch'
import type { GlobLeaf, GlobNode, GlobSite } from './glob-site.js'
import { isGlobNode, isOpaqueGlob } from './glob-site.js'
import type { PathUniverse } from './path-universe.js'
import { viewsFor } from './path-universe.js'
import { syntacticFault } from './glob-diagnosis.js'

/**
 * Whether a glob tree can never match anything in this project.
 *
 * Three consecutive revisions of this function returned a false verdict, each
 * on a shape its author had not thought to try, so it is now checked
 * exhaustively rather than argued about:
 * `tests/core/glob-evaluator-soundness.test.ts` enumerates every expression of
 * at most three combinator nodes over {dead, live, opaque} and compares this
 * implementation against plain set semantics. The requirement is **soundness**
 * — a fault is justified only if the expression selects the empty set for
 * every possible value of the leaves this function cannot see, since all it
 * knows is that a dead site matches nothing.
 *
 * The three rules, and what each one is load-bearing for:
 *
 * - **A negative site is never dead.** `not(unsatisfiable)` selects
 *   *everything*; that is over-selection, not vacuity.
 * - **An opaque leaf is never dead**, and is never dropped. See `OpaqueGlob`.
 * - **`all` is dead if any child is; `any` is dead only if every child is.**
 *   Which is why `negateGlobs` has to invert `op` and not just polarity.
 */
export function isDeadGlobTree(node: GlobNode, universe: PathUniverse): boolean {
  return node.op === 'all'
    ? node.children.some((child) => isDeadChild(child, universe))
    : // `every` on an empty array is `true`, which would fault a rule that
      // declares no globs at all. Unreachable, because every combinator
      // contributes one child per input and a missing declaration becomes an
      // opaque leaf rather than nothing — but stated, not assumed.
      node.children.length > 0 && node.children.every((child) => isDeadChild(child, universe))
}

function isDeadChild(child: GlobNode | GlobLeaf<GlobSite>, universe: PathUniverse): boolean {
  if (isGlobNode(child)) return isDeadGlobTree(child, universe)
  if (isOpaqueGlob(child)) return false
  return isDeadSite(child, universe)
}

/**
 * Whether one site's glob matches nothing in the project.
 *
 * Two independent ways to be dead, and both are needed:
 *
 * 1. **Syntactically** — `'src/domain/**'` on a predicate that matches
 *    absolute paths can never match, whatever the project contains.
 * 2. **Against the universe** — anchored, well-formed, and nothing there.
 *
 * The syntactic check is not redundant, and leaving it out was a live false
 * green caught by a test: the universe carries a tsconfig-relative view so
 * that a wrong `base` cannot make a glob look UNmatched — and `'src/domain/**'`
 * matches `src/domain` in that view while matching nothing at runtime, where
 * `resideInFolder` reads absolute paths. Unanchored globs are the commonest
 * real mistake and the entire subject of the 0.18.1 release, so a design that
 * quietly calls them satisfiable defeats its own purpose.
 *
 * Only `file-path` and `parent-dir` are checkable; `viewsFor` returns no views
 * for the others, and a site with no views is never dead.
 */
export function isDeadSite(site: GlobSite, universe: PathUniverse): boolean {
  if ((site.polarity ?? 'positive') === 'negative') return false
  const views = viewsFor(universe, site.kind)
  if (views.length === 0) return false
  if (syntacticFault(site.glob, site.kind, site.base) !== undefined) return true
  const isMatch = picomatch(site.glob)
  // Never `view.some(isMatch)` — picomatch reads the array index as its
  // second argument and returns a truthy object from index 1 onwards.
  return !views.some((view) => view.some((candidate) => isMatch(candidate)))
}

/** Every site in a tree, in declaration order. Opaque leaves are skipped. */
export function globSitesOf(node: GlobNode): GlobSite[] {
  const sites: GlobSite[] = []
  const walk = (current: GlobNode): void => {
    for (const child of current.children) {
      if (isGlobNode(child)) walk(child)
      else if (!isOpaqueGlob(child)) sites.push(child)
    }
  }
  walk(node)
  return sites
}
