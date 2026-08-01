import type { Node, SourceFile, SyntaxKind } from 'ts-morph'
import { registerCacheReset } from './cache-registry.js'

/**
 * One descendant walk per (node, kind), shared across matchers.
 *
 * `findMatchesByKind` (`helpers/body-traversal.ts`) walks a body with
 * `getDescendantsOfKind(kind)` and then filters the result with the matcher. The
 * **walk** is a function of the node and the kind; only the **filter** differs
 * per matcher. So N matchers over one body did N identical traversals.
 *
 * `agentGuardrails` is the shape that pays for it: it emits one `functions()`
 * rule per banned API (`presets/agent-guardrails.ts`), each carrying
 * `notContain(call(api))`.
 *
 * **Measured** on this repository (530 files), element cache warm, by
 * implementing the change and reverting the one-line wiring in
 * `body-traversal.ts` — eight banned APIs:
 *
 *     walk requests   8,504  ->  real traversals  1,063     (8.0x, the stable ratio)
 *     wall clock         88ms ->                    16-22ms  (indicative)
 *
 * The ratio is the number to trust; the milliseconds move with machine load, and
 * three independent reproductions of this change landed between 11ms and 23ms
 * for the same work. The element cache from plan 0075 does not touch any of it —
 * that one removed the redundant *collection* of the functions and left the body
 * walks in place.
 *
 * ## Only the by-kind path is cached, and the other one is more expensive
 *
 * `findMatchesByKind` is cached; `findMatchesBroad` (`body-traversal.ts`) walks
 * every descendant per matcher and is **not**. Every matcher in
 * `helpers/matchers.ts` declares `syntaxKinds` except `expression()` and
 * `comment()`, which take the broad path — and `agentGuardrails({ noStubs: true })`
 * reaches it through `noStubComments()`.
 *
 * Measured, six successive broad rules over the same bodies:
 *
 *     rule 1   192ms   (cold: ts-morph wrapper creation)
 *     rules 2-6  ~57ms each
 *
 * So the marginal broad rule costs ~57ms against ~1ms for a cached by-kind one.
 * That is a **larger** remaining win than the one this module delivers, and it is
 * deliberately not taken here for two reasons worth writing down rather than
 * rediscovering: caching `getDescendants()` would retain every wrapper in every
 * body rather than one kind's worth, which is a materially different memory
 * profile; and the broad matchers' filters differ per matcher, so only the walk
 * is shareable. Filed rather than done.
 *
 * (This paragraph used to cite `comment()`'s per-matcher dedup state as the
 * second half of that reason. Bug 0034 removed that state — it was never reset,
 * so a rule object evaluated twice went silent — and dedup now lives in the
 * traversal, keyed on the comment's position. The conclusion is unchanged:
 * `expression()`'s regex still differs per matcher.)
 *
 * ## Invalidation, which is the whole difficulty
 *
 * A node key is **not** safe on its own, and that was measured before this was
 * written rather than assumed:
 *
 *     f.getDescendantsOfKind(CallExpression)   -> 1 call
 *     f.addStatements('eval("z")')
 *     same f object = true, f.wasForgotten() = false
 *     f.getDescendantsOfKind(CallExpression)   -> 2 calls
 *
 * A function node survives an edit to its own body and is not forgotten, so a
 * `WeakMap<Node, …>` would serve the pre-edit list — the same trap plan 0076
 * found one level up with `SourceFile`, and `Node` has no `onModified` of its
 * own to escape it.
 *
 * So entries are grouped **by source file** and dropped wholesale when that file
 * is modified, using the listener plan 0076 established. One listener per file,
 * guarded by a `WeakSet`.
 *
 * ## Forgotten descendants, and the limit that remains
 *
 * `node.forget()` and `project.forgetNodesCreatedInBlock()` forget nodes without
 * modifying the file, so `onModified` never fires. The **key** node stays live
 * and unforgotten while the walked **descendants** are gone — so an early
 * `node.wasForgotten()` check, which is what this module shipped first, guards
 * the case that was already harmless and misses the one that breaks. Measured as
 * a regression against `main` through the rule path: 1 violation before, an
 * `InvalidOperationError` after.
 *
 * {@link usable} therefore validates the cached list's endpoints on every hit and
 * re-walks when they are gone, which restores `main`'s behaviour. What remains
 * uncovered is interleaved forget points leaving a partially-forgotten list;
 * ts-morph forgets a created-in-block set atomically, so that is not a shape its
 * own mechanism produces. `resetProjectCache()` clears the cache outright and is
 * the escape hatch for a consumer doing explicit node memory management.
 */
type ByKind = Map<SyntaxKind, readonly Node[]>

let byFile = new WeakMap<SourceFile, Map<Node, ByKind>>()
/** The kind-independent walk, in the same per-file lifetime as {@link byFile}. */
let allByFile = new WeakMap<SourceFile, Map<Node, readonly Node[]>>()
const watched = new WeakSet<SourceFile>()

registerCacheReset(() => {
  byFile = new WeakMap<SourceFile, Map<Node, ByKind>>()
  allByFile = new WeakMap<SourceFile, Map<Node, readonly Node[]>>()
})

/**
 * Register the invalidation listener for a file, once.
 *
 * Not once per cache miss: a watch session that re-evaluates rules would
 * otherwise accumulate one listener per rule execution. Both maps are dropped
 * together, because the same event invalidates both.
 *
 * The closure reads `byFile` / `allByFile` as **live bindings** rather than
 * capturing them, which is what keeps invalidation working after
 * `registerCacheReset` replaces the maps. Capturing by value made a post-reset
 * edit invisible and passed the entire suite — there is a test named for it.
 */
function watchOnce(sourceFile: SourceFile): void {
  if (watched.has(sourceFile)) return
  watched.add(sourceFile)
  sourceFile.onModified(() => {
    byFile.delete(sourceFile)
    allByFile.delete(sourceFile)
  })
}

/**
 * Whether a cached list can still be read.
 *
 * Endpoints only, and that is not a heuristic: ts-morph's
 * `ForgetfulNodeCache.forgetLastPoint` forgets a whole created-in-block set at
 * once, so a partially-forgotten list is not a shape the mechanism produces.
 * Walking the full list on every hit would cost what this module exists to save.
 */
function usable(nodes: readonly Node[]): boolean {
  const first = nodes[0]
  if (first === undefined) return true
  const last = nodes[nodes.length - 1]
  return !first.wasForgotten() && last !== undefined && !last.wasForgotten()
}

/**
 * Every descendant of `node` with the given kind, walked once per file version.
 *
 * A drop-in replacement for `node.getDescendantsOfKind(kind)`. Returns
 * `readonly` because the array is shared: a caller that sorted or spliced it
 * would corrupt every later matcher over the same body.
 */
export function descendantsOfKind(node: Node, kind: SyntaxKind): readonly Node[] {
  const sourceFile = node.getSourceFile()
  let perNode = byFile.get(sourceFile)
  if (perNode === undefined) {
    perNode = new Map<Node, ByKind>()
    byFile.set(sourceFile, perNode)
  }
  watchOnce(sourceFile)

  let byKind = perNode.get(node)
  if (byKind === undefined) {
    byKind = new Map<SyntaxKind, readonly Node[]>()
    perNode.set(node, byKind)
  }
  const hit = byKind.get(kind)
  // `usable`, not just `!== undefined`. A forget point forgets the walked
  // DESCENDANTS while the key node stays live and unforgotten, so serving the
  // cached list makes the next read throw where an uncached walk succeeded.
  // Measured as a regression against `main`, through the rule path: 1 violation
  // before, `InvalidOperationError` after. Re-walking is the correct answer —
  // the nodes are gone, so the list is simply wrong.
  if (hit !== undefined && usable(hit)) return hit

  const walked = node.getDescendantsOfKind(kind)
  byKind.set(kind, walked)
  return walked
}

/**
 * Every descendant of `node`, walked once per file version.
 *
 * The kind-independent twin of {@link descendantsOfKind}, for `findMatchesBroad`
 * — the strategy `expression()` and `comment()` take, having no `syntaxKinds` to
 * narrow by.
 *
 * **Measured** on this repository, 1,698 function bodies / 117,949 descendants,
 * ts-morph's wrapper cache already warm:
 *
 *     getDescendants()          49 ms   <- what this removes
 *     + getText() on each       71 ms
 *     + regex test on each      68 ms
 *
 * The walk is roughly three quarters of a broad matcher's cost; the filter is the
 * rest and is not shareable — `expression()`'s regex differs per matcher.
 * (`comment()`'s dedup state was the other half of this until bug 0034 removed
 * it; the filter is still per-matcher.) End to end, six successive broad
 * rules over the same bodies: **~57 ms each becomes ~17 ms each.**
 *
 * The memory objection — that this retains every wrapper in every body rather
 * than one kind's worth — does not survive checking. ts-morph's own
 * `ForgetfulNodeCache` already holds every wrapper it creates for the lifetime of
 * the `SourceFile`, so the array adds N references, not N objects.
 */
export function allDescendants(node: Node): readonly Node[] {
  const sourceFile = node.getSourceFile()
  let perNode = allByFile.get(sourceFile)
  if (perNode === undefined) {
    perNode = new Map<Node, readonly Node[]>()
    allByFile.set(sourceFile, perNode)
  }
  watchOnce(sourceFile)

  const hit = perNode.get(node)
  if (hit !== undefined && usable(hit)) return hit

  const walked = node.getDescendants()
  perNode.set(node, walked)
  return walked
}
