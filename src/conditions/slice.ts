import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { Slice } from '../models/slice.js'
import type { ImportOptions } from '../core/import-options.js'
import { splitGlobArgs } from '../core/import-options.js'
import type { SliceDependencySite } from '../helpers/slice-graph.js'
import { edgeDiscriminator, edgeVerb } from '../core/module-edges.js'
import { sliceGraph, buildFileToSliceMap } from '../helpers/slice-graph.js'
import { tarjanSCC, type AdjacencyList } from '../helpers/tarjan.js'
import { byCodepoint } from '../core/violation.js'

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
 *
 * **`identity`/`element` moved off the member set entirely — plan 0104.** One violation
 * per SCC (keyed by the sorted member set above) let `.excluding()` waive a whole tangled
 * component with one pattern, so a brand-new edge between two already-waived members was
 * silently absorbed — a second, doubly fail-open bug in the same family. Each internal
 * edge of the component now gets its own violation, `identity`, and `element`
 * (`cycle-edge::${from}->${to}`, `${from} -> ${to}`) — every such edge provably lies on
 * some cycle, because the component's own connectivity supplies a return path. The sorted
 * `members` set computed above still exists and is still load-bearing: it now serves the
 * MESSAGE's "part of a cycle with: ..." context only, not identity or element.
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
        // Unchanged by plan 0104: `members`/sorting now serves the MESSAGE only — identity
        // and element moved to the edge, below — but the order-independence this sort buys
        // still matters there too (`internalEdges` is itself sorted the same way).
        const members = [...new Set(scc.map((i) => sliceNames[i] ?? ''))].sort(byCodepoint)
        const inCycle = new Set(members)

        // **Every internal edge, not just one** — plan 0104. Provably meaningful, not a
        // heuristic: for a strongly connected component, any edge `u -> v` where both `u`
        // and `v` are members lies on SOME cycle, because the component's own connectivity
        // supplies a return path `v -> ... -> u`. So every edge this filter finds is a real,
        // substantiated cycle-membership fact — bug 0055 already established there is no
        // single, order-independent answer to "the" closing edge, so this reports the
        // provable superset instead of guessing at one. SORTED for the same portability
        // reason the old single-`realEdge` selection needed (bug 0010): `edges` is built by
        // walking the file list, so an unsorted iteration order would make which edge is
        // "first" — and therefore, before this plan, the only reported one — depend on
        // filesystem order.
        // INVARIANT (review: architect): every `scc` reaching this point has 2+
        // members (`tarjanSCC` only returns components of size > 1) and `adjacency`
        // is built from the same `edges` array this filter reads, so `internalEdges`
        // is never empty here — a size-2+ strongly connected component always has at
        // least one internal edge by construction. Not asserted at runtime: an empty
        // result would silently emit zero violations for a real cycle, so if this
        // invariant is ever wrong it fails open rather than throwing.
        const internalEdges = edges
          .filter((e) => inCycle.has(e.from) && inCycle.has(e.to))
          .sort((a, b) => byCodepoint(a.from, b.from) || byCodepoint(a.to, b.to))

        for (const edge of internalEdges) {
          // Through the graph, so the question and the options cannot diverge from the
          // ones it was built with. Passing 'type-bindings' here used to be writable, and
          // it turned this finding into "dynamically imports ... at line 1" — pointing the
          // reader at the construct that FIXES cycles. Called once per edge rather than
          // once per SCC: each call walks `fromSlice.files`, which is cheap — the AST work
          // underneath is cached per file by `edgesOf` (module-edges.ts) regardless of call
          // count (Out of scope: performance, reasoned not benchmarked).
          const details = graph.detailsFor(edge.from, edge.to)
          // Same reason as the old single-edge lookup, one level down: `details` follows
          // the slice's file order, and each edge computes its OWN site — never a hoisted
          // one shared across edges in the same SCC, which would silently reintroduce a
          // shared-location regression this plan's own test inventory guards against.
          const site = [...details].sort(
            (a, b) =>
              byCodepoint(a.sourceFile.getFilePath(), b.sourceFile.getFilePath()) ||
              a.importLine - b.importLine,
          )[0]

          violations.push({
            rule: context.rule,
            // The edge ITSELF, not the component — plan 0104. `.excluding('helpers -> builders')`
            // now names exactly this fact and nothing else in the component. Deliberately
            // NOT decorated with the member list: folding membership in here would move
            // every edge's element whenever the component's shape changes, even for edges
            // that did not themselves change — see plan 0104's "Why per-edge" for the case
            // analysis this avoids.
            element: `${edge.from} -> ${edge.to}`,
            file: site ? site.sourceFile.getFilePath() : 'unknown',
            line: site ? site.importLine : 0,
            // A pure function of the two slice names — no path, no line, no message text.
            // Distinct prefix from the old `cycle::` scheme (bug 0056) so an old-format
            // baseline entry cannot accidentally collide with a new-format one — see
            // `HASH_VERSION`'s bump in `src/helpers/baseline.ts`.
            identity: `cycle-edge::${edge.from}->${edge.to}`,
            // "Cycle detected" stays the leading words —
            // tests/presets/cycle-claims-match-behaviour.test.ts filters on
            // `message.startsWith('Cycle detected')` and must keep matching. The named
            // edge is a real, substantiated fact for THIS finding (not an "e.g." example of
            // the component, as the pre-plan-0104 message had it) — every edge pushed here
            // provably closes some cycle, per the proof above.
            message: site
              ? `Cycle detected: "${edge.from}" ${edgeVerb(site.edge.kind)} "${edge.to}" at ` +
                `${site.sourceFile.getBaseName()}:${String(site.importLine)}, part of a cycle with: ` +
                `${members.join(', ')}`
              : // Unreachable given `graph`'s options/question binding — kept for the same
                // defensive reason the pre-plan-0104 code kept its own `'unknown'`/`0`
                // fallback.
                `Cycle detected: "${edge.from}" depends on "${edge.to}", part of a cycle with: ` +
                `${members.join(', ')} (location unknown)`,
            because: context.because,
          })
        }
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
    // Names when the edge carries them, the source-order ordinal when it does not — see
    // `edgeDiscriminator`.
    //
    // This comment used to say the gap was unreachable here, on the reasoning that before
    // bug 0059 the family only saw `import` and `reexport`, "both of which carry names".
    // That was false: it is the SPELLING that carries names, not the kind. Measured on
    // `main` through `notDependOn`, two default imports of one module from one file gave
    // two findings and ONE identity, as did two bare side-effect imports. The collision
    // was live in this family, not merely reachable — which is why the fix is in
    // `edgeDiscriminator` where both families read it, rather than in either caller.
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
