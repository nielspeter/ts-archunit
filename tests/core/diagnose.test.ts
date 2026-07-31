/**
 * `diagnose()` — the in-process half of `doctor` (plan 0069 R2a).
 *
 * Exists because rules written inside vitest are a co-equal documented path
 * (`docs/running-in-tests.md`). A CLI-only diagnostic would leave half the
 * users unable to measure before R3 flips anything, which is R2a's one job.
 */
import path from 'node:path'
import picomatch from 'picomatch'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { diagnose } from '../../src/core/diagnose.js'
import {
  modules,
  classes,
  slices,
  smells,
  crossLayer,
  haveMatchingCounterpart,
  or,
  not,
  globAnyOf,
  stampGlobs,
} from '../../src/index.js'
import * as graphql from '../../src/graphql/index.js'
import { resideInFolder } from '../../src/predicates/identity.js'
import type { Located } from '../../src/predicates/identity.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const p = loadProject()

/** A second project, with folder names disjoint from `p`'s. */
const nestedProject: ArchProject = (() => {
  const nestedTsconfig = path.resolve(
    import.meta.dirname,
    '../fixtures/nested-slices/tsconfig.json',
  )
  const tsMorphProject = new Project({ tsConfigFilePath: nestedTsconfig })
  return {
    tsConfigPath: nestedTsconfig,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
})()

describe('diagnose', () => {
  it('reports a selector glob that can never match', () => {
    const rule = modules(p)
      .that()
      .resideInFolder('**/nowhere-at-all/**')
      .should()
      .notImportFrom('**/legacy/**')
      .rule({ id: 'test/dead-selector' })
    const findings = diagnose([rule])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('dead-glob')
    expect(findings[0]?.rule).toBe('test/dead-selector')
    expect(findings[0]?.glob).toBe('**/nowhere-at-all/**')
    expect(findings[0]?.position).toBe('selector')
  })

  it('says nothing about a rule whose globs all match', () => {
    const rule = modules(p).that().resideInFolder('**/domain/**').should().notHaveDefaultExport()
    expect(diagnose([rule])).toEqual([])
  })

  it('does NOT report a dead branch of a live or()', () => {
    // `or(dead, live)` is a working rule. Reporting the dead branch here is
    // the false red the whole tree model exists to prevent, and it is the
    // shape draft 4 of the plan would have got wrong.
    const rule = modules(p)
      .that()
      .satisfy(
        or(
          resideInFolder<Located>('**/nowhere-at-all/**'),
          resideInFolder<Located>('**/domain/**'),
        ),
      )
      .should()
      .notHaveDefaultExport()
    expect(diagnose([rule])).toEqual([])
  })

  it('does NOT report a negated dead glob — that over-selects, it does not vacuum', () => {
    const rule = modules(p)
      .that()
      .satisfy(not(resideInFolder<Located>('**/nowhere-at-all/**')))
      .should()
      .notHaveDefaultExport()
    expect(diagnose([rule])).toEqual([])
  })

  it('reports a rule that asserts nothing, so R3b can see proposal 019', () => {
    // A doctor that reported only glob faults would pass while 019's blast
    // radius was completely unknown — this plan's own question, asked of its
    // own gate.
    const rule = modules(p).that().resideInFolder('**/domain/**')
    const findings = diagnose([rule])
    expect(findings.map((f) => f.kind)).toEqual(['no-condition'])
  })

  it('reports every discovery glob of a fan-out, not just the first', () => {
    // One dead layer is one empty slice. Folding them into one node would
    // report a fault only when EVERY slice was empty — a false green.
    const rule = slices(p)
      .assignedFrom({ live: '**/domain/**', dead: '**/nowhere-at-all/**' })
      .should()
      .beFreeOfCycles()
    const findings = diagnose([rule])
    expect(findings.map((f) => f.glob)).toEqual(['**/nowhere-at-all/**'])
    expect(findings[0]?.position).toBe('discovery')
  })

  it('repeated inFolder() calls are ANY, not ALL', () => {
    // `folderMatchers.some` — one live scope is enough, so the set is dead
    // only when every glob in it is. Flipping this quantifier is what the
    // 0.18.1 withdrawal was, and it is the only reachable multi-glob
    // path-kind declaration in the codebase.
    const live = smells.duplicateBodies(p).inFolder('**/domain/**').inFolder('**/nowhere-at-all/**')
    expect(diagnose([live])).toEqual([])

    const dead = smells.duplicateBodies(p).inFolder('**/nowhere-a/**').inFolder('**/nowhere-b/**')
    expect(diagnose([dead])).toHaveLength(2)
  })

  it('never reports an import glob — node_modules is outside the project', () => {
    // Checking import-target against a path universe would fail every correct
    // dependency rule in existence. The exemption lives in `viewsFor`, and
    // removing it left the whole suite green.
    const rule = modules(p)
      .that()
      .importFrom('fastify', '**/node_modules/typescript/**')
      .should()
      .notHaveDefaultExport()
    expect(diagnose([rule])).toEqual([])
  })

  it('says nothing about a dead exclusion, and does report a dead scope', () => {
    // proposal 006: an exclusion matching zero is remedy-optional and never a
    // fault. `position` used to be copied into the finding and never read, so
    // this reported "a path segment is misspelled" about a correct rule.
    const excluded = smells
      .duplicateBodies(p)
      .inFolder('**/domain/**')
      .ignorePaths('**/nonexistent/**')
    expect(diagnose([excluded])).toEqual([])

    const scoped = smells.duplicateBodies(p).inFolder('**/nonexistent/**')
    expect(diagnose([scoped])).toHaveLength(1)
  })

  it('carries a verifiable remedy for a syntactic fault', () => {
    const rule = classes(p).that().resideInFolder('src/domain/**').should().beExported()
    const findings = diagnose([rule])
    expect(findings[0]?.fault).toBe('unanchored')
    expect(findings[0]?.advice).toContain('**/')
  })

  it('does NOT tell a normalized-base glob to anchor itself', () => {
    // `slices().matching()` strips and re-adds the anchor, so 'src/features/*'
    // is the correct spelling there. Reporting it unanchored would be telling
    // the user to break a working rule — and `base` is what distinguishes the
    // two, which is why the anchor check consults it while satisfiability
    // still takes the union of every view.
    const rule = slices(p).matching('src/domain/*').should().beFreeOfCycles()
    expect(diagnose([rule])).toEqual([])
  })

  it('says nothing about a rule that declares no globs and names no project', () => {
    expect(diagnose([{ violations: () => [] }])).toEqual([])
  })

  it('reports project-unknown rather than silence when globs cannot be checked', () => {
    // Silence here was the false green: a rule that declares globs and cannot
    // say which project to check them against used to be skipped, so a rule
    // file of nothing but such rules printed a clean bill of health.
    const opaque = {
      violations: () => [],
      globs: () => [
        stampGlobs(globAnyOf(['**/anywhere/**'], 'file-path'), 'selector', () => 'hand-built'),
      ],
    }
    expect(diagnose([opaque]).map((f) => f.kind)).toEqual(['project-unknown'])
  })

  it('a crossLayer rule CAN name its project, so its layer globs are checked', () => {
    // The shape that used to be silent. `project` is threaded through
    // MappedCrossLayerBuilder -> PairConditionBuilder -> PairFinalBuilder;
    // breaking any link in that chain puts this rule back in the
    // project-unknown bucket, which is what this asserts it is NOT.
    const rule = crossLayer(p)
      .layer('live', '**/domain/**')
      .layer('dead', '**/nowhere-at-all/**')
      .mapping(() => false)
      .forEachPair()
      .should(haveMatchingCounterpart([]))
    expect(rule.getProject()).toBe(p)
    expect(diagnose([rule]).map((f) => [f.kind, f.glob])).toEqual([
      ['dead-glob', '**/nowhere-at-all/**'],
    ])
  })

  it('a resolvers rule CAN name its project', () => {
    const rule = graphql.resolvers(p, 'src/nowhere-at-all/**')
    expect(rule.getProject()).toBe(p)
    // Exact identity, not membership: this rule is condition-less AND its glob
    // is dead, and as of plan 0070's instrument release ResolverRuleBuilder
    // implements `assertsSomething`, so BOTH findings appear — in this order.
    // Weakening this to `toContain` is the cheap green the plan bans: it would
    // stop pinning that no third finding appears.
    expect(diagnose([rule]).map((f) => f.kind)).toEqual(['no-condition', 'dead-glob'])
  })

  it('diagnoses each rule against ITS OWN project, not the first one it finds', () => {
    // Two projects with disjoint folder names. Resolving one project for the
    // whole array reports the other project's live glob as dead — the
    // documented monorepo hazard, committed by the diagnostic itself.
    const inModules = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .notHaveDefaultExport()
    const inNested = modules(nestedProject)
      .that()
      .resideInFolder('**/features/**')
      .should()
      .notHaveDefaultExport()
    expect(diagnose([inModules, inNested])).toEqual([])
    expect(diagnose([inNested, inModules])).toEqual([])
  })

  it('a rule s own project beats the explicit parameter', () => {
    // Backwards, the parameter re-checks every rule against one universe —
    // and `project-unknown`'s advice used to recommend passing it.
    const rule = modules(p).that().resideInFolder('**/domain/**').should().notHaveDefaultExport()
    expect(diagnose([rule], nestedProject)).toEqual([])
  })

  it('names WHICH glob of an all-dead or() is dead', () => {
    // Without the origin suffix both findings read identically and the reader
    // cannot tell which of the two to edit.
    const rule = modules(p)
      .that()
      .satisfy(
        or(resideInFolder<Located>('**/nowhere-a/**'), resideInFolder<Located>('**/nowhere-b/**')),
      )
      .should()
      .notHaveDefaultExport()
    const origins = diagnose([rule]).map((f) => f.origin)
    expect(origins).toHaveLength(2)
    expect(new Set(origins).size).toBe(2)
    expect(origins.join(' ')).toContain('**/nowhere-a/**')
  })
})

describe('kind, derived behaviourally rather than restated', () => {
  // `kind` names the string the MATCHER receives, and the plan records that
  // this derivation went wrong TWICE. Every existing assertion compares the
  // declaration to a literal in the test — the same intent written twice, not a
  // second derivation. These contradict it instead: build a glob that provably
  // selects real files, and require the diagnosis to agree that the rule is
  // live. Flipping any of these kinds produces a false red with a confidently
  // wrong remedy, and three of the six sites had no guard at all.
  const self: ArchProject = (() => {
    const tsMorphProject = new Project({ tsConfigFilePath: 'tsconfig.json' })
    return {
      tsConfigPath: path.resolve('tsconfig.json'),
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  })()
  const selects = (glob: string): number => {
    const isMatch = picomatch(glob)
    return self.getSourceFiles().filter((sf) => isMatch(sf.getFilePath())).length
  }

  it('assignedFrom: a file-shaped glob that DOES select files is not reported', () => {
    const glob = '**/src/core/*.ts'
    expect(selects(glob)).toBeGreaterThan(0)
    const rule = slices(self).assignedFrom({ core: glob }).should().beFreeOfCycles()
    expect(diagnose([rule])).toEqual([])
  })

  it('crossLayer: a file-shaped layer pattern that DOES select files is not reported', () => {
    const glob = '**/src/core/*.ts'
    expect(selects(glob)).toBeGreaterThan(0)
    const rule = crossLayer(self)
      .layer('core', glob)
      .layer('builders', '**/src/builders/*.ts')
      .mapping(() => false)
      .forEachPair()
      .should(haveMatchingCounterpart([]))
    expect(diagnose([rule])).toEqual([])
  })

  it('resolvers: a tsconfig-relative glob that DOES select files is not reported', () => {
    // Also the only guard on `base`: `tsconfig-relative` is what exempts this
    // glob from the anchor check, and removing that exemption tells every
    // `resolvers(p, 'src/…/**')` rule — the spelling in the API's own example —
    // to prefix `**/`, i.e. to break a working rule.
    //
    // The rule is condition-less, so plan 0070's instrument reports exactly
    // one `no-condition` finding — asserted by exact kind list so this stays
    // the only guard on `base`: any dead-glob finding here is still a failure.
    const rule = graphql.resolvers(self, 'src/graphql/**')
    expect(diagnose([rule]).map((f) => f.kind)).toEqual(['no-condition'])
  })

  it('matching: a file-shaped glob that DOES resolve slices is not reported', () => {
    const rule = slices(self).matching('src/core/*').should().beFreeOfCycles()
    expect(rule.violations()).toEqual([])
    expect(diagnose([rule])).toEqual([])
  })

  it('matching() with no literal prefix is reported, because it resolves nothing', () => {
    // `resolveByMatching` bails before matching: the slice name is the segment
    // after the literal prefix and there is none. The runtime guard fails, so
    // the pre-flight must not be silent about it.
    const rule = slices(self).matching('*').should().beFreeOfCycles()
    expect(rule.violations().length).toBeGreaterThan(0)
    expect(diagnose([rule]).map((f) => f.origin)).toEqual(['matching("*")'])
  })
})

describe('slices().matching() — the glob the matcher receives', () => {
  // A NESTED fixture, deliberately. `tests/fixtures/modules` has a flat
  // `src/domain/`, so the author's spelling `src/domain/*` happened to match
  // the tsconfig-relative file path and hid the fact that `matching()`
  // rewrites its glob before matching. Every nested-layout rule — the shape
  // docs/slices.md teaches — was reported dead.
  const nestedDir = path.resolve(import.meta.dirname, '../fixtures/nested-slices')
  const nestedTsconfig = path.join(nestedDir, 'tsconfig.json')
  const nested: ArchProject = (() => {
    const tsMorphProject = new Project({ tsConfigFilePath: nestedTsconfig })
    return {
      tsConfigPath: nestedTsconfig,
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  })()

  // Every spelling `parseMatchingGlob` treats as equivalent, including the two
  // that the syntactic checks would otherwise reject: an unanchored glob and a
  // './' prefix, both of which that function deliberately supports.
  it.each(['src/features/*', 'src/features/*/', './src/features/*', '**/src/features/*'])(
    'reports nothing for the working spelling %s',
    (glob) => {
      const rule = slices(nested).matching(glob).should().beFreeOfCycles()
      expect(rule.violations()).toEqual([])
      expect(diagnose([rule])).toEqual([])
    },
  )

  it('still reports a matching() glob that genuinely finds no slices', () => {
    const rule = slices(nested).matching('src/nowhere-at-all/*').should().beFreeOfCycles()
    const findings = diagnose([rule])
    expect(findings).toHaveLength(1)
    // `origin` keeps the author's spelling — that is what they have to go and
    // edit — while the declared glob is the rewritten one the matcher sees.
    expect(findings[0]?.origin).toBe('matching("src/nowhere-at-all/*")')
  })
})

describe('this repository, diagnosed by its own mechanism', () => {
  it('reports nothing for the arch suite after R-any', () => {
    // The end-to-end check that R-any actually closed what it claimed, run
    // through the shipped code rather than the spike script: build the same
    // shapes the dogfood rules use and confirm none of them is dead.
    const self: ArchProject = (() => {
      const tsMorphProject = new Project({ tsConfigFilePath: 'tsconfig.json' })
      return {
        tsConfigPath: path.resolve('tsconfig.json'),
        _project: tsMorphProject,
        getSourceFiles: () => tsMorphProject.getSourceFiles(),
      }
    })()

    const rules = [
      modules(self).that().resideInFolder('**/src/core/**').should().notHaveDefaultExport(),
      modules(self).that().resideInFolder('**/src/helpers/**').should().notHaveDefaultExport(),
      modules(self).that().resideInFolder('**/src/predicates/**').should().notHaveDefaultExport(),
      classes(self).that().resideInFolder('**/src/builders/**').should().beExported(),
    ]
    expect(diagnose(rules)).toEqual([])
  })
})

/**
 * Bug 0031 — when the project loaded nothing, the globs are not the fault.
 *
 * Found by plan 0074's gate run 4 against a real adopting codebase whose root
 * `tsconfig.json` is `"files": []` plus project references. Every glob is dead,
 * and diagnosing them one by one produced six findings whose advice said "a
 * path segment is misspelled" about correctly spelled globs — while `check`,
 * in the same run, named the real cause. `slice-rule-builder.ts` already states
 * the rule: "blaming the glob would send the caller to the wrong file
 * entirely."
 */
describe('an empty project (bug 0031)', () => {
  /** A project that loads no files, named by a path a reader can act on. */
  const emptyProject: ArchProject = (() => {
    const emptyTsconfig = path.resolve(
      import.meta.dirname,
      '../fixtures/does-not-load/tsconfig.json',
    )
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    return {
      tsConfigPath: emptyTsconfig,
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  })()

  it('names the project, not the globs', () => {
    const rule = modules(emptyProject)
      .that()
      .resideInFolder('**/src/routes/**')
      .should()
      .notImportFrom('**/src/repositories/**')

    const findings = diagnose([rule])

    expect(findings.map((f) => f.kind)).toEqual(['project-empty'])
    // The TEXT, not the kind. A fix that reports the right kind with
    // `no-match`'s cause list still sends the reader to edit a correct glob,
    // which is the whole defect.
    const [finding] = findings
    expect(finding?.advice).toContain('loaded 0 source files')
    expect(finding?.advice).toContain(emptyProject.tsConfigPath)
    expect(finding?.advice).not.toContain('misspelled')
  })

  it('reports once per project, however many rules and globs there are', () => {
    const rules = [
      modules(emptyProject).that().resideInFolder('**/a/**').should().notImportFrom('**/b/**'),
      modules(emptyProject).that().resideInFolder('**/c/**').should().notImportFrom('**/d/**'),
      modules(emptyProject).that().resideInFolder('**/e/**').should().notImportFrom('**/f/**'),
    ]
    // Six globs across three rules. The identity of this fault is the tsconfig,
    // so one finding names it — ADR-008 rule 4 asks for the identity, and here
    // the identity is not the glob.
    expect(diagnose(rules).map((f) => f.kind)).toEqual(['project-empty'])
  })

  it('still reports a rule that asserts nothing, which is a separate fault', () => {
    // The empty project must not become a blanket excuse. A condition-less rule
    // is condition-less whether or not anything loaded, and suppressing that
    // would trade one silent pass for another.
    const rule = modules(emptyProject).that().resideInFolder('**/src/**')
    expect(
      diagnose([rule])
        .map((f) => f.kind)
        .sort(),
    ).toEqual(['no-condition', 'project-empty'])
  })

  it('CONTROL: a loaded project with a genuinely wrong glob still gets the glob', () => {
    // Without this, returning `project-empty` unconditionally passes every
    // assertion above.
    const rule = modules(p)
      .that()
      .resideInFolder('**/definitely-not-a-folder-here/**')
      .should()
      .notImportFrom('**/x/**')

    const findings = diagnose([rule])
    expect(findings.map((f) => f.kind)).toEqual(['dead-glob'])
    expect(findings[0]?.glob).toBe('**/definitely-not-a-folder-here/**')
  })
})
