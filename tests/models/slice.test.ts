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
