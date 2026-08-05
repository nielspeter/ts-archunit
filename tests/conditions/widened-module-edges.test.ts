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
import { Project } from 'ts-morph'
import { edgesOf, type ModuleEdge } from '../../src/core/module-edges.js'

const fixtureRoot = path.join(import.meta.dirname, '../fixtures/module-edge-conditions')
const p = project(path.join(fixtureRoot, 'tsconfig.json'))

/** The raw edges of one fixture file, for asserting a test's own premise. */
const tsProject = new Project({ tsConfigFilePath: path.join(fixtureRoot, 'tsconfig.json') })
const edgesOfFixture = (name: string): readonly ModuleEdge[] =>
  edgesOf(tsProject.getSourceFileOrThrow(name))

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
      // Two static imports of one target from one file — the reverse graph's
      // dedup shape (item 20), and both are forward findings.
      'src/imports-twice.ts:5',
      'src/imports-twice.ts:6',
      // The aliased import added for item 9. Line 11 sorts before line 4 because
      // `identify` compares the strings, not the numbers.
      'src/mixed.ts:11',
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
    // The premise, asserted on the EDGE. This used to assert
    // `resideInFile(...).notExist()` → 1, which proves only that the file is in the
    // program: edit the `require` line out of the fixture and it stayed green while
    // asserting nothing.
    expect(found.length).toBeGreaterThan(0)
    for (const name of ['cjs-consumer.js', 'equals-consumer.d.ts']) {
      expect(
        edgesOfFixture(name).some(
          (e) => e.kind === 'require' && e.resolvedPath?.includes('/banned/') === true,
        ),
      ).toBe(true)
    }
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
    // For a re-export, `export type { X } from` erases the edge AND removes a
    // runtime export consumers may import as a value, so the reader has to be told
    // before following it (ADR-008 rule 2).
    const found = modules(p).should().onlyHaveTypeImportsFrom(BANNED).violations()
    const reexport = found.find((v) => v.file.endsWith('consumer-reexport.ts'))

    expect(reexport?.suggestion).toContain('export type')
    expect(reexport?.suggestion).toContain('removes a runtime export')
  })

  /**
   * The condition must NOT set a remedy for `kind === 'import'`.
   *
   * `execute-rule.ts` resolves `v.suggestion ?? meta?.suggestion`, so a
   * producer-set remedy **wins** over the rule author's. Setting one for `import`
   * replaced the shipped `layered/type-imports-only` remedy — which offers "or move
   * the value you need into a layer this one is allowed to depend on", the only
   * followable action when the value is needed at runtime — with a one-option
   * remedy, and silently discarded any consumer's own `.rule({ suggestion })`.
   *
   * Invisible to every message-identity guard, because `suggestion` is not hashed.
   */
  it('does not override the rule author`s remedy for a plain import', () => {
    const authored = 'MY OWN REMEDY — move the value into a permitted module.'
    const found = modules(p)
      .that()
      .resideInFile(inFixture('consumer-import.ts'))
      .should()
      .onlyHaveTypeImportsFrom(BANNED)
      .rule({ id: 'authored', suggestion: authored })
      .violations()

    expect(found).toHaveLength(1)
    // The author's text survives resolution — this is the whole property. Before
    // the fix it was replaced by `edgeTypeOnlyRemedy('import')`.
    expect(found[0]?.suggestion).toBe(authored)

    // With no authored remedy the slot stays empty, so the condition is injecting
    // nothing rather than injecting something that happens to match.
    const bare = modules(p)
      .that()
      .resideInFile(inFixture('consumer-import.ts'))
      .should()
      .onlyHaveTypeImportsFrom(BANNED)
      .violations()
    expect(bare[0]?.suggestion).toBeUndefined()

    // …while a re-export in the same run DOES get one, so the split is real.
    const reexport = modules(p)
      .that()
      .resideInFile(inFixture('consumer-reexport.ts'))
      .should()
      .onlyHaveTypeImportsFrom(BANNED)
      .rule({ id: 'authored-2', suggestion: authored })
      .violations()
    expect(reexport[0]?.suggestion).toContain('export type')
  })

  it('gives a STAR re-export a remedy it can actually follow', () => {
    // `export type { … } from` is unfollowable for `export * from`: filling in the
    // braces means enumerating the target's entire export list, which an agent
    // will invent rather than look up. `export type * from` is the one-token fix.
    const star = modules(p)
      .should()
      .onlyHaveTypeImportsFrom(BANNED)
      .violations()
      .find((v) => v.file.endsWith('consumer-star.ts'))

    expect(star?.suggestion).toContain('export type * from')
    expect(star?.suggestion).not.toContain('export type { … } from')
  })

  it('makes the sentence agree with itself, per kind', () => {
    // `edgeValuePhrase` was per-kind and the tail was not, so a re-export read
    // "has a runtime re-export of … which should be a type-only IMPORT".
    const found = modules(p).should().onlyHaveTypeImportsFrom(BANNED).violations()
    const reexport = found.find((v) => v.file.endsWith('consumer-reexport.ts'))
    const staticImport = found.find((v) => v.file.endsWith('consumer-import.ts'))

    expect(reexport?.message).toContain('runtime re-export of')
    expect(reexport?.message).toContain('should be a type-only re-export')
    expect(staticImport?.message).toContain('a value import from')
    expect(staticImport?.message).toContain('should be a type-only import')
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
    // The identity, not the count — and here the count was actively dangerous.
    // A configuration finding is also exactly one violation, so if this fixture
    // is ever renamed or `inFixture`'s glob drifts, the selector matches nothing,
    // the dead-glob gate emits its single finding, and `toHaveLength(1)` accepts
    // it. Measured: with the fixture deleted this block exited 0 and reported
    // "2 passed" — the condition never ran, in the test whose own comment above
    // names the false green it exists to prevent (plan 0079, found by review).
    expect(identify(violations)).toEqual(['src/consumer-reexport-type.ts:1'])
  })

  it('a type expression does NOT satisfy dependOn', () => {
    const violations = modules(p)
      .that()
      .resideInFile(inFixture('consumer-type-expr.ts'))
      .should()
      .satisfy(dependOn(BANNED))
      .violations()
    // Same trap as the block above: a dead selector also yields exactly one.
    expect(identify(violations)).toEqual(['src/consumer-type-expr.ts:1'])
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

    // Three edges: two imports (lines 4 and 11) and a re-export (line 5).
    expect(identify(found)).toEqual(['src/mixed.ts:11', 'src/mixed.ts:4', 'src/mixed.ts:5'])

    // **Two** identities, not three — and that is the honest number. The two
    // IMPORTS of the same module produce byte-identical messages and therefore one
    // hash: that is bug 0028, pre-existing and out of scope here, and it must not be
    // mistaken for something this release fixed.
    //
    // What §4 DOES fix is the third: the re-export no longer collides with either
    // import, because its verb differs. Asserted as the pair below rather than a
    // bare count, so the distinction cannot be lost by a future edit.
    const identityOf = (line: number): string | undefined => {
      const v = found.find((x) => x.line === line)
      return v === undefined ? undefined : hashViolation(v, fixtureRoot)
    }
    // THREE identities — and this row used to assert two.
    //
    // The re-export at line 5 was always distinct from both imports (that is §4's verb,
    // the collision bug 0028 mattered most for). The two IMPORTS at lines 4 and 11 used
    // to share one, because `names` is the INWARD name and `import { SECRET }` /
    // `import { SECRET as Hidden }` both carry `['SECRET']`. This row asserted that
    // residual deliberately — *"asserted rather than glossed, so the residual cannot be
    // mistaken for a fix"* — and said separating them needed the local binding, which
    // `ModuleEdge` does not carry.
    //
    // It does not need the local binding. `disambiguateIdentities` closes it without one
    // ([bug 0064](../../bugs/fixed/0064-a-dependency-identity-collides-across-two-spellings-of-one-module.md)):
    // the second finding of any duplicated subject gains a `#n` suffix, so the pair
    // separates by position rather than by a field nobody had. The guard fired on the
    // change it was written to notice, which is why it is updated here rather than
    // deleted — and line 4 keeps its identity verbatim, so nothing an adopter accepted
    // moved.
    expect(new Set(found.map((v) => hashViolation(v, fixtureRoot))).size).toBe(3)
    expect(identityOf(4)).not.toBe(identityOf(11))
    expect(identityOf(5)).not.toBe(identityOf(4))
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

  it('gives two re-exports of one module distinct identities (bug 0028, now fixed)', () => {
    // `twice.ts` re-exports one banned module twice — `{ SECRET }` and
    // `{ SECRET as Again }`. Until bug 0028 was fixed these shared one identity,
    // because the message carries only the basename and the resolved target, so you
    // could not accept one and keep failing on the other.
    const found = modules(p)
      .that()
      .resideInFile(inFixture('twice.ts'))
      .should()
      .notImportFrom(BANNED)
      .violations()

    expect(identify(found)).toEqual(['src/twice.ts:4', 'src/twice.ts:5'])
    // Distinct now, via the imported names in `identity`.
    expect(new Set(found.map((v) => hashViolation(v, fixtureRoot))).size).toBe(2)
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
      // Its only edge is a bare `import('node:path')`, which matches no banned
      // glob, so it is retained.
      'bare-dynamic.ts',
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
      'imports-twice.ts',
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
    // `mixed.ts` carries BOTH shapes: `import { SECRET as Hidden } from` and
    // `export { SECRET as Reexported } from`. Exactly one is an import alias.
    //
    // This block used to make two `toEqual([])` assertions against a fixture with no
    // aliased import in it at all — so `notHaveAliasedImports` could have returned
    // `[]` unconditionally and it passed, under a title promising a positive finding.
    const found = modules(p)
      .that()
      .resideInFile(inFixture('mixed.ts'))
      .should()
      .notHaveAliasedImports()
      .violations()

    expect(found).toHaveLength(1)
    expect(found[0]?.message).toContain('aliases "SECRET" as "Hidden"')
    // The re-export alias in the same file is NOT flagged — the arbitrary boundary
    // this condition deliberately does not cross.
    expect(found[0]?.message).not.toContain('Reexported')

    // A file whose only alias is a re-export reports nothing.
    const reexportOnly = modules(p)
      .that()
      .resideInFile(inFixture('clean.ts'))
      .should()
      .notHaveAliasedImports()
      .violations()
    expect(reexportOnly).toEqual([])
  })
})

/**
 * `onlyImportFrom` — the condition the whole release is measured by, and until this
 * block it was **completely unguarded**.
 *
 * Measured: reverting its loop to `if (edge.kind !== 'import') continue` left all
 * 2556 tests green, exit 0, no failing file. Its three siblings all fail their own
 * un-widening (`notImportFrom` 7 tests, `dependOn` 2, `onlyHaveTypeImportsFrom` 2);
 * this one failed nothing, because not one of the six new test files invoked it.
 *
 * It is the condition behind `preset/boundaries/no-cross-boundary` and
 * `preset/layered/restricted-packages` — i.e. `strictBoundaries` and `layered` —
 * and the green→red monotone direction that produces the findings a consumer
 * actually sees on upgrade.
 */
describe('onlyImportFrom sees every kind (the release`s headline condition)', () => {
  it('reports every kind that is not on the allowlist', () => {
    const found = modules(p).should().onlyImportFrom(inFixture('allowed/*')).violations()

    expect(identify(found)).toEqual([
      'src/bare-dynamic.ts:9',
      'src/consumer-dynamic.ts:2',
      'src/consumer-import.ts:1',
      'src/consumer-reexport-type.ts:2',
      'src/consumer-reexport.ts:3',
      'src/consumer-star.ts:2',
      'src/consumer-type-expr.ts:2',
      'src/imports-twice.ts:5',
      'src/imports-twice.ts:6',
      'src/mixed.ts:11',
      'src/mixed.ts:4',
      'src/mixed.ts:5',
      'src/twice.ts:4',
      'src/twice.ts:5',
    ])
    // `require`, both spellings, stay excluded here too — the same set as its
    // siblings, or the two definitions of "an import" are back.
    expect(identify(found)).not.toContain('src/cjs-consumer.js:3')
    expect(identify(found)).not.toContain('src/equals-consumer.d.ts:3')
  })

  it('names each kind with its own verb, so no finding is absorbed', () => {
    const byFile = new Map(
      modules(p)
        .should()
        .onlyImportFrom(inFixture('allowed/*'))
        .violations()
        .map((v) => [path.basename(v.file), v.message]),
    )
    expect(byFile.get('consumer-reexport.ts')).toContain(' re-exports ')
    expect(byFile.get('consumer-dynamic.ts')).toContain(' dynamically imports ')
    expect(byFile.get('consumer-type-expr.ts')).toContain(' references the type from ')
    // Anchored on the element name: ' imports "' is a substring of ' dynamically
    // imports "', so a bare toContain passes on both.
    expect(byFile.get('consumer-reexport.ts')).not.toMatch(/consumer-reexport\.ts imports "/)
  })

  it('keeps the `import` sentence byte-identical, so existing baselines survive', () => {
    const found = modules(p)
      .that()
      .resideInFile(inFixture('consumer-import.ts'))
      .should()
      .onlyImportFrom(inFixture('allowed/*'))
      .violations()
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toBe(
      `consumer-import.ts imports "${path.join(fixtureRoot, 'src/banned/secret.ts')}" ` +
        `which does not match any of [${inFixture('allowed/*')}]`,
    )
  })

  /**
   * Item 17. A **bare** dynamic import, in both option states.
   *
   * `import('node:path')` does not resolve here, so `resolvedPath` is `undefined`
   * and the specifier as written is the only candidate. Draft 3 specified
   * `import('picomatch')` for this — measured, that RESOLVES, because it is a
   * direct dependency with `@types/picomatch` installed, so it carries two
   * candidates and is the worst possible choice of example.
   */
  it('item 17 — reports a bare unresolved dynamic import by its specifier', () => {
    const strict = modules(p)
      .that()
      .resideInFile(inFixture('bare-dynamic.ts'))
      .should()
      .onlyImportFrom(inFixture('allowed/*'))
      .violations()
    const lenient = modules(p)
      .that()
      .resideInFile(inFixture('bare-dynamic.ts'))
      .should()
      .onlyImportFromWithOptions([inFixture('allowed/*')], { ignoreTypeImports: true })
      .violations()

    for (const found of [strict, lenient]) {
      expect(found).toHaveLength(1)
      // The SPECIFIER, not a resolved path — there is no resolved path. A dynamic
      // import is always runtime, so the option state cannot change this.
      expect(found[0]?.message).toContain('"node:path"')
      expect(found[0]?.message).not.toContain('node_modules')
    }
  })

  it('the erased kinds drop out under ignoreTypeImports, and the runtime ones do not', () => {
    const lenient = identify(
      modules(p)
        .should()
        .onlyImportFromWithOptions([inFixture('allowed/*')], { ignoreTypeImports: true })
        .violations(),
    )
    expect(lenient).not.toContain('src/consumer-reexport-type.ts:2')
    expect(lenient).not.toContain('src/consumer-type-expr.ts:2')
    expect(lenient).not.toContain('src/imports-twice.ts:6')
    expect(lenient).toContain('src/consumer-reexport.ts:3')
    expect(lenient).toContain('src/consumer-dynamic.ts:2')
    expect(lenient).toHaveLength(11)
  })
})

/**
 * §4's per-kind message contract, applied to the **second** condition.
 *
 * Item 12 pins `edgeVerb` for `notImportFrom`. Nothing pinned `edgeValuePhrase` or
 * `edgeVerb('type-expression')`, and three reverts were measured green against the
 * whole 2556-test suite:
 *
 * | revert                                                  | consequence                            |
 * | ------------------------------------------------------- | -------------------------------------- |
 * | `edgeValuePhrase('reexport')` → `'a value import from'` | `mixed.ts` 3 findings, one MORE collision |
 * | `edgeValuePhrase('import')` → anything else             | every baselined finding invalidated    |
 * | `edgeVerb('type-expression')` → `'imports'`             | collides with the `import` finding     |
 *
 * The first is §4's absorption failure verbatim, and this condition is reachable
 * from the shipped `preset/layered/type-imports-only`.
 */
describe('onlyHaveTypeImportsFrom names each kind too', () => {
  it('keeps the re-export distinct from the imports of the same module', () => {
    const found = modules(p)
      .that()
      .resideInFile(inFixture('mixed.ts'))
      .should()
      .onlyHaveTypeImportsFrom(BANNED)
      .violations()

    expect(identify(found)).toEqual(['src/mixed.ts:11', 'src/mixed.ts:4', 'src/mixed.ts:5'])
    const identityOf = (line: number): string | undefined => {
      const v = found.find((x) => x.line === line)
      return v === undefined ? undefined : hashViolation(v, fixtureRoot)
    }
    // The two imports are now distinct: `names` is the inward name so an alias does not
    // separate them, but `disambiguateIdentities` suffixes the second occurrence of a
    // duplicated subject, which does (bug 0064). This row asserted the collision until
    // that landed.
    //
    // An earlier version of this comment claimed the second assertion catches a revert of
    // `edgeValuePhrase('reexport')` to the import phrase. **Measured: it does not.** The
    // re-export is distinct because `edge.kind` is a component of the identity, never because
    // of the verb — the verb is not in the hash at all. And once all three share a subject the
    // mechanism hands them `bare`, `#1`, `#2`, so the assertion is satisfied by disambiguation
    // rather than by anything this row is about. The revert still reds the file, via
    // `item 19b`. Recorded rather than deleted because the claim was restated with fresh
    // authority in the commit that rewrote this comment, in a project whose own rule is to run
    // the sabotage before asserting its result.
    expect(identityOf(4)).not.toBe(identityOf(11))
    expect(identityOf(5)).not.toBe(identityOf(4))
  })

  it('keeps the `import` sentence byte-identical, so existing baselines survive', () => {
    const found = modules(p)
      .that()
      .resideInFile(inFixture('consumer-import.ts'))
      .should()
      .onlyHaveTypeImportsFrom(BANNED)
      .violations()
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toBe(
      `consumer-import.ts has a value import from ` +
        `"${path.join(fixtureRoot, 'src/banned/secret.ts')}" which should be a type-only import`,
    )
  })

  it('gives type-expression its own verb, distinct from an import of the same target', () => {
    const typeExpr = modules(p)
      .that()
      .resideInFile(inFixture('consumer-type-expr.ts'))
      .should()
      .notImportFrom(BANNED)
      .violations()
    const plain = modules(p)
      .that()
      .resideInFile(inFixture('consumer-import.ts'))
      .should()
      .notImportFrom(BANNED)
      .violations()

    expect(typeExpr[0]?.message).toContain(' references the type from ')
    expect(typeExpr[0]?.message).not.toMatch(/consumer-type-expr\.ts imports "/)
    expect(typeExpr[0]?.message).not.toBe(plain[0]?.message)
  })
})
