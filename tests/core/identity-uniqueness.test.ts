/**
 * Two distinct findings never share a baseline identity — enforced as a mechanism, not
 * per family.
 *
 * `ArchViolation.identity`'s own docstring states the invariant: *"it must be unique per
 * finding within a rule: two distinct violations sharing one identity are one violation to the
 * baseline, and accepting either accepts both."* That was **prose with nothing behind it**, and
 * four separate defects were filed against it, each fixed only in the family that happened to
 * get reviewed:
 *
 * - [0028](../../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — two findings in one file
 * - [0063](../../bugs/fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md) — the dependency family, across files sharing a basename
 * - [0064](../../bugs/fixed/0064-a-dependency-identity-collides-across-two-spellings-of-one-module.md) — two spellings resolving to one module
 * - [0065](../../bugs/fixed/0065-reverse-dependency-findings-carry-no-identity.md) — the reverse family, which set no identity at all
 *
 * `disambiguateIdentities` runs in `applyFilters`, which every terminal shares, so a producer
 * cannot reintroduce this by forgetting — including a producer nobody has written yet. These
 * rows pin the two properties that make it safe to run over every rule:
 *
 * 1. **a unique subject is untouched** — which is what makes the migration empty; and
 * 2. **the first of a colliding group keeps its subject verbatim** — so the one entry an
 *    adopter's baseline *did* record still matches, and only the hidden sibling reports as new.
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { disambiguateIdentities } from '../../src/core/violation.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { hashViolation } from '../../src/helpers/baseline.js'

const real = (vs: ArchViolation[]): ArchViolation[] => vs.filter((v) => v.bypassFilters !== true)
const hashes = (vs: ArchViolation[]): number => new Set(vs.map((v) => hashViolation(v))).size

/** A violation with only the fields identity is built from. */
function violation(element: string, message: string, identity?: string): ArchViolation {
  return {
    rule: 'r',
    element,
    file: `/src/${element}`,
    line: 1,
    message,
    ...(identity !== undefined ? { identity } : {}),
  }
}

describe('the mechanism: only a collision is touched', () => {
  it('a unique subject is returned byte-identical — the theorem the empty migration rests on', () => {
    const input = [
      violation('a.ts', 'first'),
      violation('b.ts', 'second'),
      violation('c.ts', 'third', 'explicit'),
    ]
    const out = disambiguateIdentities(input)
    // Not merely equal — the SAME objects, so nothing downstream can observe a rewrite.
    expect(out).toBe(input)
    expect(out.map((v) => v.identity)).toEqual([undefined, undefined, 'explicit'])
  })

  it('the FIRST of a colliding pair keeps its subject; only the second moves', () => {
    // This is the whole migration story. An adopter's baseline holds one entry for the pair,
    // recorded under the bare subject — that entry must still match, or a fix for a fail-open
    // becomes a mass false-red.
    const out = disambiguateIdentities([violation('x.ts', 'same'), violation('x.ts', 'same')])
    expect(out[0]?.identity).toBeUndefined()
    expect(out[1]?.identity).toBe('x.ts::same#1')
    expect(hashes(out)).toBe(2)
  })

  it('a third and fourth sibling keep counting', () => {
    const out = disambiguateIdentities([
      violation('x.ts', 'same'),
      violation('x.ts', 'same'),
      violation('x.ts', 'same'),
    ])
    expect(out.map((v) => v.identity)).toEqual([undefined, 'x.ts::same#1', 'x.ts::same#2'])
    expect(hashes(out)).toBe(3)
  })

  it('a generated suffix never lands on a subject a producer already emits', () => {
    // THREE members of the colliding group, not two, and that is the whole point of the row.
    //
    // With two, the reservation is never exercised: only ONE candidate is generated, so
    // deleting `taken.add(...)` changes nothing and the mutation survives the entire suite.
    // Measured on `[X, X, X, X#1]` — with the reservation `X, X#2, X#3, X#1` (4 distinct);
    // without it `X, X#2, X#2, X#1`, which reintroduces the collision this function exists to
    // remove. The guard for a defect has to reach the second iteration of the loop that
    // causes it.
    const out = disambiguateIdentities([
      violation('a.ts', 'm', 'X'),
      violation('b.ts', 'm', 'X'),
      violation('c.ts', 'm', 'X'),
      violation('d.ts', 'm', 'X#1'),
    ])
    expect(out.map((v) => v.identity)).toEqual(['X', 'X#2', 'X#3', 'X#1'])
    expect(hashes(out)).toBe(4)
  })

  it('two findings under DIFFERENT rules are not a collision, and neither moves', () => {
    // `hashViolation` is `rule::subject`, so these already hash apart and were never ambiguous.
    // The first draft grouped on the subject alone and suffixed the second anyway — moving a
    // baseline entry that had no collision, which is precisely the failure this mechanism
    // exists to prevent, committed by the mechanism.
    //
    // Reachable by construction: several builders mix `metadata?.id ?? description` with a
    // bare `description` inside one batch. Asserted with two rule strings because a fixture
    // sharing `rule` agrees under either grouping and proves nothing.
    const a: ArchViolation = { ...violation('x.ts', 'same'), rule: 'rule one' }
    const b: ArchViolation = { ...violation('x.ts', 'same'), rule: 'rule two' }
    expect(hashViolation(a)).not.toBe(hashViolation(b)) // distinct BEFORE the mechanism runs

    const out = disambiguateIdentities([a, b])
    expect(out.map((v) => v.identity)).toEqual([undefined, undefined])
  })

  it('and a collision WITHIN one rule still separates when another rule shares the subject', () => {
    // The pair under `rule one` collides and must separate; the lone `rule two` finding shares
    // their subject but not their rule, so it must be left alone. This is the row that fails if
    // the group key drops `rule` in either direction.
    const out = disambiguateIdentities([
      { ...violation('x.ts', 'same'), rule: 'rule one' },
      { ...violation('x.ts', 'same'), rule: 'rule one' },
      { ...violation('x.ts', 'same'), rule: 'rule two' },
    ])
    expect(out.map((v) => v.identity)).toEqual([undefined, 'x.ts::same#1', undefined])
    expect(hashes(out)).toBe(3)
  })

  it('the mechanism and the hash read the same subject — one definition, not two', () => {
    // `hashViolation` now CALLS `subjectOf` rather than spelling the formula out again. The
    // first draft kept a private copy in `core/` on the reasoning that `core/` must not depend
    // on `helpers/` — true, but the dependency runs the other way, and `helpers/baseline.ts`
    // already imported from `core/`. A copy plus a test that the copies agree was strictly
    // worse: the test could only compare them over a fixture it built, and that fixture shared
    // every field, so it agreed under any formula at all.
    const a = violation('same.ts', 'msg')
    const b = violation('same.ts', 'msg')
    expect(hashViolation(a)).toBe(hashViolation(b))
    const out = disambiguateIdentities([a, b])
    expect(hashViolation(out[0]!)).not.toBe(hashViolation(out[1]!))
  })
})

describe('bug 0064: two spellings that resolve to one module', () => {
  /** `@app/*` and a relative path both reach `/src/legacy/index.ts`. */
  function aliased(featureBody: string): ArchProject {
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ESNext,
        baseUrl: '/',
        paths: { '@app/*': ['src/*'] },
      },
    })
    tsm.createSourceFile('/src/legacy/index.ts', `export const old = 1\nexport default old\n`)
    tsm.createSourceFile('/src/feature/index.ts', `${featureBody}\nexport const fresh = 1\n`)
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
  }

  const notImportFrom = (p: ArchProject): ArchViolation[] =>
    real(
      modules(p)
        .that()
        .resideInFolder('**/src/feature/**')
        .should()
        .notImportFromCondition('**/src/legacy/**')
        .violations(),
    )

  // The identity keys on the RESOLVED path while every discriminator derives from the
  // SPECIFIER, so before the fix each of these was 2 findings sharing 1 hash.
  const SPELLINGS: ReadonlyArray<readonly [string, string]> = [
    [
      'dynamic',
      "export const a = () => import('../legacy/index.js')\nexport const b = () => import('@app/legacy/index.js')",
    ],
    [
      'named import (same symbol, two spellings)',
      "import { old } from '../legacy/index.js'\nimport { old as old2 } from '@app/legacy/index.js'\nexport const u = [old, old2]",
    ],
    [
      'default import',
      "import A from '../legacy/index.js'\nimport B from '@app/legacy/index.js'\nexport const u = [A, B]",
    ],
  ]

  it.each(SPELLINGS)('%s: the two spellings get distinct identities', (_label, body) => {
    const found = notImportFrom(aliased(body))
    expect(found).toHaveLength(2) // vacuity: 0 findings would satisfy every assertion below

    // Asserted by VALUE, not by counting distinct hashes. A count says "two things differ";
    // these say which one kept the pre-fix identity and which one gained the suffix, so a
    // change that separates them the *other* way round — moving the entry an adopter holds —
    // still fails. `scan-cardinality-assertions` exists to stop the count-only form.
    const ids = found.map((v) => v.identity)
    expect(ids[0]).not.toMatch(/#\d+$/)
    expect(ids[1]).toBe(`${ids[0] ?? ''}#1`)
    expect(hashes(found)).toBe(2)
  })

  it('and the first spelling keeps the identity a pre-fix baseline recorded', () => {
    // The pair shared one entry, hashed from the FIRST finding's subject. That entry must
    // still match after the fix, or every adopter with this layout gets a false red.
    const found = notImportFrom(
      aliased(
        "export const a = () => import('../legacy/index.js')\nexport const b = () => import('@app/legacy/index.js')",
      ),
    )
    expect(found[0]?.identity).toBe('/src/feature/index.ts::dynamic::/src/legacy/index.ts::')
    expect(found[1]?.identity).toBe('/src/feature/index.ts::dynamic::/src/legacy/index.ts::#1')
  })
})

describe('bug 0065: two files sharing a basename', () => {
  /** Two orphans named `index.ts`, plus one importer so the rule is not vacuous. */
  function twoOrphans(): ArchProject {
    const tsm = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    })
    tsm.createSourceFile('/src/a/index.ts', `export const a = 1\n`)
    tsm.createSourceFile('/src/b/index.ts', `export const b = 1\n`)
    tsm.createSourceFile('/src/used/index.ts', `export const used = 1\n`)
    tsm.createSourceFile(
      '/src/main.ts',
      `import { used } from './used/index.js'\nexport const m = used\n`,
    )
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
  }

  it('beImported reports both orphans with distinct hashes', () => {
    // Before the fix: `identity` was undefined, so `hashViolation` fell back to
    // `element::message` — and both are the basename `index.ts` with a message built from it.
    // 2 findings, 1 hash, and baselining one dead `index.ts` pre-accepted every future one.
    const found = real(
      modules(twoOrphans()).that().resideInFolder('**/src/**').should().beImported().violations(),
    )
    const orphans = found.filter((v) => v.element === 'index.ts')
    expect(orphans).toHaveLength(2)

    // By value rather than by count: the two orphans are different FILES reported under the
    // same basename, so the thing that must differ is the identity, and the second must be
    // the suffixed one. A distinct-hash count would also pass if the fix had separated them
    // by rewriting the first — which is the outcome that breaks every existing baseline.
    expect(orphans.map((v) => v.file)).toEqual(['/src/a/index.ts', '/src/b/index.ts'])
    expect(orphans[0]?.identity).toBeUndefined()
    expect(orphans[1]?.identity).toBe('index.ts::index.ts is not imported by any other module#1')
    expect(hashes(orphans)).toBe(2)
  })

  it('and the first orphan keeps the identity a pre-fix baseline recorded', () => {
    const found = real(
      modules(twoOrphans()).that().resideInFolder('**/src/**').should().beImported().violations(),
    )
    const orphans = found.filter((v) => v.element === 'index.ts')
    // Unchanged: no identity set, so it still hashes as `element::message`.
    expect(orphans[0]?.identity).toBeUndefined()
    expect(orphans[1]?.identity?.endsWith('#1')).toBe(true)
  })
})
