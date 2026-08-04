import type { SourceFile } from 'ts-morph'
import type { Slice } from '../models/slice.js'
import type { ImportOptions } from '../core/import-options.js'
import type { ModuleEdge, ModuleEdgeKind } from '../core/module-edges.js'
import { edgesOf } from '../core/module-edges.js'

/**
 * An edge in the slice dependency graph.
 * Represents: a file in `from` depends on a file in `to`.
 */
export interface SliceEdge {
  from: string
  to: string
}

/**
 * Build a reverse lookup map: file path -> slice name.
 * Shared by buildSliceDependencyGraph and findSliceDependencyDetails.
 */
export function buildFileToSliceMap(slices: Slice[]): Map<string, string> {
  const fileToSlice = new Map<string, string>()
  for (const slice of slices) {
    for (const file of slice.files) {
      fileToSlice.set(file.getFilePath(), slice.name)
    }
  }
  return fileToSlice
}

/**
 * The edge kinds a slice graph counts: the **eager static** ones.
 *
 * A slice graph answers "what does this slice depend on when the program starts",
 * which is what makes a cycle a cycle. Of `module-edges.ts`' five kinds, two qualify —
 * and each exclusion is a decision with a reason, not an omission:
 *
 * - `import` and `reexport` — **counted.** Both are eager: `export { x } from './b.js'`
 *   emits an import of `./b.js`, so that module is evaluated whether or not anything
 *   reads `x`. A barrel file is built out of re-exports, and `a → barrel → a` is the
 *   cycle real codebases actually have
 *   ([plan 0085](../../plans/0085-the-slice-graph-cannot-see-a-re-export.md)).
 * - `dynamic` — **not counted.** `import('./b.js')` is lazy, so it cannot deadlock
 *   module initialization, and it is most often the *deliberate* fix for a cycle.
 *   Reporting it as one would fail the rule for applying its own remedy.
 * - `require` — **not counted.** CJS, and this is an ESM-only package (ADR-004). Named
 *   here rather than left implicit, so the next reader knows it was considered. The
 *   surviving gap is `require` in an `allowJs` project: recorded, not fixed.
 * - `type-expression` — **not counted**, and excluded by *kind* rather than by
 *   `typeOnly`. `type X = import('./b.js').Y` is erased, so it must stay out even
 *   under `ignoreTypeImports: false` — filtering it on the flag alone would make that
 *   option add a class of edge this graph has never had.
 */
const EAGER_STATIC_KINDS: ReadonlySet<ModuleEdgeKind> = new Set<ModuleEdgeKind>([
  'import',
  'reexport',
])

/**
 * The edges leaving one file, as a slice graph counts them.
 *
 * Reads `edgesOf()` — the one definition of a module edge (plan 0071, from bug 0022,
 * where five sites collecting `getImportDeclarations()` disagreed with the reverse
 * graph about re-exports). The slice graph was the call site that never adopted it, so
 * `export { x } from './banned.js'` was a dependency to `notImportFrom` and invisible
 * to `beFreeOfCycles` **in the same run**. `edgesOf()` is cached per file and
 * invalidated on modification, so this also replaces a per-call resolution walk.
 *
 * `ignoreTypeImports` drops the erased edges. A type-only import or re-export creates
 * no runtime dependency, so counting it invents cycles that cannot exist at runtime —
 *
 * **with one measured exception, tracked by
 * [plan 0087](../../plans/0087-an-inline-type-import-still-requests-the-module.md).**
 * Under `verbatimModuleSyntax: true`, `import { type X } from 's'` emits
 * `import {} from 's'` — the specifiers are erased, the module request is not — so it
 * is an eager edge that this filter currently drops. `edgesOf` cannot express the
 * difference yet: `typeOnly` conflates "erased bindings" with "erased statement".
 *
 * [plan 0084](../../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md),
 * which is worth remembering for what it cost: this repo's own `arch/no-cycles` rule
 * sat at `.warn()` for months with a comment saying "switch to .check() when
 * beFreeOfCycles ignores import type", and while it could not fail it let a new cycle
 * in overnight.
 */
function sliceEdgesOf(file: SourceFile, options?: ImportOptions): readonly ModuleEdge[] {
  const ignoreTypeOnly = options?.ignoreTypeImports === true
  return edgesOf(file).filter(
    (edge) => EAGER_STATIC_KINDS.has(edge.kind) && !(ignoreTypeOnly && edge.typeOnly),
  )
}

/**
 * Collect unique slice edges from a single file's dependencies.
 */
function collectEdgesFromFile(
  file: SourceFile,
  sliceName: string,
  fileToSlice: Map<string, string>,
  edgeSet: Set<string>,
  edges: SliceEdge[],
  options?: ImportOptions,
): void {
  for (const edge of sliceEdgesOf(file, options)) {
    // A local `export { x }` with no `from` has no specifier, and a specifier the
    // compiler could not resolve points outside the program.
    if (edge.resolvedPath === undefined) continue

    const targetSlice = fileToSlice.get(edge.resolvedPath)
    if (targetSlice && targetSlice !== sliceName) {
      const edgeKey = `${sliceName}->${targetSlice}`
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey)
        edges.push({ from: sliceName, to: targetSlice })
      }
    }
  }
}

/**
 * Build a directed dependency graph between slices.
 *
 * For each file in each slice, resolve its dependencies. If the target file
 * belongs to a different slice, add a directed edge from the depending slice
 * to the depended-upon slice.
 *
 * @param slices - The resolved slices
 * @param fileToSlice - Pre-built file-to-slice map (optional, built internally if not provided)
 * @param options - `ignoreTypeImports` drops edges that are erased at compile time
 * @returns Unique directed edges between slices
 */
export function buildSliceDependencyGraph(
  slices: Slice[],
  fileToSlice?: Map<string, string>,
  options?: ImportOptions,
): SliceEdge[] {
  const map = fileToSlice ?? buildFileToSliceMap(slices)

  // Collect unique edges
  const edgeSet = new Set<string>()
  const edges: SliceEdge[] = []

  for (const slice of slices) {
    for (const file of slice.files) {
      collectEdgesFromFile(file, slice.name, map, edgeSet, edges, options)
    }
  }

  return edges
}

/**
 * Find which specific files cause a dependency from one slice to another.
 * Used for detailed violation messages.
 *
 * **`options` must be the options the graph was built with**, and that is not a style
 * preference. `respectLayerOrder` and `notDependOn` push one violation *per detail*,
 * so a graph that counts an edge this function cannot see finds the dependency and
 * reports **nothing** — a false green produced by two filters disagreeing rather than
 * by either one being absent. `beFreeOfCycles` fails differently and more quietly: it
 * still reports the cycle, at `unknown:0`, which is a finding whose remedy nobody can
 * act on.
 *
 * @param slices - The resolved slices
 * @param fromSliceName - Source slice name
 * @param toSliceName - Target slice name
 * @param fileToSlice - Pre-built file-to-slice map (optional, built internally if not provided)
 * @param options - Must match the options passed to `buildSliceDependencyGraph`
 * @returns Array of { sourceFile, importPath, importLine }
 */
export function findSliceDependencyDetails(
  slices: Slice[],
  fromSliceName: string,
  toSliceName: string,
  fileToSlice?: Map<string, string>,
  options?: ImportOptions,
): Array<{ sourceFile: SourceFile; importPath: string; importLine: number }> {
  const map = fileToSlice ?? buildFileToSliceMap(slices)

  const fromSlice = slices.find((s) => s.name === fromSliceName)
  if (!fromSlice) return []

  const details: Array<{ sourceFile: SourceFile; importPath: string; importLine: number }> = []
  for (const file of fromSlice.files) {
    for (const edge of sliceEdgesOf(file, options)) {
      if (edge.resolvedPath === undefined) continue

      if (map.get(edge.resolvedPath) === toSliceName) {
        details.push({
          sourceFile: file,
          importPath: edge.resolvedPath,
          importLine: edge.line,
        })
      }
    }
  }

  return details
}
