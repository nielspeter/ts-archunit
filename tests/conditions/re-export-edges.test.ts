/**
 * The slice graph and `export … from` —
 * [plan 0085](../../plans/0085-the-slice-graph-cannot-see-a-re-export.md).
 *
 * `collectEdgesFromFile` read `getImportDeclarations()` and nothing else, so a
 * **value** re-export — a real runtime dependency, emitted as an import — was not an
 * edge on any of `beFreeOfCycles`, `respectLayerOrder` or `notDependOn`.
 *
 * The shape that misses is the classic one: a barrel file is built out of
 * `export … from`, and `a → barrel → a` is the cycle most codebases actually have.
 * `src/core/module-edges.ts` has defined edges *including* re-exports since plan 0071
 * — bug 0022's fix — and the slice graph was the call site that never adopted it. So
 * one run could report a barrel re-export as a cross-boundary violation and the cycle
 * it creates as absent.
 *
 * Deferred deliberately by plan 0071 while `arch/no-cycles` sat at `.warn()`; plan
 * 0084 turned that rule on, which is what made the false negative worth paying for.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { ImportOptions } from '../../src/core/import-options.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { hashViolation } from '../../src/helpers/baseline.js'

/** Two slices, `a/` and `b/`, carrying the edge spellings under test. */
function twoSlices(aToB: string, bToA: string): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  tsm.createSourceFile(
    '/src/a/index.ts',
    `${aToB}\nexport type Alpha = { n: number }\nexport const alpha = 1\n`,
  )
  tsm.createSourceFile(
    '/src/b/index.ts',
    `${bToA}\nexport type Beta = { n: number }\nexport const beta = 1\n`,
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const built = (p: ArchProject) => slices(p).assignedFrom({ a: '**/src/a/**', b: '**/src/b/**' })

const real = (vs: ArchViolation[]): ArchViolation[] => vs.filter((v) => v.bypassFilters !== true)

const cycles = (p: ArchProject, options?: ImportOptions): string[] =>
  real(built(p).should().beFreeOfCycles(options).violations()).map((v) => v.element)

const TYPE_RE_B = "export type { Beta } from '../b/index.js'"
const TYPE_RE_A = "export type { Alpha } from '../a/index.js'"
const VALUE_RE_B = "export { beta } from '../b/index.js'"
const VALUE_RE_A = "export { alpha } from '../a/index.js'"
const VALUE_IMPORT_A = "import { alpha } from '../a/index.js'"
const STAR_RE_B = "export * from '../b/index.js'"
const STAR_RE_A = "export * from '../a/index.js'"

describe('the slice graph sees re-export edges (plan 0085)', () => {
  it('a value re-export is an edge — the barrel case', () => {
    // `a` re-exports from `b`, `b` imports `a`. Both directions exist at runtime, so
    // this is a cycle. It reported NOTHING before this plan, and that is the whole
    // defect: the emitted JavaScript for `export { beta } from '../b/index.js'`
    // imports the module.
    expect(cycles(twoSlices(VALUE_RE_B, VALUE_IMPORT_A))).toEqual(['[a, b]'])
  })

  it('two value re-exports are a cycle — barrel to barrel', () => {
    expect(cycles(twoSlices(VALUE_RE_B, VALUE_RE_A))).toEqual(['[a, b]'])
  })

  it('`export * from` is an edge', () => {
    // A separate row rather than a variant of the one above: `getNamedExports()` is
    // EMPTY for a star re-export, so `isTypeOnlyReExport`'s
    // `specifiers.length > 0 && every(...)` guard is what keeps it from being
    // classified as erased. Drop that length check and this row still passes while
    // `export type * from` breaks — which is why both are tested.
    expect(cycles(twoSlices(STAR_RE_B, STAR_RE_A))).toEqual(['[a, b]'])
  })

  it('a type-only re-export is NOT an edge by default, and IS with the option off', () => {
    // The option proven in both positions on the RE-EXPORT path specifically. Every
    // other row here would pass with `isTypeOnlyReExport` never consulted.
    expect(cycles(twoSlices(TYPE_RE_B, TYPE_RE_A))).toEqual([])
    expect(cycles(twoSlices(TYPE_RE_B, TYPE_RE_A), { ignoreTypeImports: false })).toEqual([
      '[a, b]',
    ])
  })

  it('a MIXED re-export pair: value one way, type the other, is not a cycle', () => {
    // Same reasoning as the import case in `type-only-cycles.test.ts`: with one
    // direction erased there is no cycle, because a cycle needs both directions.
    expect(cycles(twoSlices(VALUE_RE_B, TYPE_RE_A))).toEqual([])
  })

  it('a bare `export { x }` with no `from` is not an edge, and does not throw', () => {
    // No module specifier, so nothing to resolve. The row exists because the obvious
    // implementation calls `getModuleSpecifierSourceFile()` on every export
    // declaration, and a local export is the commonest declaration in any file.
    const p = twoSlices('export const localOnly = 1', VALUE_IMPORT_A)
    expect(cycles(p)).toEqual([])
  })

  it('a re-export to a file OUTSIDE any slice is not an edge', () => {
    // The resolved file belongs to no slice, so there is nothing to draw an edge to.
    // Guards the `targetSlice &&` branch on the new path, not just the import path.
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile('/src/outside/index.ts', 'export const outside = 1\n')
    tsm.createSourceFile('/src/a/index.ts', "export { outside } from '../outside/index.js'\n")
    tsm.createSourceFile('/src/b/index.ts', 'export const beta = 1\n')
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
    expect(cycles(p)).toEqual([])
  })
})

describe('notDependOn and respectLayerOrder see re-export edges too (plan 0085)', () => {
  /** `ui → data` by the given spelling, and nothing else. */
  function twoLayers(uiToData: string): ArchProject {
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile('/src/data/index.ts', 'export const row = 1\n')
    tsm.createSourceFile('/src/ui/index.ts', `${uiToData}\n`)
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
  }

  const layers = (p: ArchProject) =>
    slices(p).assignedFrom({ data: '**/src/data/**', ui: '**/src/ui/**' })

  it('notDependOn reports a dependency that exists ONLY as a re-export', () => {
    // THE row that proves `findSliceDependencyDetails` was fixed and not just the
    // graph. `notDependOn` pushes one violation PER DETAIL, so a fixed graph with an
    // unfixed detail lookup finds the edge, resolves zero details, and reports
    // nothing — a false green introduced BY this fix. Asserted by identity.
    const violations = real(
      layers(twoLayers("export { row } from '../data/index.js'"))
        .should()
        .notDependOn('data')
        .violations(),
    )
    expect(violations.map((v) => v.element)).toEqual(['index.ts'])
  })

  it('respectLayerOrder reports an upward dependency that exists only as a re-export', () => {
    // `data` is listed after `ui`, so `data → ui` is upward and forbidden. Same
    // details-path argument as above, through the other condition.
    const violations = real(
      slices(twoLayersReversed())
        .assignedFrom({ ui: '**/src/ui/**', data: '**/src/data/**' })
        .should()
        .respectLayerOrder('ui', 'data')
        .violations(),
    )
    expect(violations.map((v) => v.element)).toEqual(['index.ts'])
  })

  /** `data → ui`, upward, by re-export only. */
  function twoLayersReversed(): ArchProject {
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile('/src/ui/index.ts', 'export const widget = 1\n')
    tsm.createSourceFile('/src/data/index.ts', "export { widget } from '../ui/index.js'\n")
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
  }

  it('notDependOn COUNTS a type-only edge by default — deliberately unlike cycles', () => {
    // Not an inconsistency, and the reason belongs next to the assertion: cycles are
    // about runtime module-initialization order, so an erased edge cannot contribute.
    // Layering and isolation are about COUPLING — a type-only dependency on a layer
    // is still a dependency on it, and still breaks when that layer is deleted.
    //
    // So `beFreeOfCycles` defaults to ignoring type edges and this one defaults to
    // counting them, matching `dependOn`/`notImportFrom` as shipped since v0.28.0.
    const p = twoLayers("import type { row } from '../data/index.js'")
    expect(real(layers(p).should().notDependOn('data').violations()).map((v) => v.element)).toEqual(
      ['index.ts'],
    )

    // And the option is honoured when a caller disagrees.
    expect(
      real(layers(p).should().notDependOn(['data'], { ignoreTypeImports: true }).violations()),
    ).toEqual([])
  })

  it('respectLayerOrder takes the option too', () => {
    const p = twoLayersReversed()
    // Two spellings deliberately, because they are two overloads: the variadic form
    // takes no options, and `(layers[], options)` takes them. Passing `undefined` as
    // the second argument is a type error by design — the same shape `dependOn` has
    // shipped since v0.28.0, matched rather than reinvented.
    const run = (options?: ImportOptions): string[] => {
      const b = slices(p).assignedFrom({ ui: '**/src/ui/**', data: '**/src/data/**' })
      const asserted =
        options === undefined
          ? b.should().respectLayerOrder('ui', 'data')
          : b.should().respectLayerOrder(['ui', 'data'], options)
      return real(asserted.violations()).map((v) => v.element)
    }

    expect(run()).toEqual(['index.ts'])
    expect(run({ ignoreTypeImports: true })).toEqual(['index.ts']) // value re-export, still an edge
  })
})

describe('what the new edges do to identity and to vacuity (plan 0085)', () => {
  it('MIGRATION: a re-export joining a slice to a cycle changes the cycle identity', () => {
    // Adopters have baselines. A cycle's identity is its MEMBER LIST, so a third
    // slice joined by a re-export makes the same cycle a different violation — the
    // entry stops matching rather than moving, and the wider cycle reads as new.
    // Asserted through the real `hashViolation`, which is what a baseline stores.
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile(
      '/src/a/index.ts',
      "import { beta } from '../b/index.js'\nexport const alpha = 1\n",
    )
    tsm.createSourceFile(
      '/src/b/index.ts',
      "import { alpha } from '../a/index.js'\nexport { gamma } from '../c/index.js'\nexport const beta = 1\n",
    )
    tsm.createSourceFile(
      '/src/c/index.ts',
      "import { alpha } from '../a/index.js'\nexport const gamma = 1\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const found = real(
      slices(p)
        .assignedFrom({ a: '**/src/a/**', b: '**/src/b/**', c: '**/src/c/**' })
        .should()
        .beFreeOfCycles()
        .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
        .violations(),
    )

    // `b → c` is the re-export; `c → a` and `a → b` are imports. All three are in one
    // SCC only because the re-export is now an edge.
    // `[a, c, b]`: `canonicalizeCycle` rotates the SCC so the lexicographically
    // smallest member leads, and does not sort. Measured — and it matters precisely
    // here, because that string is the baseline identity being compared below.
    expect(found.map((v) => v.element)).toEqual(['[a, c, b]'])

    // Which is a different identity from the two-slice cycle the same source reported
    // before this plan — stated as a hash comparison rather than as prose.
    const narrower: ArchViolation = {
      ...found[0]!,
      element: '[a, b]',
      message: 'Cycle detected: a -> b -> a',
    }
    expect(hashViolation(found[0]!)).not.toBe(hashViolation(narrower))
  })

  it('a re-export-only cycle is reported at a real file and line, not unknown:0', () => {
    // `beFreeOfCycles` locates its finding through `findSliceDependencyDetails`, so
    // before the details fix a re-export-only cycle would report at `unknown:0`. The
    // remedy is unusable without a location, which is why this is asserted and not
    // assumed from the row above passing.
    const found = real(
      built(twoSlices(VALUE_RE_B, VALUE_RE_A))
        .should()
        .beFreeOfCycles()
        .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
        .violations(),
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.file).toMatch(/src\/a\/index\.ts$/)
    expect(found[0]!.line).toBe(1)
  })

  it('VACUITY: the fixtures really resolve two slices with files in each', () => {
    // Every row above turns on an empty-or-not list, so a fixture that resolved no
    // files would make half of them true for the wrong reason.
    const violations = built(twoSlices(VALUE_RE_B, VALUE_RE_A))
      .should()
      .beFreeOfCycles()
      .violations()
    expect(violations.filter((v) => v.bypassFilters === true)).toEqual([])
  })
})
