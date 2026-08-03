/**
 * `PathUniverse` (plan 0069 R2a).
 *
 * There was no test for this module at all, and swapping the parent-dir view
 * for an all-ancestors walk left the entire suite green — the plan's own
 * headline false green, unguarded in the code that fixes it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { pathUniverse, viewsFor } from '../../src/core/path-universe.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/nested-slices')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('pathUniverse', () => {
  const universe = pathUniverse(loadProject())

  it('holds every project file', () => {
    // Not merely "non-empty": silently dropping a file makes LIVE globs look
    // dead, which is the false-red direction, and every other test here
    // derives `parentDirs` from the same `filePaths` so they stay internally
    // consistent with a truncated set. Compared against a filesystem walk —
    // the same independent derivation `arch-rules.test.ts` uses.
    const onDisk = fs
      .readdirSync(path.join(fixturesDir, 'src'), { recursive: true, encoding: 'utf-8' })
      .filter((entry) => entry.endsWith('.ts'))
    expect(onDisk.length).toBeGreaterThan(0)
    expect(universe.filePaths).toHaveLength(onDisk.length)
    expect(universe.filePaths.some((f) => f.endsWith('/auth/login.ts'))).toBe(true)
    expect(universe.filePaths.some((f) => f.endsWith('/billing/invoice.ts'))).toBe(true)
  })

  it('the folder view is immediate parents, NOT all ancestors', () => {
    // The distinction is not academic. `resideInFolder` tests
    // `filePath.substring(0, lastIndexOf('/'))` — the immediate parent and
    // nothing else — so an ancestor that is no file's parent can never be
    // selected. Including it makes an unsatisfiable rule look satisfiable,
    // which is a false green, not a fail-open.
    for (const dir of universe.parentDirs) {
      expect(universe.filePaths.some((file) => file.startsWith(dir + '/'))).toBe(true)
      // and specifically: it is SOME file's immediate parent
      expect(
        universe.filePaths.some((file) => file.substring(0, file.lastIndexOf('/')) === dir),
      ).toBe(true)
    }
  })

  it('the fixture actually contains an ancestor that is no file s parent', () => {
    // Without this, the test above passes trivially on a flat layout. The
    // nested fixture has `src/features`, whose only children are directories.
    const ancestors = new Set<string>()
    for (const file of universe.filePaths) {
      const parts = file.split('/')
      for (let i = parts.length - 1; i > 1; i--) ancestors.add(parts.slice(0, i).join('/'))
    }
    const parents = new Set(universe.parentDirs)
    const ancestorsOnly = [...ancestors].filter((dir) => !parents.has(dir))
    expect(ancestorsOnly.some((dir) => dir.endsWith('/src/features'))).toBe(true)
  })

  it('every project file s parent is in the folder view', () => {
    // The property, rather than a pinned count: a pinned 430/81 is the
    // snapshot ADR-008 rule 4 bars.
    const parents = new Set(universe.parentDirs)
    for (const file of universe.filePaths) {
      expect(parents.has(file.substring(0, file.lastIndexOf('/')))).toBe(true)
    }
  })

  it('offers a tsconfig-relative view of both', () => {
    expect(universe.tsconfigRelativeFilePaths).toHaveLength(universe.filePaths.length)
    expect(universe.tsconfigRelativeFilePaths.every((p) => !p.startsWith('/'))).toBe(true)
  })

  it('is memoized per project identity', () => {
    const p = loadProject()
    expect(pathUniverse(p)).toBe(pathUniverse(p))
  })
})

describe('viewsFor', () => {
  const universe = pathUniverse(loadProject())

  it('gives import-target, specifier and literal NO views', () => {
    // node_modules is outside the project by construction, so checking an
    // import glob against a path universe would fail every correct dependency
    // rule in existence.
    expect(viewsFor(universe, 'import-target')).toEqual([])
    expect(viewsFor(universe, 'specifier')).toEqual([])
    expect(viewsFor(universe, 'literal')).toEqual([])
  })

  it('gives path kinds the absolute view and the tsconfig-relative one', () => {
    // WHICH two views, not that there are two: two absolute views would have
    // counted the same, and the claim names one of each.
    const shapeOf = (view: readonly string[]): string => {
      // `[].every` is true, so without this an EMPTY view reads as 'absolute' and
      // `[[], ['rel/x']]` passes — a vacuity hole the `toHaveLength(2)` this
      // replaced could not have. ADR-008: if the inputs can be empty, assert they
      // are not.
      if (view.length === 0) return 'empty'
      return view.every((p) => p.startsWith('/')) ? 'absolute' : 'tsconfig-relative'
    }
    expect(viewsFor(universe, 'file-path').map(shapeOf)).toEqual(['absolute', 'tsconfig-relative'])
    expect(viewsFor(universe, 'parent-dir').map(shapeOf)).toEqual(['absolute', 'tsconfig-relative'])
  })
})
