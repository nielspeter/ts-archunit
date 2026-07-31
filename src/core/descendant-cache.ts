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
 * `notContain(call(api))`. Measured on this repository, eight banned APIs:
 *
 *     before   8,504 walk requests   86 ms
 *     after    1,063 real traversals 11 ms
 *
 * 7.8x, and the element cache from plan 0075 does not touch it — that one
 * removed the redundant *collection* of the functions, and left the eight body
 * walks in place.
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
 * ## The limit, stated
 *
 * `forgetNodesCreatedInBlock` and friends can forget a descendant without
 * modifying the file, and a forgotten node throws when read. The key node is
 * checked, which catches the common case; a descendant forgotten independently
 * of its owner is not detectable without walking the cached list, which is the
 * cost this module exists to avoid. `resetProjectCache()` clears it, and that is
 * the escape hatch for a consumer doing explicit node memory management.
 */
type ByKind = Map<SyntaxKind, readonly Node[]>

let byFile = new WeakMap<SourceFile, Map<Node, ByKind>>()
const watched = new WeakSet<SourceFile>()

registerCacheReset(() => {
  byFile = new WeakMap<SourceFile, Map<Node, ByKind>>()
})

/**
 * Every descendant of `node` with the given kind, walked once per file version.
 *
 * A drop-in replacement for `node.getDescendantsOfKind(kind)`. Returns
 * `readonly` because the array is shared: a caller that sorted or spliced it
 * would corrupt every later matcher over the same body.
 */
export function descendantsOfKind(node: Node, kind: SyntaxKind): readonly Node[] {
  // A forgotten key cannot be read at all, so there is nothing to cache and the
  // call below will throw with ts-morph's own message rather than ours.
  if (node.wasForgotten()) return node.getDescendantsOfKind(kind)

  const sourceFile = node.getSourceFile()
  let perNode = byFile.get(sourceFile)
  if (perNode === undefined) {
    perNode = new Map<Node, ByKind>()
    byFile.set(sourceFile, perNode)
  }
  if (!watched.has(sourceFile)) {
    // Once per file, not once per miss: a watch session that re-evaluates rules
    // would otherwise accumulate one listener per rule execution.
    watched.add(sourceFile)
    sourceFile.onModified(() => byFile.delete(sourceFile))
  }

  let byKind = perNode.get(node)
  if (byKind === undefined) {
    byKind = new Map<SyntaxKind, readonly Node[]>()
    perNode.set(node, byKind)
  }
  const hit = byKind.get(kind)
  if (hit !== undefined) return hit

  const walked = node.getDescendantsOfKind(kind)
  byKind.set(kind, walked)
  return walked
}
