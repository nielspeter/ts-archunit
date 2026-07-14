import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'
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

const violatedIds = (rules: RuleBuilderLike[]): Set<string> =>
  new Set(rules.flatMap((r) => r.violations()).map((v) => v.ruleId ?? ''))

describe('dataLayerIsolation preset', () => {
  const p = loadTestProject()

  it('detects missing base class extension', () => {
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/**',
      baseClass: 'BaseRepository',
    })
    expect(violatedIds(rules)).toContain('preset/data/extend-base')
  })

  it('detects generic Error throw', () => {
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/**',
      requireTypedErrors: true,
    })
    expect(violatedIds(rules)).toContain('preset/data/typed-errors')
  })

  it('passes when only good repo and baseClass not specified', () => {
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/good-repo.ts',
      requireTypedErrors: true,
    })
    expect(rules.flatMap((r) => r.violations())).toEqual([])
  })

  it('emits no rule at all when baseClass is not specified', () => {
    // bad-repo doesn't extend BaseRepository, but baseClass is not set
    const rules = dataLayerIsolation(p, { repositories: '**/repositories/bad-repo.ts' })
    expect(rules).toEqual([])
  })

  it('override to off omits the extend-base builder', () => {
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/**',
      baseClass: 'BaseRepository',
      overrides: { 'preset/data/extend-base': 'off' },
    })
    expect(violatedIds(rules)).not.toContain('preset/data/extend-base')
  })
})
