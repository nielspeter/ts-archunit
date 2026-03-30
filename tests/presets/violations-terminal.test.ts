import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { slices } from '../../src/builders/slice-rule-builder.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/layered')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('.violations() terminal', () => {
  const p = loadTestProject()

  it('returns empty array when no violations (RuleBuilder)', () => {
    const result = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/nonexistent/**')
      .violations()

    expect(result).toEqual([])
  })

  it('returns violations array without throwing (RuleBuilder)', () => {
    // Routes import from services — if we forbid that, violations are returned
    const result = modules(p)
      .that()
      .resideInFolder('**/routes/**')
      .should()
      .notImportFrom('**/services/**')
      .violations()

    expect(result.length).toBeGreaterThan(0)
    expect(result[0]!.rule).toBeDefined()
  })

  it('returns violations array without throwing (TerminalBuilder)', () => {
    // Reverse the layer order — should produce violations
    const result = slices(p)
      .assignedFrom({
        repositories: '**/repositories/**',
        services: '**/services/**',
        routes: '**/routes/**',
      })
      .should()
      .respectLayerOrder('repositories', 'services', 'routes')
      .violations()

    expect(result.length).toBeGreaterThan(0)
  })

  it('returns empty array for correct architecture (TerminalBuilder)', () => {
    const result = slices(p)
      .assignedFrom({
        routes: '**/routes/**',
        services: '**/services/**',
        repositories: '**/repositories/**',
      })
      .should()
      .respectLayerOrder('routes', 'services', 'repositories')
      .violations()

    expect(result).toEqual([])
  })
})
