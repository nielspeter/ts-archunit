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
    expect(cycles(twoSlices(VALUE_B, VALUE_A))).toEqual(['a -> b', 'b -> a'])
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
    expect(cycles(p)).toEqual(['a -> b', 'b -> a'])
  })

  it('ignoreTypeImports: false still reports the type-only cycle', () => {
    // The option proven in BOTH positions. Without this row the default could be
    // hard-wired and every test above would still pass — the flag would be
    // decoration, which is the shape ADR-008 rule 5 is about.
    expect(cycles(twoSlices(TYPE_B, TYPE_A), { ignoreTypeImports: false })).toEqual([
      'a -> b',
      'b -> a',
    ])
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

    // The caveat, and it is now MEASURED rather than reasoned. Emitted through
    // ts-morph, same source, both settings:
    //
    //   verbatimModuleSyntax: false -> (nothing; fully elided)
    //   verbatimModuleSyntax: true  -> import {} from '../b/index.js';
    //
    // The specifiers vanish, the MODULE REQUEST does not. So under that flag this form
    // IS a runtime module-init edge and can close a cycle, and the assertion above is
    // a false negative for such a project. `import type { Beta }` is erased outright
    // under both settings and never can be.
    //
    // Left as-is deliberately. `ModuleEdge.typeOnly` collapses "erased specifiers" and
    // "erased module request", which this measurement proves are different questions,
    // and it is read by five conditions — so the fix ADDS a distinction to the shared
    // edge model rather than changing `isTypeOnlyImport`, whose current meaning is
    // right for the four coupling conditions. That is
    // [plan 0087](../../plans/completed/0087-an-inline-type-import-still-requests-the-module.md),
    // which owns it and will update this row. This repo does not set the flag.
  })

  it('a re-export IS an edge now — the marker this row was left as', () => {
    // Inverted by [plan 0085](../../plans/completed/0085-the-slice-graph-cannot-see-a-re-export.md),
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
    expect(cycles(valueReExport)).toEqual(['a -> b', 'b -> a'])
    expect(cycles(valueReExport, { ignoreTypeImports: false })).toEqual(['a -> b', 'b -> a'])

    // And the type-only re-export is still erased, which is the pairing that proves
    // the new path consults `isTypeOnlyReExport` rather than counting every export.
    const typeReExport = twoSlices(
      "export type { Beta } from '../b/index.js'",
      "export type { Alpha } from '../a/index.js'",
    )
    expect(cycles(typeReExport)).toEqual([])
    expect(cycles(typeReExport, { ignoreTypeImports: false })).toEqual(['a -> b', 'b -> a'])
  })

  it('MIGRATION: the option changes cycle MEMBERSHIP, but only the affected edges move (plan 0104)', () => {
    // Under plan 0104, `identity`/`element` are per-edge, not per-component — so this row's
    // original claim ("the whole element moves") is no longer the interesting fact. The
    // interesting fact is the minimal-diff property: `c` joins/leaves the component by TWO
    // type-only edges (`b -> c`, `c -> a`); the pre-existing `a <-> b` edges are entirely
    // unaffected by whether those two are counted.
    //
    // `c` is joined to the a<->b cycle by type-only edges. Counting them (`before`), the SCC
    // is three slices with four internal edges; erasing them (`after`, the default), the
    // SAME two `a <-> b` edges remain, unchanged, and `c`'s two edges simply disappear.
    const p = threeSlices(
      "import type { Gamma } from '../c/index.js'",
      "import type { Alpha } from '../a/index.js'",
    )

    const before = threeSliceCycles(p, { ignoreTypeImports: false })
    const after = threeSliceCycles(p)

    expect(before.map((v) => v.element)).toEqual(['a -> b', 'b -> a', 'b -> c', 'c -> a'])
    expect(after.map((v) => v.element)).toEqual(['a -> b', 'b -> a'])

    // The surviving edges — both `element` AND `hashViolation`, byte-identical. Both
    // fixtures share the SAME `.assignedFrom({ a, b, c })` slice definition (only the
    // `beFreeOfCycles(options)` argument differs), so `context.rule` is identical between
    // them and `hashViolation` is directly comparable here.
    const surviving = (vs: ArchViolation[]) => vs.slice(0, 2)
    expect(surviving(after).map((v) => v.element)).toEqual(surviving(before).map((v) => v.element))
    expect(surviving(after).map((v) => hashViolation(v))).toEqual(
      surviving(before).map((v) => hashViolation(v)),
    )

    // `c`'s two edges are exactly what disappears — an adopter's baseline entry for THOSE
    // two edges stops matching; the `a <-> b` entries keep matching unchanged.
    expect(before.map((v) => v.identity)).toEqual(
      expect.arrayContaining(['cycle-edge::b->c', 'cycle-edge::c->a']),
    )
    expect(after.map((v) => v.identity)).not.toEqual(
      expect.arrayContaining(['cycle-edge::b->c', 'cycle-edge::c->a']),
    )
  })

  it('an EMPTY options object behaves as no argument at all', () => {
    // Bug 0057. The default used to sit on the whole object while the read was per
    // field, so any object defeated it: `beFreeOfCycles({})` typechecks — the field is
    // optional — and silently gave the pre-0.47 graph, reporting a cycle that cannot
    // exist at runtime. Measured before the fix: `()` -> [], `({})` -> ['[a, b]'].
    const p = twoSlices(TYPE_B, TYPE_A)
    expect(cycles(p, {})).toEqual([])
    expect(cycles(p)).toEqual([])

    // The pairing, so the fix is not "ignore the argument".
    expect(cycles(p, { ignoreTypeImports: false })).toEqual(['a -> b', 'b -> a'])
  })

  it('an options object built elsewhere, not restating the field, keeps the default', () => {
    // The realistic shape of bug 0057: options that came from a config object or a
    // helper and simply do not mention the field. Before the fix this reverted a
    // documented default; the mechanism was per-object rather than per-field.
    const fromConfig: ImportOptions = {}
    const spread: ImportOptions = { ...fromConfig }
    expect(cycles(twoSlices(TYPE_B, TYPE_A), spread)).toEqual([])

    // The case I could NOT write, recorded rather than faked: an object carrying an
    // unrelated FUTURE field of `ImportOptions`. `{ someNewOption: true }` is rejected by
    // TypeScript's excess-property check (TS2559), and expressing it would need an `as`
    // cast, which ADR-005 bars. So the type system is a second line of defence here —
    // worth knowing, and worth not mistaking for the guard: it protects the literal form
    // only, and stops protecting anything the moment the second field genuinely exists.
    // The guard for that day is the per-field resolution itself, which the rows above
    // pin. This is the honest state, not a gap I have covered.
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
