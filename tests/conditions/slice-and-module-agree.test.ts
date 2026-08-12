/**
 * Slice conditions and module conditions answer the same question the same way —
 * [bug 0059](../../bugs/fixed/0059-slice-conditions-and-module-conditions-disagree-about-a-dependency.md).
 *
 * `src/helpers/slice-graph.ts` shared **one** edge-kind set across all three slice
 * conditions, justified with a cycle argument: *"a slice graph answers what this slice
 * depends on when the program starts, which is what makes a cycle a cycle."* True — of
 * cycles. Plan 0087's insight is that cycles and coupling are different questions, and
 * that release split the *erasure* predicate per question while leaving the *kind* set
 * shared. So the cycle rationale governed two conditions that are not about cycles.
 *
 * Measured before the fix, on one file holding `export const load = () => import(…)`:
 *
 * ```
 * slices(p).…should().notDependOn('legacy')            ->  0 violations
 * modules(p).…should().notImportFromCondition(…)       ->  1 violation
 * ```
 *
 * Same file, same edge, same run. `type X = import('…').Y` diverged identically.
 *
 * ## Why the cycle rationale does not transfer
 *
 * *"Reporting a dynamic import would fail the rule for applying its own remedy"* is true
 * for `beFreeOfCycles`: `import()` is lazy, cannot deadlock initialization, and is often
 * the deliberate fix for a cycle. It is false for `notDependOn('legacy')` — a lazy import
 * of `legacy` is still coupling, it still breaks when `legacy` is deleted, and nobody is
 * applying a remedy by writing it.
 *
 * So the discrimination rows matter as much as the fix rows: this must not become "count
 * everything everywhere".
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { edgesOf, FORWARD_EDGE_KINDS } from '../../src/core/module-edges.js'
import { hashViolation } from '../../src/helpers/baseline.js'

/**
 * Two slices. `feature/` reaches `legacy/` by whichever spelling is under test, and
 * `legacy/` reaches back by a plain import so a cycle exists whenever both count.
 */
function twoSlices(featureToLegacy: string, legacyToFeature = ''): ArchProject {
  const tsm = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  })
  tsm.createSourceFile(
    '/src/legacy/index.ts',
    `${legacyToFeature}\nexport type Old = { n: number }\nexport const old = 1\n`,
  )
  tsm.createSourceFile(
    '/src/feature/index.ts',
    `${featureToLegacy}\nexport type New = { n: number }\nexport const fresh = 1\n`,
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const real = (vs: ArchViolation[]): ArchViolation[] => vs.filter((v) => v.bypassFilters !== true)
const built = (p: ArchProject): ReturnType<typeof slices> =>
  slices(p).assignedFrom({ feature: '**/src/feature/**', legacy: '**/src/legacy/**' })

const notDependOn = (p: ArchProject): ArchViolation[] =>
  real(built(p).should().notDependOn('legacy').violations())
const layerOrder = (p: ArchProject): ArchViolation[] =>
  real(built(p).should().respectLayerOrder('feature', 'legacy').violations())
const cycles = (p: ArchProject): string[] =>
  real(built(p).should().beFreeOfCycles().violations()).map((v) => v.element)
const notImportFrom = (p: ArchProject): ArchViolation[] =>
  real(
    modules(p)
      .that()
      .resideInFolder('**/src/feature/**')
      .should()
      .notImportFromCondition('**/src/legacy/**')
      .violations(),
  )

/** Every spelling of "feature reaches legacy", one per edge kind the engine defines. */
const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ['import', "import { old } from '../legacy/index.js'\nexport const used = old"],
  ['reexport', "export { old } from '../legacy/index.js'"],
  ['dynamic', "export const load = () => import('../legacy/index.js')"],
  ['type-expression', "export type Borrowed = import('../legacy/index.js').Old"],
]

describe('VACUITY: the fixtures really resolve (bug 0059)', () => {
  // Rows 1–4 below assert that a condition REPORTS something. Rows 5–7 assert one does
  // not. The second group is satisfied by a fixture whose specifier never resolved, so
  // prove resolution once, here, by identity rather than by count.
  it.each(SPELLINGS)('%s produces a resolved edge to legacy', (kind, spelling) => {
    const p = twoSlices(spelling)
    const file = p.getSourceFiles().find((f) => f.getFilePath().includes('feature'))
    const found = edgesOf(file!).map((e) => `${e.kind}:${e.resolvedPath ?? 'UNRESOLVED'}`)
    expect(found).toContain(`${kind}:/src/legacy/index.ts`)
  })
})

describe('a lazy or type-level dependency is still a dependency (bug 0059)', () => {
  it('notDependOn reports a dynamic import — 0 before the fix', () => {
    const found = notDependOn(twoSlices("export const load = () => import('../legacy/index.js')"))
    // The verb is per KIND (`edgeVerb`), and that matters beyond phrasing: the message is
    // part of a finding's baseline identity, so a dynamic edge cannot be absorbed by an
    // existing `imports` entry for the same module.
    expect(found.map((v) => v.message)).toEqual([
      'Slice "feature" dynamically imports forbidden slice "legacy"',
    ])
  })

  it('notDependOn reports a type-expression import', () => {
    const found = notDependOn(twoSlices("export type Borrowed = import('../legacy/index.js').Old"))
    expect(found.map((v) => v.message)).toEqual([
      'Slice "feature" references the type from forbidden slice "legacy"',
    ])
  })

  it('respectLayerOrder reports an upward dynamic import', () => {
    // `feature` is declared above `legacy`, so legacy→feature is the upward edge.
    const found = layerOrder(twoSlices('', "export const up = () => import('../feature/index.js')"))
    expect(found.map((v) => v.message)).toEqual([
      'Layer "legacy" dynamically imports higher layer "feature" (allowed: none)',
    ])
  })

  it('respectLayerOrder reports an upward type-expression import', () => {
    const found = layerOrder(twoSlices('', "export type Up = import('../feature/index.js').New"))
    expect(found.map((v) => v.message)).toEqual([
      'Layer "legacy" references the type from higher layer "feature" (allowed: none)',
    ])
  })
})

describe('but a cycle is still an initialization question — the discrimination', () => {
  // Without these three, the fix is "count everything everywhere", and `beFreeOfCycles`
  // starts reporting the very construct people use to BREAK a cycle.
  it('a dynamic-only cycle is NOT reported', () => {
    const p = twoSlices(
      "export const load = () => import('../legacy/index.js')",
      "export const back = () => import('../feature/index.js')",
    )
    expect(cycles(p)).toEqual([])
  })

  it('a type-expression-only cycle is NOT reported', () => {
    const p = twoSlices(
      "export type Borrowed = import('../legacy/index.js').Old",
      "export type Lent = import('../feature/index.js').New",
    )
    expect(cycles(p)).toEqual([])
  })

  it('an eager cycle IS still reported — the control', () => {
    // Without this row the two above pass on a graph that reports nothing at all.
    const p = twoSlices(
      "import { old } from '../legacy/index.js'\nexport const used = old",
      "import { fresh } from '../feature/index.js'\nexport const back = fresh",
    )
    expect(cycles(p)).toEqual(['feature -> legacy', 'legacy -> feature'])
  })
})

describe('the two families agree by construction, not by two lists', () => {
  it.each(SPELLINGS)(
    '%s: notDependOn and notImportFrom give the same answer',
    (_kind, spelling) => {
      // The claim the fix is built on. `notDependOn` reads `FORWARD_EDGE_KINDS` — the same
      // constant `notImportFrom` reads — so agreement is structural rather than maintained.
      const p = twoSlices(spelling)
      expect(notDependOn(p).length > 0).toBe(notImportFrom(p).length > 0)
    },
  )

  it('and the constant they share still excludes require', () => {
    // The one kind where they agree to say NO. If this flips, the rows above start
    // agreeing about CJS in an ESM-only package (ADR-004) and nothing else notices.
    expect(FORWARD_EDGE_KINDS.require).toBe(false)
    expect(FORWARD_EDGE_KINDS.dynamic).toBe(true)
    expect(FORWARD_EDGE_KINDS['type-expression']).toBe(true)
  })
})

describe('two edges of one kind to one slice are two baseline entries (bug 0059)', () => {
  // The defect a review measured after the kind fix landed: `siteIdentity` keyed on
  // `kind::specifier::names`, and `names` is EMPTY for dynamic, require and
  // type-expression. So two lazy imports of the same module from one file gave
  // **2 findings and 1 hash** — one accepted baseline entry silently pre-accepting the
  // next one someone adds. Bug 0028's shape, reachable in this family only because the
  // kind fix made those edges reportable at all.
  const twoOf = (spelling: string): ArchProject =>
    twoSlices(spelling.replace('NAME', 'a') + '\n' + spelling.replace('NAME', 'b'))

  const hashes = (vs: ArchViolation[]): number => new Set(vs.map((v) => hashViolation(v))).size

  it.each([
    ['dynamic', "export const NAME = () => import('../legacy/index.js')"],
    ['type-expression', "export type NAME_T = import('../legacy/index.js').Old"],
  ])('%s: two edges, two identities — in the slice family', (_kind, spelling) => {
    const found = notDependOn(twoOf(spelling.replace('NAME_T', 'NAME')))
    expect(found.length).toBe(2)
    expect(hashes(found)).toBe(2)
  })

  it.each([
    ['dynamic', "export const NAME = () => import('../legacy/index.js')"],
    ['type-expression', "export type NAME_T = import('../legacy/index.js').Old"],
  ])('%s: two edges, two identities — in the module family too', (_kind, spelling) => {
    // The same collision was LIVE here before the fix, because this family has always
    // reported these kinds. Fixing it in one shared place is what keeps the two schemes
    // from drifting again.
    const found = notImportFrom(twoOf(spelling.replace('NAME_T', 'NAME')))
    expect(found.length).toBe(2)
    expect(hashes(found)).toBe(2)
  })

  it('the ordinal survives an edit ABOVE the edges — which a line number would not', () => {
    // Why an ordinal and not the line: `identity` exists to survive edits elsewhere in
    // the file. Adding a line above must not move either identity.
    const base =
      "export const a = () => import('../legacy/index.js')\nexport const b = () => import('../legacy/index.js')"
    const before = notDependOn(twoSlices(base)).map((v) => v.identity)
    const after = notDependOn(twoSlices('export const unrelated = 1\n' + base)).map(
      (v) => v.identity,
    )
    expect(after).toEqual(before)
  })

  it('a NAMED kind keeps a byte-identical identity — no baseline migration', () => {
    // The reason the discriminator is "names OR ordinal" rather than "names AND ordinal":
    // appending an ordinal unconditionally would rewrite every existing import and
    // reexport entry in every adopter's baseline, to fix a defect those kinds never had.
    const found = notDependOn(
      twoSlices(
        "import { old } from '../legacy/index.js'\nimport type { Old } from '../legacy/index.js'\nexport const u = old\nexport type V = Old",
      ),
    )
    expect(found.map((v) => v.identity?.split('::').pop())).toEqual(['old', 'Old'])
  })
})
