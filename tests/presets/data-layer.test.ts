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

  it('a FILE glob for repositories enforces the rules (bug 0018)', () => {
    // `repositories` went straight to `resideInFolder`, which reads the parent
    // directory, so a file glob could never match: the preset generated its
    // rules and reported 0 violations on a fixture named `bad-repo`. The old
    // version of this test passed `good-repo.ts` and asserted `[]`, which an
    // empty selection satisfies — it would have passed with the whole preset
    // broken, and plan 0069's appendix filed it as legitimate on that basis.
    const violations = dataLayerIsolation(p, {
      repositories: '**/repositories/bad-repo.ts',
      requireTypedErrors: true,
      baseClass: 'BaseRepository',
    }).flatMap((r) => r.violations())
    expect(violations.length).toBeGreaterThan(0)
  })

  it('a DIRECTORY glob still enforces them (no regression)', () => {
    const violations = dataLayerIsolation(p, {
      repositories: '**/repositories/**',
      requireTypedErrors: true,
      baseClass: 'BaseRepository',
    }).flatMap((r) => r.violations())
    expect(violations.length).toBeGreaterThan(0)
  })

  it('passes for a good repo named by a file glob', () => {
    // The original assertion, kept — but now meaningful, because the file glob
    // actually selects the class. Guarded against emptiness by the two cases
    // above: if `atPath()` selected nothing this would still be `[]`, so it is
    // not load-bearing on its own.
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
