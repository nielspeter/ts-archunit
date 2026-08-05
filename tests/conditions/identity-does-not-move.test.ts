/**
 * A finding's baseline identity does not move — enumerated over every spelling, not asserted
 * once over the convenient one.
 *
 * ## Why this file exists
 *
 * v0.56.0 gave names-less edges a source-order `ordinal` so that two lazy imports of one
 * module from one file stop sharing a baseline entry (bug 0028's shape, reached through
 * [bug 0059](../../bugs/fixed/0059-slice-conditions-and-module-conditions-disagree-about-a-dependency.md)).
 * The first form of that fix emitted `#${ordinal}` whenever `names` was empty, and shipped
 * with a promise — in the CHANGELOG, in `docs/upgrading.md`, and in two source comments —
 * that `import` and `reexport` entries did not move.
 *
 * **The promise was false, and the suite could not see it.** `names` is empty for the KIND
 * (`dynamic`, `require`, `type-expression`) *and* for four ordinary `import`/`reexport`
 * SPELLINGS: `import D from`, `import * as NS from`, a bare `import './x.js'`, and
 * `export * from` — the barrel. Measured against `main` through the public conditions, 4 of
 * 7 spellings moved, in **both** families. The one row guarding the promise
 * (`slice-and-module-agree.test.ts`, "a NAMED kind keeps a byte-identical identity") asserted
 * only `import { old }`, so it answered "pass" with the claim broken on four forms — and the
 * two-line repair that fixed it left all 3151 tests green, because nothing in the suite could
 * distinguish `#0` from `''`.
 *
 * ## What makes these rows a guard and not a restatement
 *
 * The expected strings below are **captured from `main`**, i.e. from the pre-ordinal formula
 * `[...names].sort().join(',')`, not computed from `edgeDiscriminator` — the differently
 * derived value ADR-008 rule 5 asks for. A change to the discriminator's shape fails these
 * rows by disagreeing with what a v0.55.3 baseline actually contains, which is the only
 * question an adopter cares about. Asserting `edgeDiscriminator(edge)` against itself would
 * pass for any implementation, including the broken one.
 *
 * Two spellings are load-bearing controls rather than cases:
 *
 * - **`export * as NS from`** carries one statically-known name, so it must NOT be in the
 *   moving set. Without it, a reader concludes the rule is "star forms move" and the next
 *   refactor generalises the wrong way.
 * - **`import { old }`** is the row the old guard had. It is kept so the file shows what
 *   insufficient coverage looked like, beside what sufficient looks like.
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { edgesOf } from '../../src/core/module-edges.js'
import { hashViolation } from '../../src/helpers/baseline.js'

/**
 * `legacy/` exports a default, a named value, a type and two more names, so every spelling
 * below resolves. `alpha`/`beta` exist for the multi-name row, which is the only one that can
 * see the sort and the join separator.
 */
function twoSlices(featureToLegacy: string): ArchProject {
  const tsm = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  })
  tsm.createSourceFile(
    '/src/legacy/index.ts',
    `export type Old = { n: number }\nexport const old = 1\nexport const alpha = 1\nexport const beta = 2\nexport const zebra = 1\nexport const aardvark = 2\nexport default old\n`,
  )
  tsm.createSourceFile('/src/feature/index.ts', `${featureToLegacy}\nexport const fresh = 1\n`)
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const real = (vs: ArchViolation[]): ArchViolation[] => vs.filter((v) => v.bypassFilters !== true)

const notDependOn = (p: ArchProject): ArchViolation[] =>
  real(
    slices(p)
      .assignedFrom({ feature: '**/src/feature/**', legacy: '**/src/legacy/**' })
      .should()
      .notDependOn('legacy')
      .violations(),
  )

const notImportFrom = (p: ArchProject): ArchViolation[] =>
  real(
    modules(p)
      .that()
      .resideInFolder('**/src/feature/**')
      .should()
      .notImportFromCondition('**/src/legacy/**')
      .violations(),
  )

const SLICE = 'feature->legacy::/src/feature/index.ts'
const MODULE = '/src/feature/index.ts'
const SPEC = '../legacy/index.js'
const RESOLVED = '/src/legacy/index.ts'

/**
 * Every spelling that reaches `legacy`, with the identity a v0.55.3 baseline holds for it.
 *
 * `sliceIdentity` is `undefined` for the two kinds the slice family did not report before
 * bug 0059 — there is no v0.55.3 entry to preserve, so the row asserts the shape the fix
 * must produce rather than a captured value. Both are marked at their site.
 */
const SPELLINGS: ReadonlyArray<{
  readonly label: string
  readonly source: string
  readonly sliceIdentity: string | undefined
  readonly moduleIdentity: string
}> = [
  {
    label: 'named import — the only form the old guard covered',
    source: `import { old } from '${SPEC}'\nexport const u = old`,
    sliceIdentity: `${SLICE}::import::${SPEC}::old`,
    moduleIdentity: `${MODULE}::import::${RESOLVED}::old`,
  },
  {
    label: 'default import — names-less, moved under the first fix',
    source: `import Old from '${SPEC}'\nexport const u = Old`,
    sliceIdentity: `${SLICE}::import::${SPEC}::`,
    moduleIdentity: `${MODULE}::import::${RESOLVED}::`,
  },
  {
    label: 'namespace import — names-less, moved under the first fix',
    source: `import * as NS from '${SPEC}'\nexport const u = NS`,
    sliceIdentity: `${SLICE}::import::${SPEC}::`,
    moduleIdentity: `${MODULE}::import::${RESOLVED}::`,
  },
  {
    label: 'side-effect import — names-less, moved under the first fix',
    source: `import '${SPEC}'`,
    sliceIdentity: `${SLICE}::import::${SPEC}::`,
    moduleIdentity: `${MODULE}::import::${RESOLVED}::`,
  },
  {
    label: 'star reexport (the barrel) — names-less, moved under the first fix',
    source: `export * from '${SPEC}'`,
    sliceIdentity: `${SLICE}::reexport::${SPEC}::`,
    moduleIdentity: `${MODULE}::reexport::${RESOLVED}::`,
  },
  {
    label: 'named reexport',
    source: `export { old } from '${SPEC}'`,
    sliceIdentity: `${SLICE}::reexport::${SPEC}::old`,
    moduleIdentity: `${MODULE}::reexport::${RESOLVED}::old`,
  },
  {
    // THE ONLY ROW THAT CAN SEE THE SORT OR THE SEPARATOR. Every other spelling here yields at
    // most one name, so `[...names].sort().join(',')` is indistinguishable from `names[0]` for
    // them — measured: with this row absent, deleting the `.sort()` and changing `,` to `''`
    // each left the FULL 3165-test suite green.
    //
    // Written `beta, alpha` deliberately. `getNamedImports()` returns source order, so without
    // the sort this yields `beta,alpha` and every multi-name entry in an adopter's baseline
    // moves the first time anyone runs an import-sorting lint autofix — the defect class this
    // whole file exists to close, one layer over. The comma is pinned at the same time:
    // `['alpha','beta']` and `['alphabeta']` are distinct only while the separator is there.
    label: 'multi-name import — pins the sort and the join separator',
    source: `import { beta, alpha } from '${SPEC}'\nexport const u = [alpha, beta]`,
    sliceIdentity: `${SLICE}::import::${SPEC}::alpha,beta`,
    moduleIdentity: `${MODULE}::import::${RESOLVED}::alpha,beta`,
  },
  {
    // THE CONTROL. `export * as NS` is a star form that carries a name, so it must not move.
    // If this row ever joins the names-less set, the rule has been generalised to "star" and
    // the generalisation is wrong.
    label: 'export-star-as-NS — a star form that DOES carry a name (control)',
    source: `export * as NS from '${SPEC}'`,
    sliceIdentity: `${SLICE}::reexport::${SPEC}::NS`,
    moduleIdentity: `${MODULE}::reexport::${RESOLVED}::NS`,
  },
  {
    // No v0.55.3 slice entry exists — the slice family reported nothing here, which was
    // bug 0059. The module family DID report it, and that captured value is what pins the
    // empty discriminator.
    label: 'dynamic import — no prior slice entry; module entry captured from main',
    source: `export const load = () => import('${SPEC}')`,
    sliceIdentity: undefined,
    moduleIdentity: `${MODULE}::dynamic::${RESOLVED}::`,
  },
  {
    label: 'type-expression — no prior slice entry; module entry captured from main',
    source: `export type Borrowed = import('${SPEC}').Old`,
    sliceIdentity: undefined,
    moduleIdentity: `${MODULE}::type-expression::${RESOLVED}::`,
  },
]

describe('every spelling keeps the identity a v0.55.3 baseline holds', () => {
  it.each(SPELLINGS)('$label', ({ source, sliceIdentity, moduleIdentity }) => {
    const mod = notImportFrom(twoSlices(source))
    // Stated for the reader, not load-bearing: the `toEqual([…])` below already fails on an
    // empty list, and measured, deleting this line changes no verdict under either emptying
    // mutation. The one vacuity assertion in this file that IS load-bearing is marked as such,
    // in the ordinal-survives-an-edit row — where both sides are lists and `[] === []` passes.
    expect(mod).toHaveLength(1)
    expect(mod.map((v) => v.identity)).toEqual([moduleIdentity])

    const slice = notDependOn(twoSlices(source))
    expect(slice).toHaveLength(1)
    if (sliceIdentity !== undefined) {
      expect(slice.map((v) => v.identity)).toEqual([sliceIdentity])
    } else {
      // Bug 0059's two kinds: no captured value, but the discriminator must still be empty,
      // because a first edge is a first edge regardless of which family asks.
      expect(slice[0]?.identity?.endsWith('::')).toBe(true)
    }
  })

  it('the fixtures resolve — every spelling produces a resolved edge (vacuity)', () => {
    // Proves the rows above are asserting over real, resolved edges rather than over a
    // project whose imports silently failed to resolve. Derived through `edgesOf`, not
    // through either condition, so it is independent evidence.
    for (const { label, source } of SPELLINGS) {
      const p = twoSlices(source)
      const file = p.getSourceFiles().find((f) => f.getFilePath() === '/src/feature/index.ts')
      const resolved = edgesOf(file!).map((e) => e.resolvedPath ?? 'UNRESOLVED')
      expect(resolved, label).toContain(RESOLVED)
    }
  })
})

describe('a second edge of one kind to one module is its own entry — the fail-open', () => {
  /** Two edges, same kind, same specifier: the group that had two findings and one hash. */
  const COLLIDING: ReadonlyArray<readonly [string, string, string]> = [
    [
      'two dynamic imports',
      `export const a = () => import('${SPEC}')\nexport const b = () => import('${SPEC}')`,
      'dynamic',
    ],
    [
      'two default imports',
      `import A from '${SPEC}'\nimport B from '${SPEC}'\nexport const u = [A, B]`,
      'import',
    ],
    ['two side-effect imports', `import '${SPEC}'\nimport '${SPEC}'`, 'import'],
  ]

  it.each(COLLIDING)('%s: two findings, two hashes', (_label, source, kind) => {
    for (const found of [notImportFrom(twoSlices(source)), notDependOn(twoSlices(source))]) {
      expect(found).toHaveLength(2)
      expect(new Set(found.map((v) => hashViolation(v))).size).toBe(2)
    }

    // And the SURVIVOR does not move: the first of the pair carries the same empty
    // discriminator a v0.55.3 baseline recorded, so the existing entry still matches and
    // only the genuinely-new sibling is reported. This is what makes the migration empty.
    const mod = notImportFrom(twoSlices(source))
    expect(mod.map((v) => v.identity)).toEqual([
      `${MODULE}::${kind}::${RESOLVED}::`,
      `${MODULE}::${kind}::${RESOLVED}::#1`,
    ])
  })

  it('and the ordinal survives an edit above it', () => {
    // The reason identity uses a source-order ordinal and not a line number.
    const base = `export const a = () => import('${SPEC}')\nexport const b = () => import('${SPEC}')`
    const before = notImportFrom(twoSlices(base)).map((v) => v.identity)
    const after = notImportFrom(twoSlices(`export const unrelated = 1\n${base}`)).map(
      (v) => v.identity,
    )
    expect(before).toHaveLength(2) // vacuity: `[] === []` would pass and prove nothing
    expect(after).toEqual(before)
  })
})

describe('the discriminator is machine-independent', () => {
  it('sorts names by codepoint, not by the host locale', () => {
    // `localeCompare` reads the host locale, so an identity built with it differs between a
    // developer's machine and CI — one finding, two baseline hashes, diverging only in the
    // place hardest to debug. `module-edges.ts` documented that hazard 60 lines above the line
    // that committed it, and the guard added in v0.56.0 to "pin the sort" used `alpha`/`beta`,
    // which collate identically everywhere, so it fired on "sort deleted" and not on "sort is
    // locale-dependent". Under `LC_ALL=da_DK.UTF-8` the whole suite stayed green.
    //
    // `aardvark`/`zebra` is the cheapest pair that separates the two: plain ASCII, and Danish
    // collates `aa` as `å`, which sorts AFTER `z`.
    const found = notImportFrom(
      twoSlices(
        "import { zebra, aardvark } from '../legacy/index.js'\nexport const u = [zebra, aardvark]",
      ),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.identity).toBe(`${MODULE}::import::${RESOLVED}::aardvark,zebra`)

    // **This row does NOT guard the locale defect, and saying so is the point.** Measured:
    // with `localeCompare` reinstated it passes 16/16, because on an `en-US` machine the two
    // comparators agree for every ASCII pair. It pins the expected identity VALUE and nothing
    // more. `tests/tools/scan-locale-ordering.test.ts` is the guard — a source scan, because
    // no runtime row can see a defect whose symptom depends on the machine running it.
    //
    // The two assertions below are facts about JavaScript, not about this implementation.
    // They are here so the scan's premise is checkable from the row that motivated it.
    expect(['zebra', 'aardvark'].sort((a, b) => a.localeCompare(b, 'da-DK')).join(',')).toBe(
      'zebra,aardvark',
    )
    expect(['zebra', 'aardvark'].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',')).toBe(
      'aardvark,zebra',
    )
  })
})
