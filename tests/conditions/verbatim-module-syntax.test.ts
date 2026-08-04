/**
 * `import { type X }` under `verbatimModuleSyntax` —
 * [plan 0087](../../plans/0087-an-inline-type-import-still-requests-the-module.md).
 *
 * `ModuleEdge.typeOnly` used to answer two questions at once, and they are different:
 *
 * - **Are the bindings type-level?** The *coupling* question — what `dependOn`,
 *   `notImportFrom`, `notDependOn` and `respectLayerOrder` ask.
 * - **Is a module request emitted?** The *initialization* question — what a cycle is.
 *   A cycle is a deadlock in module-evaluation order; a coupling is not.
 *
 * They diverge for exactly two spellings, and only under `verbatimModuleSyntax: true`.
 * Measured through ts-morph's own emit before any of this was written:
 *
 * | form                          | `vms: false` | `vms: true`              |
 * | ----------------------------- | ------------ | ------------------------ |
 * | `import type { X } from 's'`  | erased       | erased                   |
 * | `import { type X } from 's'`  | erased       | **`import {} from 's'`** |
 * | `import { type X, y } from`   | requests     | requests                 |
 * | `export type { X } from 's'`  | erased       | erased                   |
 * | `export { type X } from 's'`  | erased       | **`export {} from 's'`** |
 * | `export { type X, y } from`   | requests     | requests                 |
 * | `export * from 's'`           | requests     | requests                 |
 * | `export type * as N from 's'` | erased       | erased                   |
 *
 * The specifiers vanish; the module request does not. So under that flag those two
 * forms are eager edges that can close a real cycle, and `beFreeOfCycles` reported
 * nothing for them until v0.49.0.
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs'
import type { ArchProject } from '../../src/core/project.js'
import { project } from '../../src/core/project.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { edgesOf, edgeStream } from '../../src/core/module-edges.js'
import type { ModuleEdge } from '../../src/core/module-edges.js'

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures')
const ON = path.join(FIXTURES, 'verbatim-module-syntax')
const OFF = path.join(FIXTURES, 'verbatim-module-syntax-off')

const cyclesIn = (p: ArchProject): string[] =>
  slices(p)
    .assignedFrom({ a: '**/src/a/**', b: '**/src/b/**' })
    .should()
    .beFreeOfCycles()
    .violations()
    .filter((v) => v.bypassFilters !== true)
    .map((v) => v.element)

/** An in-memory project with the flag in the given position. */
function inMemory(verbatim: boolean, aToB: string, bToA = "import { alpha } from '../a/index.js'") {
  const tsm = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      verbatimModuleSyntax: verbatim,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  })
  tsm.createSourceFile(
    '/src/a/index.ts',
    `${aToB}\nexport type Alpha = { n: number }\nexport const alpha = 1\n`,
  )
  tsm.createSourceFile(
    '/src/b/index.ts',
    `${bToA}\nexport type Beta = { n: number }\nexport const beta = 1\n`,
  )
  const p: ArchProject = {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
  return p
}

describe('ON DISK: the same source, two tsconfigs (plan 0087)', () => {
  it('VACUITY: the two fixtures are byte-identical source and differ only in the flag', () => {
    // The whole design of these fixtures is that the SOURCE cannot explain the
    // difference. If they drift apart, the pair below proves nothing — so this is
    // asserted first, and without using the library at all.
    for (const rel of ['src/a/index.ts', 'src/b/index.ts']) {
      expect(fs.readFileSync(path.join(ON, rel), 'utf-8')).toBe(
        fs.readFileSync(path.join(OFF, rel), 'utf-8'),
      )
    }
    const flag = (root: string): unknown => {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8'))
      if (typeof parsed !== 'object' || parsed === null || !('compilerOptions' in parsed)) return
      const options: unknown = parsed.compilerOptions
      if (typeof options !== 'object' || options === null) return
      return 'verbatimModuleSyntax' in options ? options.verbatimModuleSyntax : undefined
    }
    expect(flag(ON)).toBe(true)
    expect(flag(OFF)).toBe(false)
  })

  it('the flag ON: the cycle is REPORTED — the false negative this plan fixes', () => {
    // `a` reaches `b` only through `import { type Beta }`, and `b` imports `a` by
    // value. Under this tsconfig that emits `import {} from '../b/index.js'`, so both
    // modules are evaluated and the cycle is real.
    expect(cyclesIn(project(path.join(ON, 'tsconfig.json')))).toEqual(['[a, b]'])
  })

  it('the flag OFF: the same source has NO cycle', () => {
    // The pairing, and the only thing that makes the row above a discrimination rather
    // than "report everything". Identical bytes, opposite verdicts, and the compiler
    // option is the entire difference.
    expect(cyclesIn(project(path.join(OFF, 'tsconfig.json')))).toEqual([])
  })

  it('the coupling question is unchanged by the flag', () => {
    // The divergence that motivated a second field rather than a changed one. Under
    // the flag, `a → b` IS an eager edge (row above) but its BINDINGS are still purely
    // type-level — so a caller asking `notDependOn` to ignore type imports must still
    // get nothing. One project, one edge, two correct and opposite answers.
    const on = project(path.join(ON, 'tsconfig.json'))
    const violations = slices(on)
      .assignedFrom({ a: '**/src/a/**', b: '**/src/b/**' })
      .should()
      .notDependOn(['b'], { ignoreTypeImports: true })
      .violations()
      .filter((v) => v.bypassFilters !== true)
    expect(violations).toEqual([])
  })
})

describe('the erasure fields, per form (plan 0087)', () => {
  /** `typeOnly` / `erasesModuleRequest` for one declaration, at a given flag. */
  function classify(verbatim: boolean, decl: string): { typeOnly: boolean; erases: boolean } {
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        verbatimModuleSyntax: verbatim,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
      },
    })
    tsm.createSourceFile('/a.ts', 'export type Alpha = { n: number }\nexport const alpha = 1\n')
    const f = tsm.createSourceFile('/b.ts', `${decl}\n`)
    const edges = edgesOf(f).filter((e) => e.specifier === './a.js')
    expect(edges).toHaveLength(1)
    return { typeOnly: edges[0]!.typeOnly, erases: edges[0]!.erasesModuleRequest }
  }

  // Every row of the measured emit table, both flag positions. `erases` is the claim
  // that changed; `typeOnly` is the claim that must NOT have changed.
  const FORMS: Array<[string, string, boolean, boolean, boolean]> = [
    // decl, label, typeOnly, erasesOFF, erasesON
    ["import type { Alpha } from './a.js'", 'import type { X }', true, true, true],
    ["import { type Alpha } from './a.js'", 'import { type X }', true, true, false],
    ["import { type Alpha, alpha } from './a.js'", 'import { type X, y }', false, false, false],
    ["import { alpha } from './a.js'", 'import { y }', false, false, false],
    ["export type { Alpha } from './a.js'", 'export type { X } from', true, true, true],
    ["export { type Alpha } from './a.js'", 'export { type X } from', true, true, false],
    [
      "export { type Alpha, alpha } from './a.js'",
      'export { type X, y } from',
      false,
      false,
      false,
    ],
    ["export { alpha } from './a.js'", 'export { y } from', false, false, false],
    ["export * from './a.js'", 'export * from', false, false, false],
    ["export type * as NS from './a.js'", 'export type * as N from', true, true, true],
    // A type POSITION, not a declaration: `type X = import('s').Y`. Never emitted under
    // any flag, and it was missing from this table — sabotage flipping it to
    // "not erased" was caught by nothing, because the slice graph excludes the kind
    // outright so the field is unobservable there.
    ["export type Ref = import('./a.js').Alpha", 'type X = import(s).Y', true, true, true],
  ]

  it.each(FORMS)(
    '%s: typeOnly=%s, erases OFF=%s ON=%s',
    (decl, _label, typeOnly, erasesOff, erasesOn) => {
      expect(classify(false, decl)).toEqual({ typeOnly, erases: erasesOff })
      expect(classify(true, decl)).toEqual({ typeOnly, erases: erasesOn })
    },
  )

  it('edgeStream and edgesOf agree on EVERY field, at both flag positions', () => {
    // `makeEdge` was extracted so the cached builder and the lazy one cannot drift.
    // Nothing proved it: `edgeStream`'s only consumer (`dependOn`) reads `typeOnly`, so
    // sabotage that built its edges at the wrong flag was caught by NOTHING — the cold
    // path would have carried a silently wrong `erasesModuleRequest` until some future
    // reader trusted it.
    //
    // Asserted over every form, both flags, comparing the whole shape rather than the
    // one field, so a field added later is covered without editing this row.
    for (const verbatim of [false, true]) {
      const tsm = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
          verbatimModuleSyntax: verbatim,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
        },
      })
      tsm.createSourceFile('/a.ts', 'export type Alpha = { n: number }\nexport const alpha = 1\n')
      const f = tsm.createSourceFile('/b.ts', FORMS.map(([decl]) => decl).join('\n') + '\n')

      const cached = edgesOf(f)
      // `edgeStream` reads the cache when warm, so a fresh project is needed to
      // exercise the cold path this row exists for. `edgesOf` above warmed it, so
      // build a second identical project for the stream.
      const tsm2 = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: {
          verbatimModuleSyntax: verbatim,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
        },
      })
      tsm2.createSourceFile('/a.ts', 'export type Alpha = { n: number }\nexport const alpha = 1\n')
      const f2 = tsm2.createSourceFile('/b.ts', FORMS.map(([decl]) => decl).join('\n') + '\n')
      const streamed = [...edgeStream(f2)]

      // Compared as a canonical multiset, NOT in yield order. `edgesOf` sorts by source
      // position and `edgeStream` yields in the binder's order — declaration forms
      // before expression forms, regardless of where they appear — which this file
      // documents as a deliberate difference. Comparing sequences would red on a
      // reordering of FORMS, which is not what this row is about.
      const canonical = (edges: readonly ModuleEdge[]): string[] =>
        edges.map((e) => JSON.stringify(e)).sort()

      expect(streamed).toHaveLength(cached.length)
      expect(streamed.length).toBeGreaterThan(5) // not vacuous
      expect(canonical(streamed)).toEqual(canonical(cached))
    }
  })

  it('erasesModuleRequest implies typeOnly, for every form and both flags', () => {
    // An invariant rather than a row-by-row claim: a statement cannot vanish while
    // still binding a runtime value. Stated as a test because it is the property that
    // makes the two fields safe to reason about separately — if it ever fails, some
    // condition is ignoring an edge that binds a value.
    for (const [decl] of FORMS) {
      for (const verbatim of [false, true]) {
        const { typeOnly, erases } = classify(verbatim, decl)
        if (erases) expect(typeOnly).toBe(true)
      }
    }
  })
})

describe('cycles through each flag-dependent form (plan 0087)', () => {
  it('the inline-type IMPORT closes a cycle only under the flag', () => {
    const decl = "import { type Beta } from '../b/index.js'"
    expect(cyclesIn(inMemory(true, decl))).toEqual(['[a, b]'])
    expect(cyclesIn(inMemory(false, decl))).toEqual([])
  })

  it('the inline-type RE-EXPORT closes a cycle only under the flag', () => {
    // Measured, not assumed to match the import case: export emit rules differ from
    // import emit rules, which is why plan 0085 refused to guess and plan 0087 made it
    // Phase 3. It does match — `export { type Beta } from` emits `export {} from`.
    const decl = "export { type Beta } from '../b/index.js'"
    expect(cyclesIn(inMemory(true, decl))).toEqual(['[a, b]'])
    expect(cyclesIn(inMemory(false, decl))).toEqual([])
  })

  it('CONTROL: a declaration-level `import type` closes no cycle under either flag', () => {
    // The row that keeps the fix from collapsing into "count every type form". This is
    // the spelling that is genuinely, always erased.
    const decl = "import type { Beta } from '../b/index.js'"
    expect(cyclesIn(inMemory(true, decl))).toEqual([])
    expect(cyclesIn(inMemory(false, decl))).toEqual([])
  })

  it('CONTROL: a value import closes a cycle under either flag', () => {
    const decl = "import { beta } from '../b/index.js'"
    expect(cyclesIn(inMemory(true, decl))).toEqual(['[a, b]'])
    expect(cyclesIn(inMemory(false, decl))).toEqual(['[a, b]'])
  })
})
