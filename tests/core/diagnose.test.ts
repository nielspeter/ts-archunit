/**
 * `diagnose()` — the in-process half of `doctor` (plan 0069 R2a).
 *
 * Exists because rules written inside vitest are a co-equal documented path
 * (`docs/running-in-tests.md`). A CLI-only diagnostic would leave half the
 * users unable to measure before R3 flips anything, which is R2a's one job.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { diagnose } from '../../src/core/diagnose.js'
import { modules, classes, slices, smells, or, not } from '../../src/index.js'
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

  it('returns nothing rather than guessing when no rule can name a project', () => {
    // A diagnostic run against a DIFFERENT project than the rules run on is
    // wrong in both directions — phantom faults and missed ones. Silence is
    // the honest answer.
    expect(diagnose([{ violations: () => [] }])).toEqual([])
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
