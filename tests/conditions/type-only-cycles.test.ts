/**
 * `beFreeOfCycles()` and type-only imports —
 * [plan 0084](../../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md).
 *
 * A `import type { X }` is **erased at compile time** and creates no runtime
 * dependency, so counting it as a graph edge invents cycles that cannot exist at
 * runtime. That was not theoretical: this repo's own `arch/no-cycles` rule sat at
 * `.warn()` for months with a comment reading *"type-only imports create
 * false-positive cycles; switch to .check() when beFreeOfCycles ignores import
 * type"* — a documented, exported condition, unusable at error severity by anyone
 * who uses `import type` for the reason it exists.
 *
 * Two consequences of a rule that cannot fail, both measured before this fix:
 *
 *  1. Our own source had a reported-and-ignored cycle.
 *  2. **It let a new one in overnight.** Plan 0082's fix added a value import
 *     `helpers/callback-extractor.ts → models/arch-function.ts`, closing a runtime
 *     cycle where v0.45.6 had only `import type`. Nothing failed, because nothing
 *     could.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import type { ImportOptions } from '../../src/core/import-options.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { hashViolation } from '../../src/helpers/baseline.js'

/** Two slices, `a/` and `b/`, with the import spellings under test. */
function twoSlices(aImportsB: string, bImportsA: string): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  tsm.createSourceFile(
    '/src/a/index.ts',
    `${aImportsB}\nexport type Alpha = { n: number }\nexport const alpha = 1\n`,
  )
  tsm.createSourceFile(
    '/src/b/index.ts',
    `${bImportsA}\nexport type Beta = { n: number }\nexport const beta = 1\n`,
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

/**
 * Three slices: `a` and `b` in a real value cycle, plus `c` wired in by the
 * spellings under test. Used to show what the option does to cycle MEMBERSHIP,
 * which is what a baseline is keyed on.
 */
function threeSlices(bToC: string, cToA: string): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  tsm.createSourceFile(
    '/src/a/index.ts',
    `import { beta } from '../b/index.js'\nexport type Alpha = { n: number }\nexport const alpha = 1\n`,
  )
  tsm.createSourceFile(
    '/src/b/index.ts',
    `import { alpha } from '../a/index.js'\n${bToC}\nexport type Beta = { n: number }\nexport const beta = 1\n`,
  )
  tsm.createSourceFile(
    '/src/c/index.ts',
    `${cToA}\nexport type Gamma = { n: number }\nexport const gamma = 1\n`,
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const threeSliceCycles = (p: ArchProject, options?: ImportOptions): ArchViolation[] =>
  slices(p)
    .assignedFrom({ a: '**/src/a/**', b: '**/src/b/**', c: '**/src/c/**' })
    .should()
    .beFreeOfCycles(options)
    .rule({ id: 'test/no-cycles', because: 'cycles break module init order' })
    .violations()
    .filter((v) => v.bypassFilters !== true)

const cycles = (p: ArchProject, options?: ImportOptions): string[] =>
  slices(p)
    .assignedFrom({ a: '**/src/a/**', b: '**/src/b/**' })
    .should()
    .beFreeOfCycles(options)
    .violations()
    .filter((v) => v.bypassFilters !== true)
    .map((v) => v.element)

const TYPE_A = "import type { Alpha } from '../a/index.js'"
const TYPE_B = "import type { Beta } from '../b/index.js'"
const VALUE_A = "import { alpha } from '../a/index.js'"
const VALUE_B = "import { beta } from '../b/index.js'"

describe('beFreeOfCycles() and type-only imports (plan 0084)', () => {
  it('a type-only cycle is NOT a cycle — the motivating case', () => {
    // Both directions erased at compile time: nothing depends on anything at
    // runtime, so there is no cycle to report and no remedy that would apply.
    expect(cycles(twoSlices(TYPE_B, TYPE_A))).toEqual([])
  })

  it('a runtime cycle still IS one', () => {
    // The control that stops the fix from being "report nothing". By identity —
    // which slices — because a count cannot tell a real cycle from a phantom.
    expect(cycles(twoSlices(VALUE_B, VALUE_A))).toEqual(['[a, b]'])
  })

  it('a HALF type-only pair is not a cycle at all, in either direction', () => {
    // `a → b` by value, `b → a` by type. Plan 0084's test inventory demanded a
    // finding here — "still a runtime cycle in one direction" — and that phrase does
    // not describe anything: a cycle needs both directions. With `b → a` erased, `a`
    // depends on `b` and `b` depends on nothing. No cycle exists at runtime, and the
    // remedy ("extract shared code to a lower-level module") would be advice about a
    // dependency that is not there.
    //
    // The implementation was right and the plan's row was wrong. Kept as a test of
    // the correct semantics, and the plan is corrected, because a wrong expectation
    // that happens to fail is one edit away from a wrong expectation that passes.
    expect(cycles(twoSlices(VALUE_B, TYPE_A))).toEqual([])
    expect(cycles(twoSlices(TYPE_B, VALUE_A))).toEqual([])
  })

  it('a partially type-only import is a runtime edge', () => {
    // `import { type X, y }` keeps a runtime binding for `y`, so it is NOT
    // type-only. `isTypeOnlyImport` requires EVERY named specifier to be type-only,
    // and this row is what pins that rather than trusting the docstring.
    const p = twoSlices("import { type Beta, beta } from '../b/index.js'", VALUE_A)
    expect(cycles(p)).toEqual(['[a, b]'])
  })

  it('ignoreTypeImports: false still reports the type-only cycle', () => {
    // The option proven in BOTH positions. Without this row the default could be
    // hard-wired and every test above would still pass — the flag would be
    // decoration, which is the shape ADR-008 rule 5 is about.
    expect(cycles(twoSlices(TYPE_B, TYPE_A), { ignoreTypeImports: false })).toEqual(['[a, b]'])
  })

  it('the DEFAULT ignores type-only edges', () => {
    // Stated as a test, not just in a docstring: calling it with no argument must
    // behave as `{ ignoreTypeImports: true }`. A future "backward-compatible"
    // change of the default would red here, which is where that decision belongs.
    expect(cycles(twoSlices(TYPE_B, TYPE_A))).toEqual([])
    expect(cycles(twoSlices(TYPE_B, TYPE_A), { ignoreTypeImports: true })).toEqual([])
  })

  it('EVERY specifier inline-typed is treated as type-only — with a caveat', () => {
    // `import { type Alpha }` — no `import type` prefix, but every named specifier is
    // type-only, which is the second branch of `isTypeOnlyImport`. Without this row
    // that branch could be deleted and nothing would notice: the row below uses a
    // MIXED specifier list, so it only pins the `false` direction.
    expect(
      cycles(
        twoSlices(
          "import { type Beta } from '../b/index.js'",
          "import { type Alpha } from '../a/index.js'",
        ),
      ),
    ).toEqual([])

    // The caveat, recorded because it is a real limit and not a rounding error:
    // under `verbatimModuleSyntax: true` this form emits `import {} from '../b/index.js'`
    // — the specifiers vanish, the MODULE REQUEST does not — so it is a runtime
    // module-init edge and could genuinely close a cycle. `import type { Beta }` is
    // erased outright and never can.
    //
    // We do not read that flag here. `isTypeOnlyImport` has had these semantics since
    // v0.28.0 and is shared with `dependOn`/`notImportFrom`, so changing it is not this
    // plan's call to make quietly — it is carried as an open question on plan 0085,
    // which owns the graph's edge definition. This repo does not set the flag.
  })

  it('a re-export IS an edge now — the marker this row was left as', () => {
    // Inverted by [plan 0085](../../plans/0085-the-slice-graph-cannot-see-a-re-export.md),
    // which is what it was for. Plan 0084 wrote this row asserting `[]` and said so:
    // "it is a real false negative, and when plan 0085 fixes it this row reds and tells
    // its successor what changed." It did exactly that — the only failure in the suite
    // when the re-export edges landed.
    //
    // Kept rather than deleted because the record is the point: the limit was known,
    // deliberate, documented in the condition's own docstring, and deferred by plan
    // 0071 — and a deleted row would leave no trace that it had ever been decided.
    const valueReExport = twoSlices(
      "export { beta } from '../b/index.js'",
      "export { alpha } from '../a/index.js'",
    )
    expect(cycles(valueReExport)).toEqual(['[a, b]'])
    expect(cycles(valueReExport, { ignoreTypeImports: false })).toEqual(['[a, b]'])

    // And the type-only re-export is still erased, which is the pairing that proves
    // the new path consults `isTypeOnlyReExport` rather than counting every export.
    const typeReExport = twoSlices(
      "export type { Beta } from '../b/index.js'",
      "export type { Alpha } from '../a/index.js'",
    )
    expect(cycles(typeReExport)).toEqual([])
    expect(cycles(typeReExport, { ignoreTypeImports: false })).toEqual(['[a, b]'])
  })

  it('MIGRATION: the option changes cycle membership, so it changes baseline identity', () => {
    // The row plan 0082 promised and omitted, which is how a wrong migration note
    // shipped in v0.46.0. Asserted through the real `hashViolation`, not a hand-built
    // string, because the hash is what a baseline file actually contains.
    //
    // `c` is joined to the a↔b cycle by type-only edges. Counting them, the cycle is
    // three slices; erasing them, the SAME cycle is two — a different `element`, so a
    // different identity. An adopter's baseline entry does not "move", it STOPS
    // MATCHING, and the narrower cycle is reported as new.
    const p = threeSlices(
      "import type { Gamma } from '../c/index.js'",
      "import type { Alpha } from '../a/index.js'",
    )

    const before = threeSliceCycles(p, { ignoreTypeImports: false })
    const after = threeSliceCycles(p)

    // `[a, c, b]`, not `[a, b, c]`: `canonicalizeCycle` ROTATES the SCC so the
    // lexicographically smallest member leads, and does not sort. Measured, not
    // guessed — I wrote `[a, b, c]` first and this row corrected me. It matters here
    // of all places, because that string IS the baseline identity.
    expect(before.map((v) => v.element)).toEqual(['[a, c, b]'])
    expect(after.map((v) => v.element)).toEqual(['[a, b]'])

    // The upgrade note's actual claim, as a measurement.
    const hashes = (vs: ArchViolation[]): string[] => vs.map((v) => hashViolation(v))
    expect(hashes(before)).not.toEqual(hashes(after))
  })

  it('VACUITY: the fixture really has two slices with files in each', () => {
    // Every row above asserts on an empty-or-not list. If the slices resolved to
    // nothing, "no cycle" would be true for the wrong reason — ∀ over ∅, which is
    // the false green this library is named after.
    const built = slices(twoSlices(VALUE_B, VALUE_A)).assignedFrom({
      a: '**/src/a/**',
      b: '**/src/b/**',
    })
    const violations = built.should().beFreeOfCycles().violations()
    // A configuration finding here would mean a slice matched no files.
    expect(violations.filter((v) => v.bypassFilters === true)).toEqual([])
  })
})
