import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { slices, SliceRuleBuilder } from '../../src/builders/slice-rule-builder.js'
import { resolveByDefinition } from '../../src/models/slice.js'
import { ArchRuleError } from '../../src/core/errors.js'
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

describe('slices() entry point', () => {
  const p = loadTestProject()

  it('returns a SliceRuleBuilder', () => {
    expect(slices(p)).toBeInstanceOf(SliceRuleBuilder)
  })
})

describe('SliceRuleBuilder with matching()', () => {
  const p = loadTestProject()

  it('detects cycles between feature slices', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().check()
    }).toThrow(ArchRuleError)
  })

  it('passes beFreeOfCycles when slices are acyclic', () => {
    expect(() => {
      slices(p).matching('src/feature-c').should().beFreeOfCycles().check()
    }).not.toThrow()
  })
})

describe('SliceRuleBuilder with assignedFrom()', () => {
  const p = loadTestProject()

  it('passes respectLayerOrder when dependencies flow correctly', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
        })
        .should()
        .respectLayerOrder('controllers', 'services', 'domain')
        .check()
    }).not.toThrow()
  })

  it('fails respectLayerOrder when a lower layer depends upward', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
          bad: '**/bad/**',
        })
        .should()
        .respectLayerOrder('controllers', 'services', 'domain', 'bad')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes notDependOn when no forbidden dependencies exist', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          domain: '**/domain/**',
          services: '**/services/**',
        })
        .should()
        .notDependOn('controllers')
        .check()
    }).not.toThrow()
  })

  it('fails notDependOn when forbidden dependencies exist', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          bad: '**/bad/**',
          controllers: '**/controllers/**',
        })
        .should()
        .notDependOn('controllers')
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('SliceRuleBuilder chain methods', () => {
  const p = loadTestProject()

  it('.because() includes reason in error', () => {
    try {
      slices(p)
        .matching('src/feature-')
        .should()
        .beFreeOfCycles()
        .because('features must not have circular deps')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('features must not have circular deps')
    }
  })

  it('.warn() does not throw', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().warn()
    }).not.toThrow()
  })

  it('.severity("error") throws on violations', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().severity('error')
    }).toThrow(ArchRuleError)
  })

  it('.severity("warn") does not throw', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().severity('warn')
    }).not.toThrow()
  })

  it('supports multiple conditions with andShould()', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
        })
        .should()
        .respectLayerOrder('controllers', 'services', 'domain')
        .andShould()
        .beFreeOfCycles()
        .check()
    }).not.toThrow()
  })
})

describe('SliceRuleBuilder discovery non-vacuity (plan 0067)', () => {
  const p = loadTestProject()

  it('fails when matching() resolves no slices (was a vacuous green)', () => {
    const v = slices(p)
      .matching('src/does-not-exist/**')
      .should()
      .beFreeOfCycles()
      .rule({ id: 'test/slice-discovery' })
      .violations()
    expect(v).toHaveLength(1)
    expect(v[0]!.ruleId).toBe('test/slice-discovery')
    expect(v[0]!.bypassFilters).toBe(true)
    // Couple to the caller's own glob (stable) rather than to the prose.
    expect(v[0]!.message).toContain('src/does-not-exist/**')
    expect(v[0]!.message).toContain('discovers nothing enforces nothing')
  })

  it('fails when assignedFrom() resolves slices with no files (empty-files case)', () => {
    const v = slices(p)
      .assignedFrom({ ghost: '**/does-not-exist/**' })
      .should()
      .beFreeOfCycles()
      .violations()
    expect(v).toHaveLength(1)
    expect(v[0]!.bypassFilters).toBe(true)
  })

  it('does NOT trip discovery-vacuity when at least one slice has files (every-guard)', () => {
    // 'real' matches the fixture; 'ghost' is empty. every(empty) must be false.
    // Assert on the FLAG, not on message prose: this test previously matched
    // /matched no files/, and when that phrase was reworded out of existence the
    // assertion silently became tautological — the `every` vs `some` boundary
    // went unguarded. bypassFilters is only set by the discovery meta-finding.
    const v = slices(p)
      .assignedFrom({ real: '**/*.ts', ghost: '**/does-not-exist/**' })
      .should()
      .beFreeOfCycles()
      .violations()
    expect(v.some((x) => x.bypassFilters === true)).toBe(false)
  })
})

describe('SliceRuleBuilder empty-discovery remedies (bug 0009)', () => {
  const p = loadTestProject()

  function discoveryMessage(build: (b: SliceRuleBuilder) => SliceRuleBuilder): string {
    const v = build(slices(p)).should().beFreeOfCycles().violations()
    expect(v).toHaveLength(1)
    expect(v[0]!.bypassFilters).toBe(true) // must survive baseline/diff/excluding
    return v[0]!.message
  }

  /**
   * The remedy is the product here, so these assert on *cross-wiring* rather than
   * on prose: each message must carry its own advice and must NOT carry the other
   * branch's. A shared-remedy regression (bug 0009) fails these regardless of how
   * the sentences are worded.
   */
  const ANCHOR_ADVICE = 'prefix these with "**/"'
  const PREFIX_ADVICE = 'literal prefix (everything before the first wildcard)'

  it('matching(): explains the literal prefix, never the "**/" anchor advice', () => {
    const message = discoveryMessage((b) => b.matching('src/does-not-exist/*'))
    expect(message).toContain('matching("src/does-not-exist/*")') // names the glob
    expect(message).toContain(PREFIX_ADVICE)
    expect(message).not.toContain(ANCHOR_ADVICE)
    // The old false remedy, in any wording, must not reappear on this path.
    expect(message).not.toMatch(/use "\*\*\//)
  })

  it('assignedFrom(): anchor advice only when a glob actually lacks the anchor', () => {
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: 'src/nope/**' }))
    expect(message).toContain(ANCHOR_ADVICE)
    expect(message).toContain('ghost: "src/nope/**"') // names the slice, not just the glob
    expect(message).not.toContain(PREFIX_ADVICE)
  })

  it('assignedFrom(): already-anchored globs are NOT told to add an anchor', () => {
    // The false-remedy class one level down: '**/'-prefixed globs that simply
    // point at a missing directory.
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: '**/does-not-exist/**' }))
    expect(message).toContain('anchored correctly')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('assignedFrom({}): reports the empty definition, not a glob problem', () => {
    const message = discoveryMessage((b) => b.assignedFrom({}))
    expect(message).toContain('no entries')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('names the real problem when no slice source was given at all', () => {
    const message = discoveryMessage((b) => b)
    expect(message).toContain('No slice source')
    expect(message).toContain('.matching(')
    expect(message).toContain('.assignedFrom(')
  })

  it('the anchor remedy is TRUE: adding "**/" turns an empty glob into a matching one', () => {
    // Independent derivation (ADR-008 R5): don't take the prose's word for it —
    // check that the transformation the message recommends actually works.
    expect(resolveByDefinition(p, { x: 'src/domain/**' })[0]!.files).toHaveLength(0)
    expect(resolveByDefinition(p, { x: '**/src/domain/**' })[0]!.files.length).toBeGreaterThan(0)
  })

  it('a mixed definition names BOTH the unanchored and the anchored-but-missing', () => {
    // Naming only the unanchored subset sends the caller through a second failing
    // run to discover the rest — every slice is empty, so all of them are at fault.
    const message = discoveryMessage((b) =>
      b.assignedFrom({ bad: 'src/nope/**', alsoBad: '**/does-not-exist/**' }),
    )
    expect(message).toContain('bad: "src/nope/**"')
    expect(message).toContain('alsoBad: "**/does-not-exist/**"')
    expect(message).toContain(ANCHOR_ADVICE)
  })

  it('an absolute glob is not told to add an anchor', () => {
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: '/abs/missing/**' }))
    expect(message).toContain('anchored correctly')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('a "./" prefix gets its own remedy (prefixing it would not help)', () => {
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: './src/domain/**' }))
    expect(message).toContain('leading "./"')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('truncates a long glob list but says how many were hidden', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 8; i++) many[`layer${String(i)}`] = `src/nope-${String(i)}/**`
    const message = discoveryMessage((b) => b.assignedFrom(many))
    expect(message).toContain('layer0:')
    expect(message).toContain('layer4:')
    expect(message).not.toContain('layer7:') // beyond the shown window
    expect(message).toContain('and 3 more')
  })

  it('blames the tsconfig, not the glob, when the project loaded no files', () => {
    const emptyProject: ArchProject = (() => {
      const tsMorphProject = new Project({ useInMemoryFileSystem: true })
      return {
        tsConfigPath: '/repo/tsconfig.json',
        _project: tsMorphProject,
        getSourceFiles: () => tsMorphProject.getSourceFiles(),
      }
    })()
    const message =
      slices(emptyProject).matching('src/features/*').should().beFreeOfCycles().violations()[0]
        ?.message ?? ''
    expect(message).toContain('0 source files')
    expect(message).toContain('/repo/tsconfig.json')
    expect(message).not.toContain(PREFIX_ADVICE) // the glob is not the problem
  })
})
