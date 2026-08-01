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

  it('distinguishes ALL-empty from PARTIALLY-empty (the every-guard boundary)', () => {
    // The `every` vs `some` boundary: all-empty is a glob-convention problem, while
    // partially-empty means some globs worked and the empty ones are silently
    // unchecked. Both fail, but with different remedies — so assert on WHICH.
    // (This test previously matched a prose phrase; when that phrase was reworded
    // out of existence the assertion became tautological and the boundary went
    // unguarded. Coupling to the distinguishing content keeps it honest.)
    const message = (definition: Record<string, string>) =>
      slices(p).assignedFrom(definition).should().beFreeOfCycles().violations()[0]?.message ?? ''

    const allEmpty = message({ ghostA: '**/nope-a/**', ghostB: '**/nope-b/**' })
    expect(allEmpty).toContain('Every slice in assignedFrom(...) is empty')

    // Partially-empty does NOT trip the guard: one populated slice is enough.
    // Asserted on the flag, not on prose — an earlier version of this test matched a
    // phrase that was later reworded away, becoming tautologically true.
    const partial = slices(p)
      .assignedFrom({ real: '**/domain/**', ghost: '**/does-not-exist/**' })
      .should()
      .beFreeOfCycles()
      .violations()
    expect(partial.some((v) => v.bypassFilters === true)).toBe(false)
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
  const PREFIX_ADVICE = 'was not found in any of this'

  it('matching(): names the prefix it looked for, never the "**/" anchor advice', () => {
    const message = discoveryMessage((b) => b.matching('src/does-not-exist/*'))
    expect(message).toContain('matching("src/does-not-exist/*")') // names the glob
    expect(message).toContain('"src/does-not-exist/"') // names the prefix actually searched
    expect(message).toContain(PREFIX_ADVICE)
    expect(message).not.toContain(ANCHOR_ADVICE)
    // The old false remedy, in any wording, must not reappear on this path.
    expect(message).not.toMatch(/use "\*\*\//)
  })

  it('matching(): a glob with no directory prefix says SO, not "check the prefix"', () => {
    // 'src' has no directory prefix to look for, so telling the caller to compare a
    // prefix against their paths would send them to inspect something that does not
    // exist — the false-remedy shape this guard kept relapsing into.
    const message = discoveryMessage((b) => b.matching('src'))
    expect(message).toContain('no literal directory prefix')
    expect(message).not.toContain(PREFIX_ADVICE)
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('assignedFrom(): anchor advice only when a glob actually lacks the anchor', () => {
    // `'*/nope/**'`, not `'src/nope/**'`. Since bug 0033 a project-relative glob
    // RESOLVES against the project root here, so it is no longer unanchored and
    // telling the author to prefix `"**/"` would send them to change a spelling
    // that works. A leading `*/` is still genuinely unanchored.
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: '*/nope/**' }))
    expect(message).toContain(ANCHOR_ADVICE)
    expect(message).toContain('ghost: "*/nope/**"') // names the slice, not just the glob
    expect(message).not.toContain(PREFIX_ADVICE)
  })

  it('a RELATIVE glob naming a missing folder is not told to add an anchor either', () => {
    // Bug 0033's message half. Since a project-relative glob resolves against
    // the root, one that matches nothing fails because the FOLDER is missing —
    // not because it lacks `"**/"`. Classifying it `unanchored` would print a
    // remedy that changes a spelling which is already correct, and leaves the
    // rule just as empty: ADR-008 rule 2, a fix that does not fix.
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: 'src/no-such-folder/**' }))
    expect(message).toContain('ghost: "src/no-such-folder/**"')
    expect(message).toContain('anchored but matched no file')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('assignedFrom(): already-anchored globs are NOT told to add an anchor', () => {
    // The false-remedy class one level down: '**/'-prefixed globs that simply
    // point at a missing directory.
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: '**/does-not-exist/**' }))
    expect(message).toContain('anchored but matched no file')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('assignedFrom(): an anchored glob that matches nothing lists causes, asserts none', () => {
    // '**/src/domain' is anchored and its directory EXISTS — it just matches the
    // directory entry, not the files under it. Earlier revisions asserted a single
    // cause here ("the directory does not exist" / "append /**"), and each was
    // false on a reachable input — a glob targeting a file, or a directory whose
    // name ends in ']' or '}'. So the message offers causes without picking one.
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: '**/src/domain' }))
    expect(message).toContain('anchored but matched no file')
    expect(message).toContain('append "/**"') // offered as a possible cause
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('does not assert a cause it cannot verify (file glob, or a "]"-terminated name)', () => {
    // Both of these were previously told "append /**" or "the directory does not
    // exist"; neither statement was true. They must land on the non-asserting branch.
    for (const glob of ['**/src/nope/index.ts', '**/src/{routes,services}', '**/src/app/[slug]']) {
      const message = discoveryMessage((b) => b.assignedFrom({ ghost: glob }))
      expect(message, glob).toContain('anchored but matched no file')
      expect(message, glob).not.toContain('do not exist in this project')
    }
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
    // `'*/domain/**'` is the still-unanchored shape; `'src/domain/**'` stopped
    // being one in bug 0033 and is asserted below instead.
    expect(resolveByDefinition(p, { x: '*/domain/**' })[0]!.files).toHaveLength(0)
    expect(resolveByDefinition(p, { x: '**/domain/**' })[0]!.files.length).toBeGreaterThan(0)
  })

  it('a project-relative glob resolves against the project root (bug 0033)', () => {
    // The gap this closed: `assignedFrom` was the one surface that rejected the
    // spelling the path predicates and `matching()` both accepted, so
    // `layers: { api: 'src/api/**' }` failed beside a `shared: ['src/shared/**']`
    // that worked, in the same preset call.
    expect(resolveByDefinition(p, { x: 'src/domain/**' })[0]!.files.length).toBeGreaterThan(0)
    // And it means the ROOT one specifically — the same set as the absolute form.
    const rel = resolveByDefinition(p, { x: 'src/domain/**' })[0]!.files.map((f) => f.getFilePath())
    const abs = resolveByDefinition(p, { x: '**/src/domain/**' })[0]!.files.map((f) =>
      f.getFilePath(),
    )
    expect(rel.sort()).toEqual(abs.sort())
  })

  it('a mixed definition names BOTH the unanchored and the anchored-but-missing', () => {
    // Naming only the unanchored subset sends the caller through a second failing
    // run to discover the rest — every slice is empty, so all of them are at fault.
    const message = discoveryMessage((b) =>
      b.assignedFrom({ bad: '*/nope/**', alsoBad: '**/does-not-exist/**' }),
    )
    expect(message).toContain('bad: "*/nope/**"')
    expect(message).toContain('alsoBad: "**/does-not-exist/**"')
    expect(message).toContain(ANCHOR_ADVICE)
  })

  it('an absolute glob is not told to add an anchor', () => {
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: '/abs/missing/**' }))
    expect(message).toContain('anchored but matched no file')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('a Windows drive-absolute glob is not told to add an anchor', () => {
    // '**/C:/...' would be worse than the original, so the anchor advice is false here.
    const message = discoveryMessage((b) => b.assignedFrom({ ghost: 'C:/repo/missing/**' }))
    expect(message).toContain('anchored but matched no file')
    expect(message).not.toContain(ANCHOR_ADVICE)
  })

  it('a "./" segment gets its own remedy, wherever it appears', () => {
    // Both a leading './' and an interior one ('**/./src') are unmatchable AND
    // unfixable by prefixing, so neither may receive the anchor advice.
    for (const glob of ['./src/domain/**', '**/./src/domain/**']) {
      const message = discoveryMessage((b) => b.assignedFrom({ ghost: glob }))
      expect(message, glob).toContain('"./" segment')
      expect(message, glob).not.toContain(ANCHOR_ADVICE)
      expect(message, glob).not.toContain('do not exist in this project')
    }
  })

  it('every fault in a mixed definition is named with its OWN remedy', () => {
    // The failure mode this replaces: reporting one group and stopping, so the
    // caller fixes what was named, gets a green build, and never learns the rest
    // were also broken.
    const message = discoveryMessage((b) =>
      b.assignedFrom({
        unanchored: '*/nope/**',
        missing: '**/does-not-exist/**',
        dotted: './src/x/**',
        dirOnly: '**/src/domain',
      }),
    )
    for (const key of ['unanchored:', 'missing:', 'dotted:', 'dirOnly:']) {
      expect(message, key).toContain(key)
    }
    expect(message).toContain(ANCHOR_ADVICE)
    expect(message).toContain('"./" segment')
    expect(message).toContain('append "/**"')
    expect(message).toContain('anchored but matched no file')
  })

  it('truncates within a fault group but never hides a whole group', () => {
    // `*/`-prefixed, so these stay in the UNANCHORED group. A project-relative
    // spelling resolves against the root since bug 0033, which would collapse
    // everything into one `no-match` group and quietly retire the second half
    // of this test — that a second group survives truncation.
    const many: Record<string, string> = { shared: '*/shared/**' }
    for (let i = 0; i < 8; i++) many[`layer${String(i)}`] = `*/nope-${String(i)}/**`
    many.missing = '**/does-not-exist/**' // a second fault group
    const message = discoveryMessage((b) => b.assignedFrom(many))
    expect(message).toContain('shared:') // error-prone key is always kept
    expect(message).toContain('and 5 more')
    expect(message).toContain('missing:') // the other group survives truncation
  })

  it('EVERY remedy is true: applying what each message says fixes the rule', () => {
    // The generalization of "the anchor remedy is TRUE", and the guard that this
    // family of bugs kept evading. Three rounds of fixes each shipped a new
    // confidently-worded sentence that was false on a reachable path, because only
    // one branch had a test that executed its own advice. This table executes all
    // of them: fire the branch, apply the transformation it recommends, and assert
    // discovery recovers. A future branch cannot ship a false remedy and stay green.
    const nested = (): ArchProject => {
      const tsMorphProject = new Project({ useInMemoryFileSystem: true })
      tsMorphProject.createSourceFile('/repo/src/features/auth/user.ts', 'export const u = 1')
      tsMorphProject.createSourceFile('/repo/src/features/billing/order.ts', 'export const o = 1')
      return {
        tsConfigPath: '/repo/tsconfig.json',
        _project: tsMorphProject,
        getSourceFiles: () => tsMorphProject.getSourceFiles(),
      }
    }

    type Case = {
      readonly branch: string
      readonly marker: string
      readonly broken: (b: SliceRuleBuilder) => SliceRuleBuilder
      readonly remedy: (b: SliceRuleBuilder) => SliceRuleBuilder
    }

    const cases: readonly Case[] = [
      {
        branch: 'no slice source',
        marker: 'No slice source',
        broken: (b) => b,
        remedy: (b) => b.matching('src/features/*'),
      },
      {
        branch: 'matching: no directory prefix',
        marker: 'no literal directory prefix',
        broken: (b) => b.matching('src'),
        remedy: (b) => b.matching('src/features/*'),
      },
      {
        branch: 'matching: prefix not found',
        marker: 'was not found in any of this',
        broken: (b) => b.matching('src/nope/*'),
        remedy: (b) => b.matching('src/features/*'),
      },
      {
        branch: 'assignedFrom: no entries',
        marker: 'no entries',
        broken: (b) => b.assignedFrom({}),
        remedy: (b) => b.assignedFrom({ a: '**/auth/**', b: '**/billing/**' }),
      },
      {
        branch: 'assignedFrom: unanchored',
        marker: 'prefix these with "**/"',
        // `*/`, not a project-relative spelling: since bug 0033 the latter
        // resolves against the project root, so it is no longer broken and this
        // case would stop exercising the branch it names.
        broken: (b) => b.assignedFrom({ a: '*/features/auth/**', b: '*/features/billing/**' }),
        remedy: (b) =>
          b.assignedFrom({ a: '**/src/features/auth/**', b: '**/src/features/billing/**' }),
      },
      {
        branch: 'assignedFrom: "./" segment',
        marker: '"./" segment',
        broken: (b) =>
          b.assignedFrom({ a: './src/features/auth/**', b: './src/features/billing/**' }),
        remedy: (b) =>
          b.assignedFrom({ a: '**/src/features/auth/**', b: '**/src/features/billing/**' }),
      },
      {
        branch: 'assignedFrom: anchored but matching nothing',
        marker: 'anchored but matched no file',
        broken: (b) => b.assignedFrom({ a: '**/src/features/auth', b: '**/src/features/billing' }),
        remedy: (b) =>
          b.assignedFrom({ a: '**/src/features/auth/**', b: '**/src/features/billing/**' }),
      },
    ]

    for (const testCase of cases) {
      const before = testCase
        .broken(slices(nested()))
        .should()
        .beFreeOfCycles()
        .violations()
        .filter((v) => v.bypassFilters === true)
      expect(before, `${testCase.branch}: should report a config finding`).toHaveLength(1)
      expect(before[0]!.message, `${testCase.branch}: message identifies the branch`).toContain(
        testCase.marker,
      )

      const after = testCase
        .remedy(slices(nested()))
        .should()
        .beFreeOfCycles()
        .violations()
        .filter((v) => v.bypassFilters === true)
      expect(
        after,
        `${testCase.branch}: the remedy this message states must actually fix it — got: ${after[0]?.message ?? ''}`,
      ).toEqual([])
    }
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
