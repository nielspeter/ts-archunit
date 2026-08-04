/**
 * `beFreeOfCycles()` and type-only imports —
 * [plan 0084](../../plans/0084-cycle-detection-that-ignores-type-only-imports.md).
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
