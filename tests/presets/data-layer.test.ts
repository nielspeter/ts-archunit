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

  it('a flag left unset does not build that rule, even on a bad-repo fixture', () => {
    // bad-repo doesn't extend BaseRepository, but baseClass is not set —
    // requireTypedErrors stays ON, so this is not the truly-minimal call
    // below; it isolates the claim to `baseClass` alone.
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/bad-repo.ts',
      requireTypedErrors: true,
    })
    expect(violatedIds(rules)).not.toContain('preset/data/extend-base')
  })

  it('plan 0100: the truly minimal call constructs nothing, and says so', () => {
    // Neither flag set — the exact silence bug 0100 measured:
    // `dataLayerIsolation({ repositories })` used to return `[]`, a green
    // build on a fixture (bad-repo) that would fail every rule if either
    // flag were on.
    const rules = dataLayerIsolation(p, { repositories: '**/repositories/bad-repo.ts' })
    expect(rules).toHaveLength(1)
    const violations = rules[0]!.violations()
    expect(violations).toHaveLength(1)
    expect(violations[0]?.ruleId).toBe('preset/data/constructs-nothing')
    expect(violations[0]?.message).toContain('constructed 0 rules')
    expect(violations[0]?.bypassFilters).toBe(true)
  })

  it('plan 0100: the remedy is proven — enabling one flag clears the finding', () => {
    const ids = (rules: RuleBuilderLike[]): string[] =>
      rules.flatMap((r) => r.violations()).map((v) => v.ruleId ?? '')

    expect(ids(dataLayerIsolation(p, { repositories: '**/repositories/bad-repo.ts' }))).toContain(
      'preset/data/constructs-nothing',
    )
    // Applying exactly the stated remedy — "Set at least one of: baseClass,
    // requireTypedErrors" — and nothing else about the call changes.
    expect(
      ids(
        dataLayerIsolation(p, {
          repositories: '**/repositories/bad-repo.ts',
          requireTypedErrors: true,
        }),
      ),
    ).not.toContain('preset/data/constructs-nothing')
  })

  it('plan 0100: a more specific finding on the same unattempted call reports ONCE, not stacked', () => {
    // `expectEmpty` names a rule this call never attempts either — so
    // `declaredEmptyFindings` fires its own "binds to nothing" finding, and
    // `assertEnabled` (attempted.length === 0, same as the test above) must
    // defer to it rather than pile a second, less specific finding on top.
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/bad-repo.ts',
      expectEmpty: ['preset/data/extend-base'],
    })
    const ids = rules.flatMap((r) => r.violations()).map((v) => v.ruleId)
    expect(ids).toEqual(['preset/expect-empty/preset/data/extend-base'])
  })

  it('override to off omits the extend-base builder', () => {
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/**',
      baseClass: 'BaseRepository',
      overrides: { 'preset/data/extend-base': 'off' },
    })
    expect(violatedIds(rules)).not.toContain('preset/data/extend-base')
  })

  it('plan 0100: enabling a rule then overriding it off is a declaration, not silence', () => {
    // baseClass WAS set — something was attempted — so overriding it off is
    // the reader explicitly declining it, not the unconfigured silence above.
    // No new finding should appear alongside the omitted builder.
    const rules = dataLayerIsolation(p, {
      repositories: '**/repositories/**',
      baseClass: 'BaseRepository',
      overrides: { 'preset/data/extend-base': 'off' },
    })
    expect(rules).toEqual([])
  })
})
