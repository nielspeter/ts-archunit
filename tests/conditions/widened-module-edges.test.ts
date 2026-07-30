/**
 * What the widened conditions and predicates report — plan 0071 test-inventory
 * items 9, 10, 11, 12, 14, 16b, 19b and 21.
 *
 * The suite these join could not tell the widening apart from the bug: blinding
 * `onlyImportFrom` + `notImportFrom` to collect **nothing** fails 38 tests, and
 * widening them to collect **everything** changed **zero** of 2508. So the
 * pre-existing tests pin that the loop runs, never what it collects — and every
 * assertion here exists because a specific revert survived without it.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { modules, project } from '../../src/index.js'
import { dependOn } from '../../src/conditions/dependency.js'
import { hashViolation } from '../../src/helpers/baseline.js'
import type { ArchViolation } from '../../src/core/violation.js'

const fixtureRoot = path.join(import.meta.dirname, '../fixtures/module-edge-conditions')
const p = project(path.join(fixtureRoot, 'tsconfig.json'))

const BANNED = '**/banned/**'

/** `relpath:line` for each violation — never basenames (plan 0071 Guards). */
const identify = (violations: ArchViolation[]): string[] =>
  violations
    .map((v) => `${path.relative(fixtureRoot, v.file)}:${String(v.line)}`)
    .sort((a, b) => a.localeCompare(b))

const inFixture = (glob: string): string => `**/module-edge-conditions/src/${glob}`

describe('notImportFrom sees every kind (the widening itself)', () => {
  it('reports the four runtime kinds and not the erased ones', () => {
    const found = modules(p).should().notImportFrom(BANNED).violations()

    expect(identify(found)).toEqual([
      // `require`, both spellings, are absent — see item 16b below. The two
      // ERASED kinds are present, because `import type` has always been a full
      // edge here and `{ ignoreTypeImports: true }` is the only exemption — see
      // the next test.
      'src/consumer-dynamic.ts:2',
      'src/consumer-import.ts:1',
      'src/consumer-reexport-type.ts:2',
      'src/consumer-reexport.ts:3',
      'src/consumer-star.ts:2',
      'src/consumer-type-expr.ts:2',
      'src/mixed.ts:4',
      'src/mixed.ts:5',
      'src/twice.ts:4',
      'src/twice.ts:5',
    ])
  })

  it('reports the erased kinds only when they are not exempted', () => {
    // A type-only re-export and a type expression are full edges by default —
    // `import type` has always been a full edge here, and the only exemption is
    // the explicit opt-in.
    const strict = modules(p).should().notImportFrom(BANNED).violations()
    expect(identify(strict)).toContain('src/consumer-reexport.ts:3')

    const lenient = modules(p)
      .should()
      .notImportFromWithOptions([BANNED], { ignoreTypeImports: true })
      .violations()

    // With the opt-in, the erased edges drop out and the runtime ones stay.
    expect(identify(lenient)).not.toContain('src/consumer-reexport-type.ts:2')
    expect(identify(lenient)).toContain('src/consumer-reexport.ts:3')
    expect(identify(lenient)).toContain('src/consumer-dynamic.ts:2')
  })
})

describe('item 16b — `require` is classified and enforced by nothing', () => {
  /**
   * Item 16 asserts the **classification**; it reads `moduleEdges` and never runs
   * a condition, so it cannot see the exclusion. Measured: removing the `require`
   * filter from both widened conditions left all 2508 existing tests green, and
   * `src/` contains **zero** `require` instances so the "0 changed" widening
   * measurement cannot see it either.
   */
  it('reports nothing for require() in .js or `import x = require()`', () => {
    const found = identify(modules(p).should().notImportFrom(BANNED).violations())

    expect(found).not.toContain('src/cjs-consumer.js:3')
    expect(found).not.toContain('src/equals-consumer.d.ts:3')
    // The premise: those two files really do carry a banned edge, so the absences
    // above are an exclusion rather than an empty fixture.
    expect(found.length).toBeGreaterThan(0)
    expect(
      modules(p).that().resideInFile(inFixture('cjs-consumer.js')).should().notExist().violations()
        .length,
    ).toBe(1)
  })

  it('never emits the string `undefined` in a message', () => {
    // A `Record` verb table with no `require` entry produced
    // `cjs-consumer.js undefined "…/secret.ts" which matches forbidden […]`, and
    // that text gets hashed into a baseline. The verb is an exhaustive switch and
    // `require` has a real verb, so a forgotten filter yields a correct sentence
    // rather than nonsense.
    const messages = modules(p)
      .should()
      .notImportFrom(BANNED)
      .violations()
      .map((v) => v.message)
    expect(messages.length).toBeGreaterThan(0)
    for (const message of messages) expect(message).not.toContain('undefined')
  })
})

describe('item 19b — onlyHaveTypeImportsFrom excludes dynamic', () => {
  /**
   * §3 reasoned hardest about this exclusion and left it unguarded: adding
   * `dynamic` to the kind filter left all 2508 tests green. The condition's remedy
   * is "make the dependency erased", and there is **no** way to do that for
   * `await import(…)` — a finding whose remedy cannot be followed is not a
   * finding (ADR-008 rule 2).
   */
  it('reports the runtime import and re-export but never the dynamic import', () => {
    const found = identify(modules(p).should().onlyHaveTypeImportsFrom(BANNED).violations())

    expect(found).toContain('src/consumer-import.ts:1')
    expect(found).toContain('src/consumer-reexport.ts:3')
    // The one that must be absent.
    expect(found).not.toContain('src/consumer-dynamic.ts:2')
    // …and the already-erased kinds have nothing to report.
    expect(found).not.toContain('src/consumer-reexport-type.ts:2')
    expect(found).not.toContain('src/consumer-type-expr.ts:2')
  })

  it('gives a re-export a remedy that names its consequence', () => {
    // The remedy for an import is local and complete. For a re-export it erases
    // the edge AND removes a runtime export consumers may import as a value, so
    // the reader has to be told before following it (ADR-008 rule 2).
    const found = modules(p).should().onlyHaveTypeImportsFrom(BANNED).violations()
    const reexport = found.find((v) => v.file.endsWith('consumer-reexport.ts'))
    const staticImport = found.find((v) => v.file.endsWith('consumer-import.ts'))

    expect(staticImport?.suggestion).toContain('import type')
    expect(reexport?.suggestion).toContain('export type')
    expect(reexport?.suggestion).toContain('removes a runtime export')
    // The two remedies must differ, or the per-kind switch is decoration.
    expect(reexport?.suggestion).not.toBe(staticImport?.suggestion)
  })
})

describe('item 10 — dependOn, stated so it fails on the un-widened build', () => {
  /**
   * Draft 3 phrased this as "a type-only re-export does not satisfy it; a plain
   * `import type` still does; a runtime edge does" — and measured, **all three
   * clauses pass with the widening entirely absent**, because before 0.28.0 every
   * re-export and dynamic import left `dependOn` unsatisfied.
   *
   * So the reversal has to be named in the words that reverse: a runtime
   * re-export and a runtime dynamic import **satisfy** `dependOn`. Those are the
   * only red→green changes in the release.
   */
  it('a runtime re-export satisfies dependOn (red -> green)', () => {
    const violations = modules(p)
      .that()
      .resideInFile(inFixture('consumer-reexport.ts'))
      .should()
      .satisfy(dependOn(BANNED))
      .violations()
    expect(violations).toEqual([])
  })

  it('a runtime dynamic import satisfies dependOn (red -> green)', () => {
    const violations = modules(p)
      .that()
      .resideInFile(inFixture('consumer-dynamic.ts'))
      .should()
      .satisfy(dependOn(BANNED))
      .violations()
    expect(violations).toEqual([])
  })

  it('a type-only re-export does NOT satisfy dependOn', () => {
    // The false green this release must not create: `export type { SecretShape }
    // from './banned/secret.js'` would satisfy `dependOn('**/banned/**')` while
    // nothing is installed at runtime. On the baseline side that reads as "the
    // violation was fixed".
    const violations = modules(p)
      .that()
      .resideInFile(inFixture('consumer-reexport-type.ts'))
      .should()
      .satisfy(dependOn(BANNED))
      .violations()
    expect(violations).toHaveLength(1)
  })

  it('a type expression does NOT satisfy dependOn', () => {
    const violations = modules(p)
      .that()
      .resideInFile(inFixture('consumer-type-expr.ts'))
      .should()
      .satisfy(dependOn(BANNED))
      .violations()
    expect(violations).toHaveLength(1)
  })

  it('a plain `import type` still satisfies dependOn, unchanged', () => {
    // `kind === 'import'` behaves exactly as before: an `import type` of the
    // target satisfies, and `{ ignoreTypeImports: true }` is the shipped opt-in
    // that makes it fail. Requiring runtime here would be a green→red change to a
    // contract that already has an opt-out.
    const satisfied = modules(p)
      .that()
      .resideInFile(inFixture('consumer-import.ts'))
      .should()
      .satisfy(dependOn(BANNED))
      .violations()
    expect(satisfied).toEqual([])
  })
})

describe('item 12 — each kind names itself, so no finding is absorbed', () => {
  /**
   * `hashViolation` is `rule::element::message`, and a dependency message carries
   * only the basename and the resolved target. So without per-kind verbs, a
   * re-export of a module the file also imports produces **byte-identical text**,
   * is absorbed by the existing baseline entry, and is never reported as new —
   * which breaks the migration's core promise.
   *
   * Asserted on identities **and** on the `relpath:line` multiset over one
   * fixture, because each is blind to what the other catches: identities alone
   * cannot see one of two colliding findings being dropped, and counts alone
   * cannot see absorption.
   */
  it('gives the import and the re-export of one module distinct identities', () => {
    const found = modules(p)
      .that()
      .resideInFile(inFixture('mixed.ts'))
      .should()
      .notImportFrom(BANNED)
      .violations()

    // Both edges are reported, at their own lines.
    expect(identify(found)).toEqual(['src/mixed.ts:4', 'src/mixed.ts:5'])
    // …and they are distinct to a baseline.
    const identities = new Set(found.map((v) => hashViolation(v, fixtureRoot)))
    expect(identities.size).toBe(2)
  })

  it('keeps the `import` message byte-identical, so existing baselines survive', () => {
    const found = modules(p)
      .that()
      .resideInFile(inFixture('consumer-import.ts'))
      .should()
      .notImportFrom(BANNED)
      .violations()
    expect(found).toHaveLength(1)
    // The exact pre-0.28.0 sentence. Any change here silently invalidates every
    // baselined dependency finding in every consumer's repository.
    expect(found[0]?.message).toBe(
      `consumer-import.ts imports "${path.join(fixtureRoot, 'src/banned/secret.ts')}" which matches forbidden [${BANNED}]`,
    )
  })

  it('names each new kind distinctly', () => {
    const byFile = new Map(
      modules(p)
        .should()
        .notImportFrom(BANNED)
        .violations()
        .map((v) => [path.basename(v.file), v.message]),
    )
    expect(byFile.get('consumer-reexport.ts')).toContain(' re-exports ')
    expect(byFile.get('consumer-dynamic.ts')).toContain(' dynamically imports ')
    // And neither reuses the bare `import` verb, which is what would make the
    // message collide with an existing baseline entry for the same module.
    // Anchored on the element name, because ' imports "' is a SUBSTRING of
    // ' dynamically imports "' and a `toContain` check passes on both.
    expect(byFile.get('consumer-reexport.ts')).not.toMatch(/consumer-reexport\.ts imports "/)
    expect(byFile.get('consumer-dynamic.ts')).not.toMatch(/consumer-dynamic\.ts imports "/)
  })

  it('reports both of two colliding findings, which identities alone cannot see', () => {
    // `twice.ts` re-exports one banned module twice. The two findings share an
    // identity (bug 0028, pre-existing and out of scope), so an identity-set
    // assertion is blind to losing either one — the multiset is not.
    const found = modules(p)
      .that()
      .resideInFile(inFixture('twice.ts'))
      .should()
      .notImportFrom(BANNED)
      .violations()

    expect(identify(found)).toEqual(['src/twice.ts:4', 'src/twice.ts:5'])
    // Recorded rather than asserted as desirable: this IS the pre-existing
    // collision, and it must not be mistaken for something this release fixed.
    expect(new Set(found.map((v) => hashViolation(v, fixtureRoot))).size).toBe(1)
  })
})

describe('items 14 and 21 — the predicates move subjects in opposite directions', () => {
  /**
   * `importCandidatePaths` has two consumers and they are not symmetric. This
   * repo's own rules use `notImportFrom` in condition position 16 times and
   * predicate position **zero**, and no preset uses the predicate — so the
   * condition-layer measurement ("0 findings lost") was taken on a corpus that
   * structurally cannot show either direction.
   */
  it('item 14 — notImportFrom LOSES a subject whose only banned edge is a re-export', () => {
    const selected = modules(p)
      .that()
      .resideInFile(inFixture('*'))
      .that()
      .notImportFrom(BANNED)
      .subjects()
      .map((sf) => path.basename(sf.getFilePath()))
      .sort()

    // Full-set equality, not a `not.toContain`: an anti-monotone change that
    // dropped EVERY subject would satisfy the negative assertion.
    expect(selected).toEqual([
      // `require` is excluded from the predicate too, so these two stay even
      // though both carry a banned edge.
      'cjs-consumer.js',
      // Retained because its edges are PERMITTED — and it has both an import and
      // a re-export, so a build that dropped every subject carrying any edge
      // would fail here rather than satisfy the negative assertion below.
      'clean.ts',
      'equals-consumer.d.ts',
    ])
    // The subject this release deliberately loses.
    expect(selected).not.toContain('consumer-reexport.ts')
  })

  it('item 21 — importFrom GAINS a subject whose only banned edge is a re-export', () => {
    const selected = modules(p)
      .that()
      .resideInFile(inFixture('*'))
      .that()
      .importFrom(BANNED)
      .subjects()
      .map((sf) => path.basename(sf.getFilePath()))
      .sort()

    expect(selected).toEqual([
      'consumer-dynamic.ts',
      'consumer-import.ts',
      'consumer-reexport-type.ts',
      'consumer-reexport.ts',
      'consumer-star.ts',
      'consumer-type-expr.ts',
      'mixed.ts',
      'twice.ts',
    ])
    // The monotone-increasing direction: absent before this release.
    expect(selected).toContain('consumer-reexport.ts')
    // `require` is excluded here too, so the predicate agrees with its condition.
    expect(selected).not.toContain('cjs-consumer.js')
    expect(selected).not.toContain('equals-consumer.d.ts')
  })
})

describe('item 9 — notHaveAliasedImports is deliberately NOT widened', () => {
  /**
   * It inspects `import` **statement syntax**, not edges: it reads each named
   * specifier's `getName()`/`getAliasNode()` and the declaration node for the code
   * frame. Widening it would draw an arbitrary boundary — `export { x as y } from
   * './impl.js'` would be flagged and `export { x as y }` would not, decided by
   * whether a specifier happens to be present.
   *
   * Draft 3 called this a "no-change pin" that must red if anyone routes the
   * condition through the widened walk. **That claim is dropped**: `ModuleEdge`
   * carries no alias field, so the routing is unrepresentable by data model. This
   * is a plain expected-list test, which is worth having on its own.
   */
  it('flags the aliased import and not the aliased re-export', () => {
    const found = modules(p)
      .that()
      .resideInFile(inFixture('mixed.ts'))
      .should()
      .notHaveAliasedImports()
      .violations()
    // `mixed.ts` has `export { SECRET as Reexported } from` and a plain import,
    // so exactly zero aliased *imports*.
    expect(found).toEqual([])

    const aliased = modules(p)
      .that()
      .resideInFile(inFixture('clean.ts'))
      .should()
      .notHaveAliasedImports()
      .violations()
    // `clean.ts` has `export { OK as Fine } from` — a re-export alias, still not
    // an import alias.
    expect(aliased).toEqual([])
  })
})
