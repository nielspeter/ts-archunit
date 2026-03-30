import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { dataLayerIsolation } from '../../src/presets/data-layer.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/data-layer')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('dataLayerIsolation preset', () => {
  const p = loadTestProject()

  it('detects missing base class extension', () => {
    expect(() => {
      dataLayerIsolation(p, {
        repositories: '**/repositories/**',
        baseClass: 'BaseRepository',
      })
    }).toThrow(ArchRuleError)
  })

  it('detects generic Error throw', () => {
    expect(() => {
      dataLayerIsolation(p, {
        repositories: '**/repositories/**',
        requireTypedErrors: true,
      })
    }).toThrow(ArchRuleError)
  })

  it('passes when only good repo and baseClass not specified', () => {
    expect(() => {
      dataLayerIsolation(p, {
        repositories: '**/repositories/good-repo.ts',
        requireTypedErrors: true,
      })
    }).not.toThrow()
  })

  it('skips base class check when baseClass not specified', () => {
    // bad-repo doesn't extend BaseRepository, but baseClass is not set
    expect(() => {
      dataLayerIsolation(p, {
        repositories: '**/repositories/bad-repo.ts',
      })
    }).not.toThrow()
  })

  it('override to off suppresses extend-base', () => {
    expect(() => {
      dataLayerIsolation(p, {
        repositories: '**/repositories/**',
        baseClass: 'BaseRepository',
        overrides: {
          'preset/data/extend-base': 'off',
        },
      })
    }).not.toThrow()
  })
})
