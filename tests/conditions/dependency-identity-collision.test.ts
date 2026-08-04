/**
 * Two files sharing a basename are two findings —
 * [bug 0063](../../bugs/fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md).
 *
 * `ArchViolation.identity` states the requirement in these words: *"it must be unique per
 * finding within a rule: two distinct violations sharing one identity are one violation to
 * the baseline, and accepting either accepts both."* The dependency family broke it two
 * different ways, and **all 3089 tests passed while it did** — the collision was untested,
 * which is why it survived from bug 0028 until a review of v0.52.0 went looking.
 *
 * ## Two mechanisms, which is why one row cannot stand for both
 *
 *  - **`notImportFrom` / `onlyImportFrom` / the type-only check** set an identity whose only
 *    non-edge component was `sourceFile.getBaseName()`. Every other part is a property of
 *    the edge, so the basename was the sole thing identifying the file — and it does not.
 *  - **`dependOn`** set **no identity at all**. Its element is a basename and its message
 *    never names the file, so `element::message` collided too, with nothing to correct.
 *
 * Both measured at `findings=2, distinct=1` before the fix, on the commonest layout there
 * is: sibling folders each with an `index.ts`.
 */
import { describe, it, expect } from 'vitest'
import { Project, ts } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { dependOn, notHaveAliasedImports } from '../../src/conditions/dependency.js'
import { hashViolation } from '../../src/helpers/baseline.js'

/** Two sibling folders, each with an `index.ts`, plus a target they may or may not use. */
function siblings(alpha: string, beta: string, target = 'export const x = 1\n'): ArchProject {
  const tsm = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { module: ts.ModuleKind.ESNext },
  })
  tsm.createSourceFile('/src/legacy/index.ts', target)
  tsm.createSourceFile('/src/features/alpha/index.ts', alpha)
  tsm.createSourceFile('/src/features/beta/index.ts', beta)
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

const real = (vs: ArchViolation[]): ArchViolation[] => vs.filter((v) => v.bypassFilters !== true)
const noDuplicates = (vs: ArchViolation[]): void => {
  const hashes = vs.map((v) => hashViolation(v))
  expect(hashes).toEqual([...new Set(hashes)])
}

describe('the identity-setting path (bug 0063)', () => {
  it('notImportFrom: two same-basename files crossing the SAME edge are distinct', () => {
    // Identical in every component the old identity looked at: basename, edge kind, resolved
    // target, and the names crossing it. Only the source path differs.
    const importIt = "export { x } from '../../legacy/index.js'\n"
    const found = real(
      modules(siblings(importIt, importIt))
        .that()
        .resideInFolder('**/src/features/**')
        .should()
        .notImportFromCondition('**/src/legacy/**')
        .rule({ id: 'test/no-legacy', because: 'legacy is being retired' })
        .violations(),
    )

    // Non-vacuity first: a 1-of-1 or 0-of-0 comparison proves nothing.
    expect(found.map((v) => v.file)).toEqual([
      '/src/features/alpha/index.ts',
      '/src/features/beta/index.ts',
    ])
    noDuplicates(found)
  })

  it('the identity names the file, and does not name a line', () => {
    const importIt = "export { x } from '../../legacy/index.js'\n"
    const found = real(
      modules(siblings(importIt, importIt))
        .that()
        .resideInFolder('**/src/features/**')
        .should()
        .notImportFromCondition('**/src/legacy/**')
        .rule({ id: 'test/no-legacy', because: 'x' })
        .violations(),
    )
    for (const v of found) {
      expect(v.identity).toContain(v.file)
      // A coordinate is what `identity` exists to survive; the scheme deliberately omits it.
      expect(v.identity).not.toMatch(/:\d+$/)
    }
  })
})

describe('the path with NO identity — bug 0063’s worse half', () => {
  it('dependOn: two same-basename files failing the same requirement are distinct', () => {
    // Neither file imports the target, so both fail. The element is the basename and the
    // message never names the file, so before this fix `element::message` was identical.
    const found = real(
      modules(siblings('export const a = 1\n', 'export const b = 1\n'))
        .that()
        .resideInFolder('**/src/features/**')
        .should()
        .satisfy(dependOn('**/src/legacy/**'))
        .rule({ id: 'test/must-log', because: 'every feature must use the logger' })
        .violations(),
    )

    expect(found.map((v) => v.file)).toEqual([
      '/src/features/alpha/index.ts',
      '/src/features/beta/index.ts',
    ])
    noDuplicates(found)
  })

  it('dependOn: the same file failing two different glob sets is two findings', () => {
    // Why the globs are part of the identity: this finding is about a REQUIREMENT not met
    // rather than about an edge, so the same file can fail more than one of them. Without
    // the globs, one rule carrying two `dependOn` conditions would collapse them.
    const p = siblings('export const a = 1\n', 'export const b = 1\n')
    const run = (glob: string): ArchViolation[] =>
      real(
        modules(p)
          .that()
          .resideInFolder('**/src/features/**')
          .should()
          .satisfy(dependOn(glob))
          .rule({ id: 'test/must', because: 'x' })
          .violations(),
      )
    const legacy = run('**/src/legacy/**')
    const other = run('**/src/nowhere/**')
    // By identity: which files failed which requirement.
    expect(legacy.map((v) => v.file)).toEqual([
      '/src/features/alpha/index.ts',
      '/src/features/beta/index.ts',
    ])
    expect(other.map((v) => v.file)).toEqual(legacy.map((v) => v.file))
    // Same files, different requirement — different identities.
    expect(hashViolation(other[0]!)).not.toBe(hashViolation(legacy[0]!))
  })
})

describe('the THIRD mechanism, which a control row was written to rule out', () => {
  it('notHaveAliasedImports: two same-basename files aliasing the same import are distinct', () => {
    // **This row began life as a CONTROL asserting the opposite**, on the reasoning that the
    // message "names the specifier" so `element::message` already separated the two files. It
    // names the *alias*, which both files share equally — so the row disproved the scope it
    // was written to pin, and the bug report was wrong about its own extent for the second
    // time in one sitting.
    //
    // Worth keeping the history in the comment: a control that fails is more informative than
    // a control that passes, and this one turned a two-mechanism bug into a three-mechanism
    // one after the first two were already fixed.
    const aliased =
      "import { x as renamed } from '../../legacy/index.js'\nexport const u = renamed\n"
    const found = real(
      modules(siblings(aliased, aliased))
        .that()
        .resideInFolder('**/src/features/**')
        .should()
        .satisfy(notHaveAliasedImports())
        .rule({ id: 'test/no-alias', because: 'aliases hide the dependency' })
        .violations(),
    )
    expect(found.map((v) => v.file)).toEqual([
      '/src/features/alpha/index.ts',
      '/src/features/beta/index.ts',
    ])
    noDuplicates(found)
  })

  it('two DIFFERENT aliases in one file are still two findings', () => {
    // The in-file half, which bug 0028 established for its own family: the identity must
    // separate siblings within a file as well as across files.
    const two =
      "import { x as one, y as two } from '../../legacy/index.js'\nexport const u = one + two\n"
    const found = real(
      modules(siblings(two, 'export const b = 1\n', 'export const x = 1\nexport const y = 2\n'))
        .that()
        .resideInFolder('**/src/features/**')
        .should()
        .satisfy(notHaveAliasedImports())
        .rule({ id: 'test/no-alias', because: 'x' })
        .violations(),
    )
    // Which two, not how many — plan 0079's scanner flagged the count form in this file,
    // for the second time today. The messages name the aliases, so they are the identities.
    expect(found.map((v) => v.message.replace(/^\S+ /, ''))).toEqual([
      'aliases "x" as "one"',
      'aliases "y" as "two"',
    ])
    noDuplicates(found)
  })
})

describe('MIGRATION, measured (bug 0063)', () => {
  it('the identity-setting path’s hashes move, and only because of the source path', () => {
    // What the upgrade note claims, as a measurement. The pre-0063 identity is reconstructible
    // by swapping the file path back for the basename.
    const importIt = "export { x } from '../../legacy/index.js'\n"
    const found = real(
      modules(siblings(importIt, importIt))
        .that()
        .resideInFolder('**/src/features/**')
        .should()
        .notImportFromCondition('**/src/legacy/**')
        .rule({ id: 'test/no-legacy', because: 'x' })
        .violations(),
    )
    expect(found.map((v) => v.file)).toEqual([
      '/src/features/alpha/index.ts',
      '/src/features/beta/index.ts',
    ])

    const asBefore = found.map((v) => ({
      ...v,
      identity: v.identity?.replace(v.file, v.file.replace(/^.*\//, '')),
    }))

    // Before: one hash for both. After: two. That is the whole bug and the whole fix.
    const beforeHashes = asBefore.map((v) => hashViolation(v))
    expect([...new Set(beforeHashes)]).toEqual([beforeHashes[0]])
    noDuplicates(found)
  })
})
