import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { workspace, modules } from '../../src/index.js'
import { isProjectRelative, rootFromTsConfigPath } from '../../src/core/project-relative.js'
import type { ArchProject } from '../../src/core/project.js'
import { resolveByDefinition } from '../../src/models/slice.js'

const fixture = path.resolve(import.meta.dirname, '../fixtures/workspace-roots')
const alpha = path.join(fixture, 'packages/alpha/tsconfig.json')
const beta = path.join(fixture, 'packages/beta/tsconfig.json')

/**
 * A workspace has no single root — bug 0035.
 *
 * `workspace([a, b])` sets `ArchProject.tsConfigPath` to the **alphabetically
 * first** config, so resolving "the project root" from it meant *that one
 * package*: measured, `'src/api/**'` matched `packages/alpha` and not
 * `packages/beta`, and renaming a package — or adding one called `aaa` —
 * silently changed which one it meant.
 *
 * That is the machine-dependent shape [bug 0011](../../bugs/fixed/0011-dogfood-rules-select-nothing.md)
 * already cost this project once: a rule scoped by a name nobody chose
 * deliberately. Each file now resolves against **the root that contains it**.
 */
describe('a relative glob resolves per package in a workspace (bug 0035)', () => {
  const p = workspace([alpha, beta])

  it('the fixture really is a workspace, and tsConfigPath really is just one of them', () => {
    // Both halves matter: without two packages the test proves nothing, and if
    // `tsConfigPath` ever became something else the bug would be gone for a
    // different reason than the fix.
    expect(p.getSourceFiles()).toHaveLength(2)
    expect(p.tsConfigPath).toBe(alpha)
  })

  it('assignedFrom matches the folder in EVERY package, not just the primary', () => {
    const files = resolveByDefinition(p, { api: 'src/api/**' })[0]?.files ?? []
    expect(files.map((f) => f.getFilePath()).sort()).toEqual(
      [
        path.join(fixture, 'packages/alpha/src/api/handler.ts'),
        path.join(fixture, 'packages/beta/src/api/handler.ts'),
      ].sort(),
    )
  })

  it('the path predicates do the same', () => {
    // v0.35.0 shipped this behaviour for the predicates first, via ts-morph's
    // `configFilePath` — which is also the primary. Same bug, same fix.
    // Both PACKAGES, which is the bug: with one workspace root the relative
    // glob resolved against a single package and found one of the two.
    expect(
      modules(p)
        .that()
        .resideInFolder('src/api/**')
        .subjects()
        .map((m) => m.getFilePath().split('/').slice(-4).join('/')),
    ).toEqual(['alpha/src/api/handler.ts', 'beta/src/api/handler.ts'])
  })

  it('agrees with the anchored spelling here, because every package matches', () => {
    // In a workspace the two spellings coincide for a folder every package has.
    // They diverge only when one package lacks it — which is the next test.
    expect(
      modules(p)
        .that()
        .resideInFolder('**/src/api/**')
        .subjects()
        .map((m) => m.getFilePath().split('/').slice(-4).join('/')),
    ).toEqual(['alpha/src/api/handler.ts', 'beta/src/api/handler.ts'])
  })

  it('a NESTED package resolves against its own root, not the outer one', () => {
    // W2: the containing-root pick sorts longest-first. Without it the outer
    // root wins for a file inside an inner package, and the inner tsconfig
    // never applies — unguarded until this test, because the flat two-package
    // fixture cannot tell the two orderings apart.
    // `zpkg`, deliberately: the roots are sorted alphabetically, and
    // `<fixture>/tsconfig.json` sorts BEFORE `<fixture>/zpkg/tsconfig.json`.
    // So without the longest-first pick the OUTER root wins for zpkg's file,
    // its relative path becomes `zpkg/src/api/handler.ts`, and `src/api/**`
    // misses it. With `packages/alpha` the alphabetical order happened to give
    // the right answer anyway, which is why that version of this test could not
    // fail.
    const outer = path.join(fixture, 'tsconfig.json')
    const zpkg = path.join(fixture, 'zpkg/tsconfig.json')
    const nested = workspace([outer, zpkg])
    const files = resolveByDefinition(nested, { api: 'src/api/**' })[0]?.files ?? []
    expect(files.map((f) => f.getFilePath())).toContain(
      path.join(fixture, 'zpkg/src/api/handler.ts'),
    )
  })

  it('a plain project() registers its root too, not only workspace()', () => {
    // W3: removing registration from `project()` left every test green, because
    // `rootOf` then fell through to ts-morph's `configFilePath` — which happens
    // to agree for a single-tsconfig project. It does NOT agree for an
    // in-memory one, so assert the path that has no `configFilePath` at all.
    const inMemory = new Project({ useInMemoryFileSystem: true })
    inMemory.createSourceFile('/repo/src/api/a.ts', 'export const a = 1')
    const built: ArchProject = {
      tsConfigPath: '/repo/tsconfig.json',
      _project: inMemory,
      getSourceFiles: () => inMemory.getSourceFiles(),
    }
    expect(inMemory.getCompilerOptions().configFilePath).toBeUndefined()
    expect(resolveByDefinition(built, { api: 'src/api/**' })[0]?.files).toHaveLength(1)
  })

  it('a tsconfig at the filesystem root gives "/" — not "", which meant two things', () => {
    // W4: `''` was read as "the root is /" by one derivation and "no root
    // known" by another, so the rule discovered its file while diagnose() called
    // the glob dead. Reachable in a container that mounts the repo at /.
    expect(rootFromTsConfigPath('/tsconfig.json')).toBe('/')
    expect(rootFromTsConfigPath('')).toBeUndefined()
  })

  it('a ".." segment is a fault, not a project-relative glob', () => {
    // W6: `relativeToGivenRoot` returns undefined for anything above the root,
    // deliberately — so a `../` glob would normalize to nothing and be reported
    // with three causes, none of them true.
    expect(isProjectRelative('../x/**')).toBe(false)
    expect(isProjectRelative('./x/**')).toBe(false)
    expect(isProjectRelative('src/x/**')).toBe(true)
  })

  it('CONTROL: still selects nothing for a folder no package has', () => {
    expect(resolveByDefinition(p, { api: 'src/no-such/**' })[0]?.files ?? []).toEqual([])
    expect(modules(p).that().resideInFolder('src/no-such/**').subjects()).toEqual([])
  })

  it('CONTROL: a single-tsconfig project is unchanged', () => {
    // The fix must not alter the case that already worked: one root, and a
    // relative glob means that root's folder.
    const single = workspace([alpha])
    expect(resolveByDefinition(single, { api: 'src/api/**' })[0]?.files).toHaveLength(1)
  })
})
