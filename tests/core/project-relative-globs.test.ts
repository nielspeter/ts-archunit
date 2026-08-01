import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { modules, classes } from '../../src/index.js'
import { resideInFolder, resideInFile } from '../../src/predicates/identity.js'
import { diagnose } from '../../src/core/diagnose.js'
import { isProjectRelative, relativeToRoot } from '../../src/core/project-relative.js'
import type { ArchProject } from '../../src/core/project.js'

const tsconfigPath = path.resolve(import.meta.dirname, '../fixtures/modules/tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const p = loadProject()

/**
 * A project-relative path glob works — plan 0067 part C.
 *
 * Globs match **absolute** paths, so `'src/domain/**'` matched nothing: the
 * commonest real mistake with this library, the reason 0.18.1 shipped, and as
 * of 0.34.0 a hard build failure telling the author to prefix `'**\/'`.
 *
 * 0067 called normalization the root-cause fix, because prefixing says
 * something different: `'**\/src/domain/**'` matches a `src/domain` anywhere,
 * including inside `vendor/` or a nested package. The author meant the one at
 * the project root.
 */
describe('a project-relative path glob (plan 0067 C)', () => {
  it('selects the folder at the project root', () => {
    const subjects = modules(p).that().resideInFolder('src/domain/**').subjects()
    expect(subjects.length).toBeGreaterThan(0)
  })

  it('means the same set as the absolute spelling of the same folder', () => {
    // Not just "non-empty" — the same files. A normalization that matched a
    // DIFFERENT set would satisfy the test above and still be wrong.
    const relative = modules(p)
      .that()
      .resideInFolder('src/domain/**')
      .subjects()
      .map((f) => f.getFilePath())
      .sort()
    const absolute = modules(p)
      .that()
      .resideInFolder(`${path.dirname(tsconfigPath)}/src/domain/**`)
      .subjects()
      .map((f) => f.getFilePath())
      .sort()
    expect(relative).toEqual(absolute)
    expect(relative.length).toBeGreaterThan(0)
  })

  it('is NARROWER than the anchored spelling it replaces', () => {
    // The reason normalization beats "just prefix `**/`". If these were equal,
    // the old advice would have been fine and this change would be churn.
    const rootOnly = modules(p).that().resideInFolder('src/domain/**').subjects().length
    const anywhere = modules(p).that().resideInFolder('**/src/domain/**').subjects().length
    expect(rootOnly).toBeGreaterThan(0)
    expect(anywhere).toBeGreaterThanOrEqual(rootOnly)
  })

  it('is no longer reported as a dead selector', () => {
    // Runtime and diagnosis must agree. A glob that matches must not be
    // reported dead, and 0.34.0's glob flip turns any disagreement into a
    // failing build.
    const rule = modules(p).that().resideInFolder('src/domain/**').should().notImportFrom('**/x/**')
    expect(diagnose([rule])).toEqual([])
    expect(rule.violations()).toEqual([])
  })

  it('behaves identically through the builder method and the standalone predicate', () => {
    // The two spellings must not diverge — the root is derived from the element
    // rather than threaded through the builder precisely so that this holds.
    const viaBuilder = modules(p).that().resideInFolder('src/domain/**').subjects().length
    const viaSatisfy = modules(p).that().satisfy(resideInFolder('src/domain/**')).subjects().length
    expect(viaBuilder).toBe(viaSatisfy)
    expect(viaBuilder).toBeGreaterThan(0)
  })

  it('applies to resideInFile too, not only folders', () => {
    const viaFile = modules(p).that().satisfy(resideInFile('src/domain/**')).subjects().length
    expect(viaFile).toBeGreaterThan(0)
  })

  it('CONTROL: an anchored glob still means "anywhere"', () => {
    expect(modules(p).that().resideInFolder('**/domain/**').subjects().length).toBeGreaterThan(0)
  })

  it('CONTROL: a genuinely wrong relative glob still fails', () => {
    // Without this, normalizing everything to "match" would pass every
    // assertion above while destroying the guarantee 0.34.0 just shipped.
    const rule = classes(p)
      .that()
      .resideInFolder('src/no-such-folder/**')
      .should()
      .haveNameMatching(/./)
    expect(rule.violations()).toHaveLength(1)
    expect(rule.violations()[0]?.message).toContain('can never match anything')
  })

  it('CONTROL: a `./` segment is still a fault, in both derivations', () => {
    // The inconsistency this nearly shipped with: `'./src/domain/**'` selected
    // 3 subjects AND reported a dead selector in the same run, because the
    // runtime normalized it and `syntacticFault` still called it dead. `./` is
    // a mistake in both readings, so it stays failing — and both surfaces must
    // agree that it does.
    expect(isProjectRelative('./src/domain/**')).toBe(false)
    const rule = modules(p)
      .that()
      .resideInFolder('./src/domain/**')
      .should()
      .notImportFrom('**/x/**')
    expect(modules(p).that().resideInFolder('./src/domain/**').subjects()).toEqual([])
    expect(diagnose([rule]).map((f) => f.fault)).toEqual(['dot-segment'])
  })

  it('CONTROL: an explicitly-anchored glob is NOT normalized', () => {
    // Sabotage found this unguarded. Normalizing everything only ADDS matches,
    // so every "selects something" assertion above stays green while `'**/x'`
    // and `'/abs/x'` quietly stop meaning what they say.
    //
    // `'*/domain/**'` is the discriminator: as an absolute path it matches
    // nothing (no absolute path has a single segment before `domain`), but the
    // ROOT-RELATIVE form of the directory is `src/domain`, which it does match.
    // So it selects nothing iff anchored globs are left alone.
    expect(isProjectRelative('*/domain/**')).toBe(false)
    expect(modules(p).that().resideInFolder('*/domain/**').subjects()).toEqual([])
  })

  it('CONTROL: a file outside the project root is never matched relatively', () => {
    // Also found by sabotage. `relativeToRoot` must return undefined for a path
    // that does not sit under the root — trimming the prefix wherever it
    // happens to occur would relativise a file the root does not contain.
    const root = '/repo/pkg'
    const inside = '/repo/pkg/src/domain/a.ts'
    const outside = '/repo/other/src/domain/a.ts'
    // Derived from the same helper the predicates use, via a stub source file
    // — the point is the path arithmetic, not ts-morph.
    // `getFilePath` too: `rootOf` picks the root that CONTAINS the file, so it
    // needs the path. The stub was written when there was only one root to
    // return and predates that (bug 0035).
    const stub = (configFilePath: string | undefined, filePath: string) =>
      ({
        getFilePath: () => filePath,
        getProject: () => ({ getCompilerOptions: () => ({ configFilePath }) }),
      }) as unknown as Parameters<typeof relativeToRoot>[0]

    expect(relativeToRoot(stub(`${root}/tsconfig.json`, inside), inside)).toBe('src/domain/a.ts')
    expect(relativeToRoot(stub(`${root}/tsconfig.json`, outside), outside)).toBeUndefined()
    expect(relativeToRoot(stub(undefined, inside), inside)).toBeUndefined()
  })

  it('skips normalization when the project has no tsconfig to be relative to', () => {
    // `configFilePath` is undefined for an in-memory project. That is a genuine
    // "no root known", and inventing one would match against something the
    // author never named.
    const inMemory = new Project({ useInMemoryFileSystem: true })
    inMemory.createSourceFile('/src/domain/a.ts', 'export const a = 1')
    const memProject: ArchProject = {
      tsConfigPath: '',
      _project: inMemory,
      getSourceFiles: () => inMemory.getSourceFiles(),
    }
    // The absolute spelling still works; the relative one has no root to use.
    expect(modules(memProject).that().resideInFolder('/src/domain/**').subjects().length).toBe(1)
    expect(modules(memProject).that().resideInFolder('src/domain/**').subjects()).toEqual([])
  })
})
