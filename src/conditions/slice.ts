import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { Slice } from '../models/slice.js'
import type { ImportOptions } from '../core/import-options.js'
import { splitGlobArgs } from '../core/import-options.js'
import type { SliceDependencySite } from '../helpers/slice-graph.js'
import { edgeDiscriminator, edgeVerb } from '../core/module-edges.js'
import { sliceGraph, buildFileToSliceMap } from '../helpers/slice-graph.js'
import { tarjanSCC, type AdjacencyList } from '../helpers/tarjan.js'

/**
 * Assert that no circular dependencies exist between slices.
 *
 * Builds a directed dependency graph from imports and re-exports,
 * then runs Tarjan's SCC algorithm to detect cycles.
 * Each cycle produces a violation listing the cycle path.
 *
 * @example
 * slices(project)
 *   .matching('src/features/*\/')
 *   .should().beFreeOfCycles()
 *   .check()
 */
/**
 * `canonicalizeCycle` lived here, and sorting replaced it — bug 0056.
 *
 * It rotated an SCC to start at its lexicographically smallest member, for a real reason:
 * Tarjan emits membership in traversal order, traversal follows the file walk, and the same
 * cycle therefore had two identities on two machines. That is the concern
 * [bug 0010](../../bugs/fixed/0010-violation-identity-embeds-absolute-paths.md) introduced
 * the `identity` field for — the original docstring cited it here, a little loosely, since
 * 0010 itself is about absolute paths rather than about cycles.
 *
 * Rotation was necessary and **not sufficient**, and the reason is in its own docstring's
 * final claim — *"Direction is NOT normalized, because `a -> b -> c -> a` and
 * `a -> c -> b -> a` traverse different edges and are genuinely different cycles"*. That
 * premise requires the array to be an edge-ordered PATH. It is not, for any component of
 * three or more: measured, a real ring `a→b→c→d→a` came out as `a -> d -> c -> b -> a`,
 * every arrow reversed. So the preserved "direction" was information about the traversal,
 * not about the graph — and reordering two imports moved the element from `[a, c, b]` to
 * `[a, b, c]`, reddening CI on a cosmetic edit.
 *
 * Sorting subsumes rotation for a set and adds the missing half. If a future change
 * recovers a REAL path (bug 0055's fuller fix), direction becomes genuine information
 * again — and then the right shape is a sorted member set for the identity with the path
 * carried in the message, not a return to rotation.
 */

/**
 * Every slice must be free of dependency cycles.
 *
 * **The graph counts eager static dependencies: `import` declarations AND
 * re-exports.** Since v0.48.0 `export { x } from './b.js'` and `export * from
 * './b.js'` are edges — they emit an import of the module, so it is evaluated — which
 * means a **barrel cycle** (`a → barrel → a`) is detected. It was not before v0.48.0,
 * and that was the commonest cycle shape there is.
 *
 * Not counted, each for a reason: **dynamic `import()`** (lazy, so it cannot deadlock
 * initialization, and it is usually the deliberate *fix* for a cycle), **`require()`**
 * (CJS; this is an ESM-only package), and **type positions** like
 * `type X = import('./b.js').Y` (erased).
 *
 * Type-only imports and re-exports are dropped by default — see `ignoreTypeImports`
 * below, and note the default differs from `notDependOn`/`respectLayerOrder` on
 * purpose: a cycle asks whether the module is *evaluated*, those ask whether the code
 * is *coupled*.
 *
 * **This docstring said the opposite until v0.49.1.** It described the re-export
 * blindness as permanent, and it argued for its own importance on the ground that "this
 * docstring is read when the rule fails, and a changelog is read once" — then v0.48.0
 * updated the changelog and left this text standing, along with the same claim in two
 * shipped preset `because` strings that are **printed inside every finding**. Found by
 * review, not by the suite; nothing pins prose against behaviour.
 */
export function beFreeOfCycles(options?: ImportOptions): Condition<Slice> {
  // Resolved PER FIELD, once, and passed down as a complete object.
  //
  // This was a whole-object default — `options: ImportOptions = { ignoreTypeImports: true }`
  // — while the read downstream was `options?.ignoreTypeImports === true`. So ANY object
  // defeated it: `beFreeOfCycles({})` typechecks, because the field is optional, and
  // silently gave the pre-0.47 graph. Measured: `()` reported no cycle and `({})`
  // reported one, on a project whose only cross-slice edge was an `import type`.
  //
  // It gets worse with a second field, which is the point of a shared options bag:
  // `beFreeOfCycles({ someOtherOption: true })` would revert a documented default while
  // the caller's intent was unrelated. Bug 0057.
  const resolved: ImportOptions = { ignoreTypeImports: options?.ignoreTypeImports ?? true }
  return {
    description: 'be free of cycles',
    evaluate(slices: Slice[], context: ConditionContext): ArchViolation[] {
      const fileToSlice = buildFileToSliceMap(slices)
      // 'module-request': a cycle is a deadlock in module-initialization order, so
      // what matters is whether the target is EVALUATED, not whether the bindings are
      // type-level. Under `verbatimModuleSyntax`, `import { type X } from 's'` emits
      // `import {} from 's'` and can close a cycle (plan 0087).
      const graph = sliceGraph(slices, fileToSlice, resolved, 'module-request')
      const edges = graph.edges

      // Map slice names to indices for Tarjan's
      const sliceNames = slices.map((s) => s.name)
      const nameToIndex = new Map(sliceNames.map((name, i) => [name, i]))

      const adjacency: AdjacencyList = new Map()
      for (const edge of edges) {
        const fromIdx = nameToIndex.get(edge.from)
        const toIdx = nameToIndex.get(edge.to)
        if (fromIdx === undefined || toIdx === undefined) continue

        const existing = adjacency.get(fromIdx)
        if (existing) {
          existing.push(toIdx)
        } else {
          adjacency.set(fromIdx, [toIdx])
        }
      }

      const sccs = tarjanSCC(slices.length, adjacency)

      const violations: ArchViolation[] = []
      for (const scc of sccs) {
        // **SORTED, not rotated** — bug 0056. `tarjanSCC` returns MEMBERSHIP in DFS-pop
        // order, so the sequence is an artefact of traversal: reordering two imports moved
        // the element from `[a, c, b]` to `[a, b, c]`, which reddened CI on a cosmetic edit
        // and printed "it may be stale after a rename" about a rename that never happened.
        // `.excluding()` matches element/file/message, so sorting the ELEMENT is what fixes
        // that — `canonicalizeCycle`'s rotation could not, because both spellings were
        // already rotated to start at `a`.
        const members = [...new Set(scc.map((i) => sliceNames[i] ?? ''))].sort((a, b) =>
          a.localeCompare(b),
        )

        // **Locate the finding on an edge that EXISTS** — bug 0055. This used to ask for
        // details on `members[0] -> members[1]`, the first two members of a SET, which need
        // not be an edge at all: on a 4-ring it reported `unknown:0`, and when the pair
        // happened to be an edge the location was a perfectly legal import. Search the
        // component for a real edge instead.
        const inCycle = new Set(members)
        // SORTED, not `.find()`. `edges` is built by walking the file list, so taking the
        // first match made the example edge — and therefore the message — depend on
        // filesystem order: measured, a reversed walk turned "a imports b" into
        // "c imports a". Bug 0010's portability test caught it, which is the test that
        // exists because machine-dependent output gives one finding two identities.
        const realEdge = edges
          .filter((e) => inCycle.has(e.from) && inCycle.has(e.to))
          .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))[0]
        const details =
          realEdge === undefined
            ? []
            : // Through the graph, so the question and the options cannot diverge from the
              // ones it was built with. Passing 'type-bindings' here used to be writable,
              // and it turned this finding into "dynamically imports ... at line 1" —
              // pointing the reader at the construct that FIXES cycles.
              graph.detailsFor(realEdge.from, realEdge.to)
        // Same reason, one level down: `details` follows the slice's file order.
        const site = [...details].sort(
          (a, b) =>
            a.sourceFile.getFilePath().localeCompare(b.sourceFile.getFilePath()) ||
            a.importLine - b.importLine,
        )[0]

        // **A member list, not a path** — bug 0055's other half. The old message joined the
        // members with ` -> ` and appended the first again, presenting a SET as a traversal:
        // on a real ring `a→b→c→d→a` it printed `a -> d -> c -> b -> a`, every arrow
        // reversed, and on this repo's own source two of four arrows did not exist. Naming
        // the members and one real edge asserts only what can be substantiated.
        const closing =
          site === undefined
            ? ''
            : ` (e.g. ${realEdge?.from} ${edgeVerb(site.edge.kind)} ${realEdge?.to} at ${site.sourceFile.getBaseName()}:${site.importLine})`

        violations.push({
          rule: context.rule,
          element: `[${members.join(', ')}]`,
          file: site ? site.sourceFile.getFilePath() : 'unknown',
          line: site ? site.importLine : 0,
          // The sorted member SET, so the identity is a function of membership alone —
          // independent of traversal order (bug 0056) and of the message text, which is what
          // frees the message above to be rewritten at all (plan 0088).
          identity: `cycle::${members.join(',')}`,
          message: `Cycle detected between: ${members.join(', ')}${closing}`,
          because: context.because,
        })
      }

      return violations
    },
  }
}

/**
 * A dependency site's identity, following the scheme the dependency conditions already use.
 *
 * `basename::kind::specifier::sorted-names`, prefixed with the slice pair — and
 * **deliberately no line number**, which is the correction plan 0088's own sketch needed.
 * `ArchViolation.identity` exists precisely to survive "a coordinate — `at line 12` moves
 * when anything above it is edited", and `src/conditions/dependency.ts` omits the line for
 * that reason. Copying the scheme rather than inventing a second one is the point: these
 * two families report the same underlying edges.
 *
 * Why this distinguishes what a count could not: a barrel with thirty re-exports into one
 * forbidden slice previously produced thirty findings sharing ONE hash, because `element`
 * was the basename and the message named only the slice pair — so one baseline entry
 * accepted all thirty. Each edge carries different `names`, so each site is now its own
 * finding. (Measured before the fix: 3 sites, 3 lines, 1 hash.)
 */
function siteIdentity(from: string, to: string, site: SliceDependencySite): string {
  return [
    `${from}->${to}`,
    // The FULL PATH, not the basename — and this is a deliberate divergence from the
    // dependency family, whose scheme this otherwise copies.
    //
    // `getBaseName()` collides, measured: two sibling feature folders each with an
    // `index.ts` re-exporting the same name from the same specifier produce one identity
    // for two distinct violations — so one baseline entry accepts both. That is the very
    // defect plan 0088 was written to fix, in a different shape, and it is the commonest
    // layout there is. `src/conditions/dependency.ts` has the same collision
    // ([bug 0063](../../bugs/fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md)),
    // which is how it got here: the shape was right to copy, this component was not.
    //
    // An absolute path is safe here — `hashViolation` normalises the repository root out of
    // identity text (`src/core/identity-root.ts`), which is what makes a baseline portable
    // between a laptop and CI.
    site.sourceFile.getFilePath(),
    site.edge.kind,
    site.edge.specifier,
    // Names when the kind has them, the source-order ordinal when it does not — see
    // `edgeDiscriminator`. Before bug 0059 this family only ever saw `import` and
    // `reexport`, both of which carry names, so the gap was unreachable here.
    edgeDiscriminator(site.edge),
  ].join('::')
}

/**
 * Assert that slices respect a layered dependency order.
 *
 * **Which edges count:** every kind `notImportFrom()` and `onlyImportFrom()` count — plain
 * imports, re-exports, `import('…')` and `type X = import('…').Y` — because this is a
 * **coupling** question and a lazy import of a forbidden slice is still a forbidden
 * dependency. `require()` is not counted (ESM-only package, ADR-004). Contrast
 * `beFreeOfCycles`, which counts only the eager kinds because a cycle is a deadlock in
 * initialization order.
 *
 * Stated here rather than only in `docs/slices.md` because this docstring is what an IDE
 * and an agent read. The same omission stood from v0.48.0 to v0.49.1 and nothing pinned
 * prose against behaviour then either
 * ([bug 0059](../../bugs/fixed/0059-slice-conditions-and-module-conditions-disagree-about-a-dependency.md)).
 *
 * Given layers ['presentation', 'application', 'persistence', 'domain'],
 * layer N may depend on layers N+1, N+2, ... but NOT on layers N-1, N-2, ...
 * That is, dependencies must flow downward (toward higher indices) only.
 *
 * A layer not present in the slice set is silently skipped.
 *
 * @param layers - Ordered layer names, from highest (e.g., UI) to lowest (e.g., domain)
 *
 * @example
 * slices(project)
 *   .assignedFrom(layers)
 *   .should().respectLayerOrder('presentation', 'application', 'persistence', 'domain')
 *   .check()
 */
export function respectLayerOrder(layers: string[], options: ImportOptions): Condition<Slice>
export function respectLayerOrder(...layers: string[]): Condition<Slice>
export function respectLayerOrder(...args: [string[], ImportOptions] | string[]): Condition<Slice> {
  const { globs: layers, options } = splitGlobArgs(args)
  // `?? false` explicitly, not "undefined is falsy". Layering is a COUPLING question, so
  // type edges count by default — the opposite of `beFreeOfCycles`, and stated so a
  // future default change is a one-line edit rather than an audit (bug 0057).
  const resolved: ImportOptions = { ignoreTypeImports: options?.ignoreTypeImports ?? false }
  return {
    description: `respect layer order [${layers.join(' -> ')}]`,
    evaluate(slices: Slice[], context: ConditionContext): ArchViolation[] {
      const fileToSlice = buildFileToSliceMap(slices)
      // 'type-bindings': layering and isolation are about COUPLING, so
      // `ignoreTypeImports` here means what it means on `dependOn`/`notImportFrom` —
      // ignore type-level references. Deliberately NOT the cycle question (plan 0087).
      const graph = sliceGraph(slices, fileToSlice, resolved, 'type-bindings')
      const edges = graph.edges

      // Map layer names to their position (lower index = higher layer)
      const layerIndex = new Map(layers.map((name, i) => [name, i]))

      const violations: ArchViolation[] = []

      for (const edge of edges) {
        const fromIdx = layerIndex.get(edge.from)
        const toIdx = layerIndex.get(edge.to)

        // Skip edges involving non-layer slices
        if (fromIdx === undefined || toIdx === undefined) continue

        // Violation: depending on a higher layer (lower index)
        if (toIdx < fromIdx) {
          const details = graph.detailsFor(edge.from, edge.to)
          for (const detail of details) {
            violations.push({
              rule: context.rule,
              element: detail.sourceFile.getBaseName(),
              file: detail.sourceFile.getFilePath(),
              line: detail.importLine,
              identity: siteIdentity(edge.from, edge.to, detail),
              message: `Layer "${edge.from}" ${edgeVerb(detail.edge.kind)} higher layer "${edge.to}" (allowed: ${layers.slice(fromIdx + 1).join(', ') || 'none'})`,
              because: context.because,
            })
          }
        }
      }

      return violations
    },
  }
}

/**
 * Assert that no slice depends on any of the listed slices.
 *
 * **Which edges count:** every kind `notImportFrom()` and `onlyImportFrom()` count — plain
 * imports, re-exports, `import('…')` and `type X = import('…').Y` — because this is a
 * **coupling** question: a lazy import of a forbidden slice is still a forbidden dependency.
 * `require()` is not counted (ESM-only, ADR-004). Contrast `beFreeOfCycles`, which counts
 * only the eager kinds because a cycle is a deadlock in initialization order. Dynamic and
 * type-expression edges were invisible here until
 * [bug 0059](../../bugs/fixed/0059-slice-conditions-and-module-conditions-disagree-about-a-dependency.md);
 * this note exists because that docstring said nothing either way.
 *
 * Use for explicit isolation rules, e.g., "no slice may depend on legacy".
 *
 * @param forbiddenSlices - Names of slices that must not be depended upon
 *
 * @example
 * slices(project)
 *   .matching('src/features/*\/')
 *   .should().notDependOn('legacy', 'deprecated')
 *   .check()
 */
export function notDependOn(forbiddenSlices: string[], options: ImportOptions): Condition<Slice>
export function notDependOn(...forbiddenSlices: string[]): Condition<Slice>
export function notDependOn(...args: [string[], ImportOptions] | string[]): Condition<Slice> {
  const { globs: forbiddenSlices, options } = splitGlobArgs(args)
  // `?? false` — see `respectLayerOrder` above. Isolation is a coupling question.
  const resolved: ImportOptions = { ignoreTypeImports: options?.ignoreTypeImports ?? false }
  const forbiddenSet = new Set(forbiddenSlices)
  return {
    description: `not depend on [${forbiddenSlices.join(', ')}]`,
    evaluate(slices: Slice[], context: ConditionContext): ArchViolation[] {
      const fileToSlice = buildFileToSliceMap(slices)
      // 'type-bindings': layering and isolation are about COUPLING, so
      // `ignoreTypeImports` here means what it means on `dependOn`/`notImportFrom` —
      // ignore type-level references. Deliberately NOT the cycle question (plan 0087).
      const graph = sliceGraph(slices, fileToSlice, resolved, 'type-bindings')
      const edges = graph.edges

      const violations: ArchViolation[] = []

      for (const edge of edges) {
        if (forbiddenSet.has(edge.to)) {
          const details = graph.detailsFor(edge.from, edge.to)
          for (const detail of details) {
            violations.push({
              rule: context.rule,
              element: detail.sourceFile.getBaseName(),
              file: detail.sourceFile.getFilePath(),
              line: detail.importLine,
              identity: siteIdentity(edge.from, edge.to, detail),
              message: `Slice "${edge.from}" ${edgeVerb(detail.edge.kind)} forbidden slice "${edge.to}"`,
              because: context.because,
            })
          }
        }
      }

      return violations
    },
  }
}
