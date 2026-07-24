import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { resolveByMatching, resolveByDefinition } from '../../src/models/slice.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/slices')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('resolveByMatching', () => {
  const p = loadTestProject()

  it('creates slices from directories matching the glob', () => {
    const result = resolveByMatching(p, 'src/feature-')
    const names = result.map((s) => s.name).sort()
    expect(names).toContain('feature-a')
    expect(names).toContain('feature-b')
    expect(names).toContain('feature-c')
  })

  it('assigns files to the correct slice', () => {
    const result = resolveByMatching(p, 'src/feature-')
    const featureA = result.find((s) => s.name === 'feature-a')
    expect(featureA).toBeDefined()
    expect(featureA!.files.length).toBeGreaterThan(0)
    expect(featureA!.files.some((f) => f.getBaseName() === 'index.ts')).toBe(true)
  })

  it('returns empty array when no directories match', () => {
    const result = resolveByMatching(p, 'src/nonexistent-*/')
    expect(result).toHaveLength(0)
  })
})

describe('resolveByMatching glob spellings (bug 0009)', () => {
  const p = loadTestProject()

  /**
   * Compare the full slice SET, not a projection of it. Asserting only on
   * downstream cycle messages let a mutant that silently drops a slice pass the
   * entire suite — `beFreeOfCycles` never mentions acyclic slices.
   */
  function sliceSet(glob: string) {
    return resolveByMatching(p, glob)
      .map((s) => ({ name: s.name, files: s.files.map((f) => f.getBaseName()).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  it('resolves the documented directory-level form (was 0 slices)', () => {
    // 'src/*/' is the spelling used across README/docs/examples; a trailing '/'
    // put the wildcard inside baseDir, which no absolute path ever contains.
    const names = sliceSet('src/*/').map((s) => s.name)
    expect(names).toContain('feature-a')
    expect(names).toContain('domain')
    expect(names.length).toBeGreaterThan(1)
  })

  it('treats all four spellings of one intent as identical', () => {
    const canonical = sliceSet('src/*')
    expect(canonical.length).toBeGreaterThan(1) // non-vacuity anchor
    for (const spelling of ['src/*/', '**/src/*', '**/src/*/']) {
      expect(sliceSet(spelling), `spelling: ${spelling}`).toEqual(canonical)
    }
  })

  it('names one slice per FILE when files sit directly in the prefix dir', () => {
    // The shape from the bug report (56 flat service files -> 56 slices). The
    // message must not promise "directories".
    expect(sliceSet('src/domain/*').map((s) => s.name)).toEqual(['entity.ts', 'value-object.ts'])
    expect(sliceSet('**/src/domain/*')).toEqual(sliceSet('src/domain/*'))
  })

  it('keeps the literal-prefix form working', () => {
    expect(sliceSet('src/feature-').map((s) => s.name)).toEqual([
      'feature-a',
      'feature-b',
      'feature-c',
    ])
    expect(sliceSet('**/src/feature-')).toEqual(sliceSet('src/feature-'))
  })

  it('resolves nothing for globs with no literal prefix (stays a loud failure)', () => {
    // These must not accidentally yield a slice named '' or a drive root.
    for (const glob of ['**', '**/', '*', '']) {
      expect(resolveByMatching(p, glob), `glob: ${glob}`).toEqual([])
    }
  })
})

describe('resolveByDefinition', () => {
  const p = loadTestProject()

  it('creates slices from explicit definitions', () => {
    const result = resolveByDefinition(p, {
      domain: '**/domain/**',
      services: '**/services/**',
      controllers: '**/controllers/**',
    })
    expect(result).toHaveLength(3)
    expect(result.map((s) => s.name)).toEqual(['domain', 'services', 'controllers'])
  })

  it('assigns files matching the glob to the correct slice', () => {
    const result = resolveByDefinition(p, {
      domain: '**/domain/**',
    })
    const domain = result[0]!
    expect(domain.files.length).toBe(2) // entity.ts and value-object.ts
  })

  it('first match wins for overlapping globs', () => {
    const result = resolveByDefinition(p, {
      all: '**/*.ts',
      domain: '**/domain/**',
    })
    // domain files should go to 'all' (first match)
    const domain = result.find((s) => s.name === 'domain')!
    expect(domain.files).toHaveLength(0)
  })
})
