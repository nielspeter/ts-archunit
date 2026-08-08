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
import { FAULT_ADVICE } from '../../src/core/glob-diagnosis.js'
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
    // `.expectEmpty()` because the fixture has no module importing fastify, so
    // this rule genuinely examines nothing — plan 0098 gave the rule-builder
    // family evidence and the preview now says so. Declaring it keeps the
    // assertion at `toEqual([])` (this file bans the weaker form) and keeps the
    // row about the ONE thing it tests: an import glob is never reported.
    const rule = modules(p)
      .that()
      .importFrom('fastify', '**/node_modules/typescript/**')
      .should()
      .notHaveDefaultExport()
      .expectEmpty()
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
    // A `./` segment, not an unanchored glob. This test used to use
    // `resideInFolder('src/domain/**')` and assert `unanchored` — plan 0067 C
    // made that spelling WORK (project-root-relative), so reporting it would be
    // telling the author to break a working rule. `./` is still a fault,
    // because it is a mistake in both readings: it never occurs in an absolute
    // path and says nothing extra in a relative one.
    const rule = classes(p).that().resideInFolder('./src/domain/**').should().beExported()
    const findings = diagnose([rule])
    expect(findings[0]?.fault).toBe('dot-segment')
    expect(findings[0]?.advice).toContain('remove it')
  })

  it('does not report a project-relative path glob, which now works', () => {
    // Plan 0067 C. `'src/domain/**'` means that folder AT THE PROJECT ROOT —
    // narrower than the `'**/src/domain/**'` the old advice prescribed, and
    // exactly what the author meant. The sibling test below established this
    // for `slices().matching()`; the path predicates now behave the same way.
    // `modules`, not `classes`: the non-vacuity control below has always checked
    // `modules(p)`, while the rule under test used `classes(p)` — and the fixture
    // has modules in that folder but no classes. So the control was proving a
    // different builder than the row diagnosed, and the row passed only because
    // nothing yet reported the rule-builder family's evidence. Plan 0098 made
    // that visible; the two now agree.
    const rule = modules(p).that().resideInFolder('src/domain/**').should().notHaveDefaultExport()
    expect(diagnose([rule])).toEqual([])

    // And it is not merely undiagnosed — it selects real subjects.
    expect(modules(p).that().resideInFolder('src/domain/**').subjects().length).toBeGreaterThan(0)
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
      // A mapping that never matches forms NO PAIRS, and pairs are what this
      // family examines — so `() => false` made the rule vacuous in a second way,
      // which plan 0098 now reports. The row is about the layer glob, so the
      // mapping just has to produce pairs.
      .mapping(() => true)
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
 * Bugs 0031 and 0032 — the cause the tool already knows, asserted where the
 * reader receives it.
 *
 * Both were found by plan 0074's gate run 4 against a real adopting codebase
 * whose root `tsconfig.json` is `"files": []` plus project references. The
 * fixture below is that shape for real, not an in-memory double: emptiness is a
 * property of the config being loaded, so if `project()` ever learns to follow
 * `references` this stops passing instead of silently guarding a branch nobody
 * reaches.
 *
 * These assert through `diagnose()` rather than against the advice constants.
 * A first version checked the constants and reimplemented the selection —
 * review measured two mutations of the real selection that left all 2719 tests
 * green, one of which appended the refuted causes straight back onto the
 * shipped string. A constant is not the message.
 */
describe('what cannot be blamed on the glob (bugs 0031, 0032)', () => {
  const solutionStyle = path.resolve(import.meta.dirname, '../fixtures/does-not-load/tsconfig.json')
  const referenced = path.resolve(
    import.meta.dirname,
    '../fixtures/does-not-load/pkg/tsconfig.json',
  )

  function load(tsConfigPath: string): ArchProject {
    const tsMorphProject = new Project({ tsConfigFilePath: tsConfigPath })
    return {
      tsConfigPath,
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  }

  const empty = load(solutionStyle)

  // A glob that matches the REFERENCED project for real, so applying the
  // remedy reaches silence rather than a different finding. With a glob the
  // fixture lacks, the remedy test would assert the wrong thing: repointing the
  // tsconfig clears `project-empty` and correctly reveals the dead glob, which
  // is not a failure of the remedy.
  const ruleFor = (target: ArchProject) =>
    modules(target)
      .that()
      .resideInFolder('**/does-not-load/pkg/src/**')
      .should()
      .notImportFrom('**/node_modules/**')

  it('the fixture is empty because the CONFIG is, not because the test says so', () => {
    // Without this the whole block could be guarding a project that is empty
    // for a reason the product never produces.
    expect(empty.getSourceFiles()).toEqual([])
    expect(load(referenced).getSourceFiles().length).toBeGreaterThan(0)
  })

  it('names the project and the mechanism, not the globs', () => {
    const findings = diagnose([ruleFor(empty)])
    expect(findings.map((f) => f.kind)).toEqual(['project-empty'])

    const [finding] = findings
    expect(finding?.advice).toContain('loaded 0 source files')
    expect(finding?.advice).toContain(solutionStyle)
    // The mechanism named, as a condition rather than a claim — see the test
    // below for why it is not asserted.
    expect(finding?.advice).toContain('project references')
    expect(finding?.advice).not.toContain('misspelled')
    // The rule field has shipped as `''` before (see `ruleName`), and `doctor`
    // prints it.
    expect(finding?.rule).toBeTruthy()
    expect(finding?.rule).not.toBe('unnamed')
  })

  it('the stated remedy clears the finding — applied, not asserted', () => {
    // ADR-008 rule 2: a remedy is verified by remediating. The message says to
    // point the rules at the tsconfig that holds the sources; this is that
    // edit, and the result must be silence. Identities, not a count — a
    // failure here should name what survived.
    const after = diagnose([ruleFor(load(referenced))])
    expect(after.map((f) => `${f.kind}: ${f.glob ?? f.advice}`)).toEqual([])
  })

  it('offers the solution-style cause as a CONDITION, never as a claim', () => {
    // A draft asserted it outright and told every reader to point elsewhere —
    // impossible where no such sibling exists (an `include` matching nothing, a
    // repo with no `.ts` at all). The repair that read the tsconfig to check
    // was removed by this project's OWN `hygiene/no-json-parse` rule, so the
    // clause is conditional instead: true either way, and the reader settles it
    // by looking at their own file.
    const advice = diagnose([ruleFor(empty)])[0]?.advice ?? ''
    expect(advice).toContain('if it delegates to project references')
    // Not a claim about THIS config.
    expect(advice).not.toContain('this one is solution-style')
  })

  it('reports each empty project, and each one once', () => {
    // Identity, not cardinality. A boolean instead of the set keeps a single
    // "once" assertion green while the SECOND project goes entirely silent —
    // it hits the early exit and contributes nothing at all. Review measured
    // exactly that mutation staying green.
    const other = load(solutionStyle) // same path, a DIFFERENT project object
    const findings = diagnose([ruleFor(empty), ruleFor(other), ruleFor(empty)])
    expect(findings.map((f) => f.kind)).toEqual(['project-empty', 'project-empty'])
    // `empty` twice collapses to one; `other` is its own project despite
    // sharing a tsconfig path — `workspace()` makes that reachable, and keying
    // on the path dropped the loser silently.
  })

  it('still reports a syntactic fault, which no project could fix', () => {
    // `./src/**` is dead in every possible project. Withholding it until the
    // config is corrected buys the reader a second failing round trip for a
    // fault already decided.
    const dotted = modules(empty)
      .that()
      .resideInFolder('./src/**')
      .should()
      .notImportFrom('**/x/**')
    const findings = diagnose([dotted])
    expect(findings.map((f) => `${f.kind}/${f.fault ?? '-'}`)).toEqual([
      'project-empty/-',
      'dead-glob/dot-segment',
    ])
  })

  it('still reports a rule that asserts nothing, which is a separate fault', () => {
    // The empty project must not become a blanket excuse: a condition-less rule
    // is condition-less whether or not anything loaded. Order is pinned, not
    // sorted — the two happen to be alphabetical, so a `.sort()` would hide a
    // reordering.
    const rule = modules(empty).that().resideInFolder('**/src/**')
    expect(diagnose([rule]).map((f) => f.kind)).toEqual(['no-condition', 'project-empty'])
  })

  it('a dead glob in a LOADED project gets the absent text, not the refuted causes', () => {
    // Bug 0032, through the shipped path. This is the assertion the constant
    // test could not make: it is the string `doctor` prints.
    const rule = modules(p)
      .that()
      .resideInFolder('**/definitely-not-a-folder-here/**')
      .should()
      .notImportFrom('**/x/**')

    const [finding] = diagnose([rule])
    expect(finding?.kind).toBe('dead-glob')
    expect(finding?.onDisk).toBe('absent')
    expect(finding?.glob).toBe('**/definitely-not-a-folder-here/**')
    expect(finding?.advice).toContain('under the project root')
    expect(finding?.advice).not.toContain('append')
    expect(finding?.advice).not.toContain('holds no source files')
    // And no excuse for a selector that selects nothing.
    expect(finding?.advice).not.toContain('legitimate')
  })

  it('CONTROL: not-determined still DEFERS to the cause list, end to end', () => {
    // The sibling test asserts `ON_DISK_ADVICE['not-determined'] === ''`, which
    // does not prove the caller falls back — review measured a mutation where
    // the empty string won and every such finding shipped with EMPTY advice,
    // suite green. `node_modules` is pruned by the walk, so this reaches
    // `not-determined` through the real code.
    const rule = modules(p)
      .that()
      .resideInFolder('**/node_modules/nothing-here/**')
      .should()
      .notImportFrom('**/x/**')

    const [finding] = diagnose([rule])
    expect(finding?.onDisk).toBe('not-determined')
    expect(finding?.advice).not.toBe('')
    expect(finding?.advice).toBe(FAULT_ADVICE['no-match'])
  })
})
