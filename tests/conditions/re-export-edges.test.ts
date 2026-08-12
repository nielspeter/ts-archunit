/**
 * The slice graph and `export … from` —
 * [plan 0085](../../plans/completed/0085-the-slice-graph-cannot-see-a-re-export.md).
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
import { Project, ts } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { ImportOptions } from '../../src/core/import-options.js'
import fs from 'node:fs'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { project } from '../../src/core/project.js'
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
    expect(cycles(twoSlices(VALUE_RE_B, VALUE_IMPORT_A))).toEqual(['a -> b', 'b -> a'])
  })

  it('two value re-exports are a cycle — barrel to barrel', () => {
    expect(cycles(twoSlices(VALUE_RE_B, VALUE_RE_A))).toEqual(['a -> b', 'b -> a'])
  })

  it('`export * from` is an edge', () => {
    // A separate row rather than a variant of the one above: `getNamedExports()` is
    // EMPTY for a star re-export, so `isTypeOnlyReExport`'s
    // `specifiers.length > 0 && every(...)` guard is what keeps it from being
    // classified as erased. Drop that length check and this row still passes while
    // `export type * from` breaks — which is why both are tested.
    expect(cycles(twoSlices(STAR_RE_B, STAR_RE_A))).toEqual(['a -> b', 'b -> a'])
  })

  it('a type-only re-export is NOT an edge by default, and IS with the option off', () => {
    // The option proven in both positions on the RE-EXPORT path specifically. Every
    // other row here would pass with `isTypeOnlyReExport` never consulted.
    expect(cycles(twoSlices(TYPE_RE_B, TYPE_RE_A))).toEqual([])
    expect(cycles(twoSlices(TYPE_RE_B, TYPE_RE_A), { ignoreTypeImports: false })).toEqual([
      'a -> b',
      'b -> a',
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

describe('which edge KINDS the slice graph counts (plan 0085)', () => {
  // Four kinds are decided in `EAGER_STATIC_KINDS`, and sabotage found each decision
  // was argued only in a docstring: adding `dynamic` or `type-expression` to that set
  // left all 3025 tests green. A decision nothing disagrees with is not guarded
  // (ADR-008 rule 5), and "it says so in a comment" is not disagreement.

  it('a DYNAMIC import is not an edge, even with ignoreTypeImports off', () => {
    // `import('./a.js')` is lazy: it cannot deadlock module initialization, and it is
    // most often the *deliberate* remedy for a cycle. Reporting it as a cycle would
    // fail the rule for applying its own advice.
    //
    // Asserted under BOTH option positions, because `dynamic` edges are not typeOnly —
    // so if they were counted, no type-only filter would hide them.
    const p = twoSlices(
      "import { beta } from '../b/index.js'",
      "export const lazy = () => import('../a/index.js')",
    )
    expect(cycles(p)).toEqual([])
    expect(cycles(p, { ignoreTypeImports: false })).toEqual([])
  })

  it('a TYPE-EXPRESSION import is not an edge, and is excluded by KIND', () => {
    // `type X = import('../a/index.js').Alpha` is erased. It is excluded by kind rather
    // than by its `typeOnly` flag on purpose: filtering it on the flag alone would let
    // `ignoreTypeImports: false` add a class of edge this graph has never had, turning
    // that option from "count erased imports" into "count type positions too".
    //
    // Which is exactly what the second assertion pins. The first would pass either way.
    const p = twoSlices(
      "import { beta } from '../b/index.js'",
      "export type Ref = import('../a/index.js').Alpha",
    )
    expect(cycles(p)).toEqual([])
    expect(cycles(p, { ignoreTypeImports: false })).toEqual([])
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

  it('respectLayerOrder counts a value re-export under EITHER option value', () => {
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

    // Both positions give the same answer, and that is the CLAIM: a value re-export is
    // not erased, so no option value can hide it. This row does NOT prove the option is
    // forwarded — it once pretended to, and sabotage caught it: dropping the forwarding
    // left it green. The forwarding is proven where the option changes the answer, in
    // "respectLayerOrder honours the option" below.
    expect(run()).toEqual(['index.ts'])
    expect(run({ ignoreTypeImports: true })).toEqual(['index.ts'])
  })
})

describe('the graph and the details lookup must agree (plan 0085)', () => {
  it('a type-only site is not reported when the graph was told to ignore type edges', () => {
    // `findSliceDependencyDetails` must be given the SAME options as the graph, and
    // sabotage showed that dropping them was caught by nothing — because an unfiltered
    // details lookup is a SUPERSET, so a cycle is still located and nothing looks wrong.
    //
    // It becomes visible only where the extra details become extra VIOLATIONS: the
    // layering conditions push one per detail. Here `ui` reaches `data` twice, once by
    // value and once by `import type`. Under `ignoreTypeImports: true` the graph sees
    // one edge, and exactly one site may be reported — the value one, on line 1.
    // With the options dropped, the erased import is reported as a second site: a
    // finding whose remedy is "remove this dependency" pointed at a line that has no
    // runtime dependency to remove.
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile(
      '/src/data/index.ts',
      'export const row = 1\nexport type Row = { n: number }\n',
    )
    tsm.createSourceFile(
      '/src/ui/index.ts',
      "import { row } from '../data/index.js'\nimport type { Row } from '../data/index.js'\nexport const use = row\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const violations = real(
      slices(p)
        .assignedFrom({ data: '**/src/data/**', ui: '**/src/ui/**' })
        .should()
        .notDependOn(['data'], { ignoreTypeImports: true })
        .violations(),
    )
    expect(violations.map((v) => v.line)).toEqual([1])
  })

  it('a cycle is LOCATED at a runtime edge, never at an erased one', () => {
    // The `beFreeOfCycles` half of the same disagreement, and it hides differently:
    // this condition reports the cycle regardless, so an unfiltered details lookup does
    // not change WHETHER it fires — only WHERE it points. `firstDetail` is the location,
    // so the finding would send the reader to an `import type` line and tell them to
    // break a dependency that is already erased.
    //
    // `a` reaches `b` twice, type-only on line 1 and by value on line 2. The cycle must
    // be reported at line 2.
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile(
      '/src/a/index.ts',
      "import type { Beta } from '../b/index.js'\nimport { beta } from '../b/index.js'\nexport type Alpha = { n: number }\nexport const alpha: number = beta\n",
    )
    tsm.createSourceFile(
      '/src/b/index.ts',
      "import { alpha } from '../a/index.js'\nexport type Beta = { n: number }\nexport const beta = alpha\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const found = real(
      slices(p)
        .assignedFrom({ a: '**/src/a/**', b: '**/src/b/**' })
        .should()
        .beFreeOfCycles()
        .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
        .violations(),
    )
    expect(found.map((v) => v.element)).toEqual(['a -> b', 'b -> a'])
    // The a -> b edge is real only via the value import on line 2, not the type-only
    // one on line 1.
    expect(found[0]!.line).toBe(2)
    // b -> a's own site is unaffected by a's erased import — still line 1.
    expect(found[1]!.line).toBe(1)
  })

  it('respectLayerOrder asks the COUPLING question, not the cycle question', () => {
    // **The guard that did not exist.** Plan 0087 has ONE sabotage row for two
    // conditions — "notDependOn/respectLayerOrder ask the cycle question" — and it
    // scored CAUGHT with all four call sites patched. The only test that fired calls
    // `notDependOn`. Measured: flipping BOTH of `respectLayerOrder`'s question sites to
    // 'module-request' leaves all 3055 tests passing.
    //
    // The methodological lesson is bigger than the gap: `notDependOn` and
    // `respectLayerOrder` received textually identical changes, so the DIFF presented
    // them as one thing and the natural revert row bundled them. Enumerating reverts
    // from the diff does not protect you here — the diff is what suggested the bundle.
    // **When a revert row names two call sites, split it into two rows.**
    //
    // The failure this prevents: under `verbatimModuleSyntax`, `import { type Widget }`
    // does not erase its module request, so the cycle question keeps the edge. Asking
    // that question here reports an upward dependency whose BINDINGS are erased —
    // telling the reader to remove a coupling that does not exist.
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { verbatimModuleSyntax: true, module: ts.ModuleKind.ESNext },
    })
    tsm.createSourceFile('/src/ui/index.ts', 'export type Widget = { n: number }\n')
    tsm.createSourceFile(
      '/src/data/index.ts',
      "import { type Widget } from '../ui/index.js'\nexport const row: Widget = { n: 1 }\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    // `data → ui` is upward and forbidden. The bindings are type-level, so a caller
    // asking to ignore type imports must get nothing — whatever the emit does.
    const violations = real(
      slices(p)
        .assignedFrom({ ui: '**/src/ui/**', data: '**/src/data/**' })
        .should()
        .respectLayerOrder(['ui', 'data'], { ignoreTypeImports: true })
        .violations(),
    )
    expect(violations.map((v) => v.element)).toEqual([])

    // And the pairing: counting type edges, it IS a coupling and IS reported.
    const counted = real(
      slices(p)
        .assignedFrom({ ui: '**/src/ui/**', data: '**/src/data/**' })
        .should()
        .respectLayerOrder('ui', 'data')
        .violations(),
    )
    expect(counted.map((v) => v.element)).toEqual(['index.ts'])
  })

  it('respectLayerOrder passes its options to the details lookup too', () => {
    // C2, the mirror of the `notDependOn` row above — which was CAUGHT while this was
    // MISSED. Same defect the `findSliceDependencyDetails` docstring warns about in
    // bold, in the sibling that got the code and not the guard.
    //
    // `data → ui` twice: by value on line 1, type-only on line 2. Under
    // `ignoreTypeImports: true` the graph sees one edge, so exactly one site may be
    // reported — the value one. An unfiltered details lookup reports both, and the
    // second points at an `import type` line with "remove this dependency".
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { module: ts.ModuleKind.ESNext },
    })
    tsm.createSourceFile(
      '/src/ui/index.ts',
      'export const widget = 1\nexport type Widget = { n: number }\n',
    )
    tsm.createSourceFile(
      '/src/data/index.ts',
      "import { widget } from '../ui/index.js'\nimport type { Widget } from '../ui/index.js'\nexport const row: Widget = { n: widget }\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const violations = real(
      slices(p)
        .assignedFrom({ ui: '**/src/ui/**', data: '**/src/data/**' })
        .should()
        .respectLayerOrder(['ui', 'data'], { ignoreTypeImports: true })
        .violations(),
    )
    expect(violations.map((v) => v.line)).toEqual([1])
  })

  it('the DETAILS question alone is observable, given a value edge to find the pair', () => {
    // Splitting the bundled revert (see the row above) showed my own fix reproducing the
    // shape it fixed: both halves together are caught, neither half alone is. Working out
    // why is the useful part.
    //
    // `respectLayerOrder` pushes one violation PER DETAIL, and details are only fetched
    // for a pair the GRAPH found. So the output is an intersection:
    //
    //  - graph too permissive  -> edge found, correct details drop it, 0 violations.
    //    Identical to the correct answer. **Structurally unobservable**, not unguarded —
    //    the same category as an unreachable branch, and it should be recorded as an
    //    equivalence rather than chased.
    //  - details too permissive -> only reachable if the graph found the pair ANYWAY,
    //    which needs a second, non-erased edge between the same slices. Then the wrong
    //    question returns an EXTRA site. **Observable**, and this row is that fixture.
    //
    // `data → ui` twice under `verbatimModuleSyntax: true`: a value import on line 1
    // (found by either question) and `import { type Widget }` on line 2, which is
    // typeOnly but does NOT erase its module request. Under `ignoreTypeImports: true`
    // exactly one site may be reported.
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { verbatimModuleSyntax: true, module: ts.ModuleKind.ESNext },
    })
    tsm.createSourceFile(
      '/src/ui/index.ts',
      'export const widget = 1\nexport type Widget = { n: number }\n',
    )
    tsm.createSourceFile(
      '/src/data/index.ts',
      "import { widget } from '../ui/index.js'\nimport { type Widget } from '../ui/index.js'\nexport const row: Widget = { n: widget }\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const violations = real(
      slices(p)
        .assignedFrom({ ui: '**/src/ui/**', data: '**/src/data/**' })
        .should()
        .respectLayerOrder(['ui', 'data'], { ignoreTypeImports: true })
        .violations(),
    )
    // Line 1 only. With the details question flipped, line 2 is reported too — a finding
    // telling the reader to remove an upward dependency whose bindings are type-level.
    expect(violations.map((v) => v.line)).toEqual([1])
  })

  it('respectLayerOrder honours the option, proven where it CHANGES the answer', () => {
    // The other forwarding gap, and the reason it hid: the original row asserted the
    // same expectation for both option positions, so it could not tell whether the
    // option arrived. A row that passes under every value of the thing it tests is
    // testing nothing.
    //
    // Here the only upward edge is type-only, so the option flips the answer.
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile('/src/ui/index.ts', 'export type Widget = { n: number }\n')
    tsm.createSourceFile(
      '/src/data/index.ts',
      "import type { Widget } from '../ui/index.js'\nexport const row: Widget = { n: 1 }\n",
    )
    const p: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
    const run = (options?: ImportOptions): string[] => {
      const b = slices(p).assignedFrom({ ui: '**/src/ui/**', data: '**/src/data/**' })
      const asserted =
        options === undefined
          ? b.should().respectLayerOrder('ui', 'data')
          : b.should().respectLayerOrder(['ui', 'data'], options)
      return real(asserted.violations()).map((v) => v.element)
    }

    expect(run()).toEqual(['index.ts']) // default: coupling counts, even erased
    expect(run({ ignoreTypeImports: true })).toEqual([]) // and the caller may disagree
  })
})

describe('ON DISK: our own barrel, through a real tsconfig (plan 0085)', () => {
  // The end-to-end row, and it exists because inventory row 8 turned out to be
  // VACUOUS FOR US. Row 8 said "our own suite is the end-to-end proof and may well
  // surface new cycles in src/" — it surfaced none, and the reason is not that the
  // fix is inert: our three in-slice re-exports are all intra-slice (core→core,
  // predicates→predicates), and the graph skips same-slice edges by design. So
  // `arch/no-cycles` staying green says nothing about the new path either way.
  //
  // `src/index.ts` is the one place it can be proved on real files: **90 re-exports
  // and zero plain imports**, so before this plan it had no edges AT ALL and no slice
  // rule could see it. It also sits in none of `arch-rules.test.ts`' slices, which is
  // why turning the rule on in plan 0084 could not have caught this.
  it('the root barrel has re-export edges into the folders it re-exports', () => {
    const p = project('tsconfig.json')
    const built = slices(p).assignedFrom({
      barrel: '**/src/index.ts',
      core: '**/src/core/**',
      helpers: '**/src/helpers/**',
    })

    // `notDependOn` rather than reading the graph helper directly: the point is that a
    // user's rule now sees this, not that an internal function returns a tuple.
    const violations = real(built.should().notDependOn('core', 'helpers').violations())

    // `notDependOn` reports one violation PER SITE, not per edge — pre-existing
    // behaviour, and each site is separately actionable, so it is the right shape.
    // The volume simply grows now that re-export sites count: this barrel produces
    // dozens. So assert IDENTITIES (ADR-008 rule 4) and never the total, which would
    // change every time someone adds an export to the barrel.
    // All three, including one that has nothing to do with re-exports: `notDependOn`
    // is a rule over EVERY slice, not only the interesting one, so `helpers → core`
    // (an ordinary import, and a legitimate direction) is reported as well. Asserted
    // rather than filtered away, because that scope is easy to misread when writing a
    // real rule and it is the kind of thing this row should teach.
    // The message now names the edge KIND — `re-exports` rather than the generic
    // `depends on` — which plan 0088 freed by giving these findings their own `identity`.
    // Until then the message text WAS the baseline hash, so improving it invalidated every
    // entry; `edgeVerb()` had returned 're-exports' since v0.28.0 with no slice condition
    // able to use it.
    expect([...new Set(violations.map((v) => v.message))].sort()).toEqual([
      'Slice "barrel" re-exports forbidden slice "core"',
      'Slice "barrel" re-exports forbidden slice "helpers"',
      'Slice "helpers" imports forbidden slice "core"',
    ])

    const fromBarrel = violations.filter((v) => v.message.startsWith('Slice "barrel"'))
    expect([...new Set(fromBarrel.map((v) => v.element))]).toEqual(['index.ts'])

    // One finding per distinct site, each carrying a usable location. Before this plan
    // there were zero of these, so `toBeGreaterThan(1)` is the claim that matters and
    // the exact number is deliberately not pinned.
    const lines = fromBarrel.map((v) => v.line)
    expect(new Set(lines).size).toBe(lines.length)
    expect(lines.every((l) => l > 0)).toBe(true)
  })

  it('and every one of those edges is a re-export, not an import', () => {
    // The control for the row above: if `src/index.ts` ever grows a plain `import`,
    // that row would pass through the OLD code path and stop proving anything. Read
    // off the file rather than assumed, because that is the assumption that rots.
    const source = fs.readFileSync('src/index.ts', 'utf-8')
    expect(source.match(/^import /gm)).toBeNull()
    expect((source.match(/^export .*from '/gm) ?? []).length).toBeGreaterThan(50)
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
    // SCC only because the re-export is now an edge — and under plan 0104 that SCC
    // reports one violation PER INTERNAL EDGE, not one for the whole component: all
    // four edges (`a → b`, `b → a`, `b → c`, `c → a`) provably lie on some cycle.
    expect(found.map((v) => v.element)).toEqual(['a -> b', 'b -> a', 'b -> c', 'c -> a'])

    // A different edge is a different finding — proven through `identity`, not
    // `element`/`message`.
    //
    // This row used to compare against a HAND-BUILT `identity: 'cycle::a,b'` (the old
    // whole-component scheme). Under plan 0104's `cycle-edge::` prefix that comparison
    // would be vacuous — the two sides would differ trivially by PREFIX alone, proving
    // nothing about edge-sensitivity. Compare against a same-prefix, different-EDGE
    // identity instead, so the assertion still proves what it claims: `hashViolation`
    // is sensitive to which edge `identity` names, not merely to its prefix.
    const differentEdge: ArchViolation = { ...found[0]!, identity: 'cycle-edge::a->c' }
    expect(hashViolation(found[0]!)).not.toBe(hashViolation(differentEdge))

    // **The limit, stated rather than papered over.** What this does NOT measure is what
    // v0.46.1 actually reported, and it cannot: no option turns re-export edges off, so the
    // pre-0.48 graph is not reproducible through the shipped API. The v0.48.0 claim that "a
    // cycle that got wider is a different violation, not a moved one" is therefore
    // unmeasurable by construction. This row shows the mechanism that makes it true; it is
    // not evidence of the historical comparison.
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
    expect(found).toHaveLength(2)
    expect(found[0]!.file).toMatch(/src\/a\/index\.ts$/)
    expect(found[0]!.line).toBe(1)
    expect(found[1]!.file).toMatch(/src\/b\/index\.ts$/)
    expect(found[1]!.line).toBe(1)
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
