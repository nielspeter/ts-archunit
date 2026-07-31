/**
 * An allowlist that tested no edges says so — bug 0015.
 *
 * The `only*` family constrains **edges**, not subjects, so a subject with zero
 * edges has nothing to violate and passes however broken the allowlist.
 * Measured on the canonical case: a `domain/` module with no imports,
 * `onlyImportFrom('**\/nowhere/**')` → **1 subject, 0 violations**. In a layered
 * architecture the innermost layer is the one an allowlist protects and is
 * characteristically the layer with the fewest outbound imports, so the shape it
 * fails on is the target case.
 *
 * ## Why these tests assert a disclosure and not a failure
 *
 * Bug 0015 refuted failing, on measurement, per-subject and per-rule. For the
 * `only*` family **zero edges is maximal compliance**: `tarjan.ts` is a
 * dependency-free algorithm and the ideal innermost-layer citizen, and every
 * available remedy — add an import, exclude the rule, narrow the selector,
 * delete the rule — makes something worse. ADR-008 rule 1 puts a finding the
 * reader must judge on the reporting surface, not in the exit code.
 *
 * So the thing to guard is that the disclosure **discriminates**: it must name
 * the rule that tested nothing and stay silent about the one that tested
 * something. A notice that fires for every rule is noise, and noise is how a
 * real signal gets ignored.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Project } from 'ts-morph'
import { modules } from '../../src/index.js'
import { onlyImportFrom } from '../../src/conditions/dependency.js'
import {
  recordEdgeCoverage,
  untestedRules,
  edgeCoverageNotice,
  resetEdgeCoverage,
} from '../../src/core/edge-coverage.js'
import { formatViolationsJson } from '../../src/core/format-json.js'
import type { ArchProject } from '../../src/core/project.js'

/** A domain module with no imports, and an app module that imports it. */
function layered(): ArchProject {
  const tsMorphProject = new Project({ useInMemoryFileSystem: true })
  tsMorphProject.createSourceFile('/src/domain/entity.ts', 'export class Entity { id = 1 }')
  tsMorphProject.createSourceFile(
    '/src/app/service.ts',
    "import { Entity } from '../domain/entity.js'\nexport const s = Entity",
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

beforeEach(() => {
  resetEdgeCoverage()
})

describe('the vacuous pass is reported', () => {
  it('still passes, because zero edges is compliance and not a fault', () => {
    // The behaviour bug 0015 decided NOT to change, asserted so a later reader
    // does not "fix" it into a failure. Per-subject failure has no statable
    // remedy: nothing is wrong with a dependency-free module.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyImportFrom('**/nowhere/**')

    expect(rule.violations()).toEqual([])
  })

  it('names the rule that tested no edges', () => {
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyImportFrom('**/nowhere/**')
    rule.violations()

    const untested = untestedRules()
    expect(untested).toHaveLength(1)
    expect(untested[0]?.subjects).toBe(1)
    expect(untested[0]?.edges).toBe(0)
    expect(untested[0]?.rule).toContain('only import from')
  })

  it('stays silent about a rule that did test edges', () => {
    // The discriminator, and the whole difference between a signal and noise.
    // Without it, a tally that reported every rule would satisfy the test above.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/app/**')
      .should()
      .onlyImportFrom('**/src/domain/**')
    rule.violations()

    expect(untestedRules()).toEqual([])
    expect(edgeCoverageNotice()).toBeUndefined()
  })

  it('never even runs the condition when the selector is empty', () => {
    // Why an empty selector is not this mechanism's business, pinned as the
    // fact rather than assumed: the builder short-circuits, so `evaluate` is
    // not called and nothing is recorded. An empty selector belongs to
    // `.expectNonEmpty()` and plan 0067; reporting it here would give one fault
    // two owners and two remedies.
    //
    // The first version of this test asserted `untestedRules()` was empty after
    // an empty-selector rule and called that a guard. It passed because nothing
    // was recorded either way — sabotage (removing the `subjects > 0` filter)
    // left it green. It now asserts the mechanism instead of the symptom.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/nonexistent/**')
      .should()
      .onlyImportFrom('**/nowhere/**')
    rule.violations()

    expect(rule.subjects()).toEqual([])
    expect(untestedRules()).toEqual([])
  })

  it('excludes a zero-subject record if one is ever made', () => {
    // The `subjects > 0` filter, tested where it is reachable. The builder
    // cannot produce this today (above), so the filter is a guard against a
    // future builder that stops short-circuiting — and an untested guard is the
    // thing this repository does not ship.
    recordEdgeCoverage('a rule with no subjects', 0, 0)
    recordEdgeCoverage('a rule with subjects and no edges', 3, 0)

    expect(untestedRules().map((u) => u.rule)).toEqual(['a rule with subjects and no edges'])
  })

  it('stays silent about onlyBeImportedVia when the subject HAS importers', () => {
    // The discriminator for the reverse direction. Without it, a broken counter
    // that never increments still reports "0 edges" and the test below — which
    // only asserts the untested case — passes. Sabotage found exactly that.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyBeImportedVia('**/src/app/**')
    rule.violations()

    expect(untestedRules()).toEqual([])
  })

  it('stays silent about onlyHaveTypeImportsFrom when an import is in scope', () => {
    // Same discriminator for the type-import allowlist. `service.ts` imports
    // from `domain/`, so the allowlist below scopes one real edge in.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/app/**')
      .should()
      .onlyHaveTypeImportsFrom('**/src/domain/**')
    rule.violations()

    expect(untestedRules()).toEqual([])
  })

  it('covers the reverse direction and the type-import allowlist too', () => {
    // All three sites bug 0015 lists, not just the one in its title.
    const project = layered()

    const noImporters = modules(project)
      .that()
      .resideInFolder('**/src/app/**')
      .should()
      .onlyBeImportedVia('**/nowhere/**')
    noImporters.violations()
    expect(untestedRules().map((u) => u.rule)).toContainEqual(
      expect.stringContaining('only be imported via'),
    )

    resetEdgeCoverage()
    const noTypeImports = modules(project)
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyHaveTypeImportsFrom('**/nowhere/**')
    noTypeImports.violations()
    expect(untestedRules().map((u) => u.rule)).toContainEqual(
      expect.stringContaining('only have type imports from'),
    )
  })
})

describe('the notice states the right cause, which is three different sentences', () => {
  /**
   * Review measured the first version printing "correct for a genuinely
   * dependency-free module" for all three cases. It is false for two of them:
   * a subject whose imports were filtered by `ignoreTypeImports` HAS
   * dependencies — a reader opens the folder, finds them, and concludes the
   * tool is broken — and a rule whose allowlist matched no import is sitting on
   * the interesting case, a possible typo, which that sentence hides. ADR-008
   * rule 2: a stated cause that is wrong for the input.
   */
  function withImports(): ArchProject {
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile('/src/domain/pure.ts', 'export class E {}')
    tsMorphProject.createSourceFile('/src/infra/db.ts', 'export const db = 1')
    tsMorphProject.createSourceFile(
      '/src/app/typed.ts',
      "import type { E } from '../domain/pure.js'\nexport const s: E | null = null",
    )
    tsMorphProject.createSourceFile(
      '/src/app/runtime.ts',
      "import { db } from '../infra/db.js'\nexport const r = db",
    )
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  }

  it('says "no imports at all" only when that is true', () => {
    modules(withImports())
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyImportFrom('**/nowhere/**')
      .violations()

    expect(untestedRules()[0]?.reason).toBe('no-edges')
    expect(edgeCoverageNotice()).toContain('no imports at all')
  })

  it('says the imports were filtered when ignoreTypeImports excluded them', () => {
    modules(withImports())
      .that()
      .resideInFile('**/src/app/typed.ts')
      .should()
      // The builder method is variadic-only, so `ignoreTypeImports` is reached
      // through the condition — which is also the shape the docs recommend for
      // layer isolation, and therefore the shape this cause matters for.
      .satisfy(onlyImportFrom(['**/nowhere/**'], { ignoreTypeImports: true }))
      .violations()

    expect(untestedRules()[0]?.reason).toBe('all-filtered')
    const notice = edgeCoverageNotice()
    expect(notice).toContain('DO have imports')
    expect(notice).toContain('ignoreTypeImports')
    // The discriminator: it must NOT claim the module is dependency-free.
    expect(notice).not.toContain('no imports at all')
  })

  it('says the glob matched nothing when that is the reason', () => {
    modules(withImports())
      .that()
      .resideInFolder('**/src/app/**')
      .should()
      .onlyHaveTypeImportsFrom('**/nowhere/**')
      .violations()

    expect(untestedRules()[0]?.reason).toBe('none-matched')
    const notice = edgeCoverageNotice()
    expect(notice).toContain('none matched the allowlist glob')
    expect(notice).toContain('the glob is wrong')
    expect(notice).not.toContain('no imports at all')
  })
})

describe('two runs of one rule description', () => {
  it('keeps the vacuous run rather than letting the exercised one erase it', () => {
    // Measured by review: with `Math.max`, the same rule text evaluated over an
    // edge-bearing project and then an edgeless one reported NOTHING — the
    // exercised run masked the vacuous one. For a disclosure of vacuity the
    // conservative direction is the smaller evidence.
    recordEdgeCoverage('one description, two projects', 5, 9, 'no-edges')
    recordEdgeCoverage('one description, two projects', 3, 0, 'no-edges')

    expect(untestedRules().map((u) => u.rule)).toEqual(['one description, two projects'])
  })

  it('still reports nothing when both runs tested edges', () => {
    // The discriminator: taking the minimum must not turn an exercised rule
    // into a reported one.
    recordEdgeCoverage('exercised twice', 5, 9, 'no-edges')
    recordEdgeCoverage('exercised twice', 3, 2, 'no-edges')

    expect(untestedRules()).toEqual([])
  })
})

describe('the notice a reader actually sees', () => {
  it('names the rules rather than counting them', () => {
    // ADR-008 rule 4. "3 rules tested nothing" sends the reader to grep, and
    // the point is that only they can judge whether it is correct here.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyImportFrom('**/nowhere/**')
    rule.violations()

    const notice = edgeCoverageNotice()
    expect(notice).toBeDefined()
    expect(notice).toContain('**/src/domain/**')
    expect(notice).toContain('1 subject, 0 edges')
    // States why it might be fine, because the remedy is genuinely optional.
    expect(notice).toContain('Only you can tell')
  })

  it('reaches the JSON document structurally, not as prose', () => {
    // An agent parses stdout. A notice that existed only on stderr would be
    // invisible to the consumer this project is built for.
    //
    // The coverage is PASSED IN, not read from module state. The first version
    // of this test called `formatViolationsJson([])` after evaluating a rule and
    // asserted the document described that rule — encoding as intended behaviour
    // the impurity review found: a per-rule JSON document in a vitest suite
    // named every rule that had run before it in the process.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyImportFrom('**/nowhere/**')
    rule.violations()

    const parsed: unknown = JSON.parse(formatViolationsJson([], undefined, untestedRules()))
    if (parsed === null || typeof parsed !== 'object' || !('untestedAllowlists' in parsed)) {
      throw new Error('no untestedAllowlists in the report')
    }
    const listed: readonly unknown[] = Array.isArray(parsed.untestedAllowlists)
      ? parsed.untestedAllowlists
      : []
    // Named, not counted — `toHaveLength(1)` passed with the rule field replaced
    // by a constant, which is the identity an agent needs (ADR-008 rule 5).
    // Fields read individually rather than through `expect.stringContaining`,
    // which is typed `any` and which ADR-005 bars from flowing into an
    // assertion.
    expect(listed).toHaveLength(1)
    const first = listed[0]
    if (first === null || typeof first !== 'object') throw new Error('not an entry')
    const named = 'rule' in first && typeof first.rule === 'string' ? first.rule : ''
    expect(named).toContain('**/src/domain/**')
    expect('subjects' in first ? first.subjects : undefined).toBe(1)
    expect('edges' in first ? first.edges : undefined).toBe(0)
  })

  it('does not describe a rule it was not given', () => {
    // The purity property, asserted directly: evaluate a vacuous rule, then
    // format a document WITHOUT passing the coverage. It must be empty.
    const rule = modules(layered())
      .that()
      .resideInFolder('**/src/domain/**')
      .should()
      .onlyImportFrom('**/nowhere/**')
    rule.violations()
    expect(untestedRules()).toHaveLength(1)

    const parsed: unknown = JSON.parse(formatViolationsJson([]))
    if (parsed === null || typeof parsed !== 'object' || !('untestedAllowlists' in parsed)) {
      throw new Error('no untestedAllowlists in the report')
    }
    expect(parsed.untestedAllowlists).toEqual([])
  })

  it('is an empty array when every allowlist was exercised, not an absent key', () => {
    // A consumer must be able to tell "none" from "this version does not report
    // it". An omitted key cannot express the first.
    const parsed: unknown = JSON.parse(formatViolationsJson([]))
    if (parsed === null || typeof parsed !== 'object' || !('untestedAllowlists' in parsed)) {
      throw new Error('no untestedAllowlists in the report')
    }
    expect(parsed.untestedAllowlists).toEqual([])
  })
})
