import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { modules, classes, functions, or } from '../../src/index.js'
import { resideInFolder } from '../../src/predicates/identity.js'
import { notExist } from '../../src/conditions/structural.js'
import { diagnose } from '../../src/core/diagnose.js'
import type { ArchProject } from '../../src/core/project.js'

const tsconfigPath = path.resolve(import.meta.dirname, '../fixtures/modules/tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const p = loadProject()

/**
 * R3b — a selector that can never match is a configuration finding (plan 0074).
 *
 * 0069's decision table: a **selector** glob that is unsatisfiable means the
 * rule can never have subjects, so it certifies nothing and passing is a lie.
 * `condition` and `exclusion` positions are never faults, and `discovery`
 * already failed (0067-D).
 *
 * The gate reuses `diagnose()`'s own functions deliberately. `doctor` is the
 * pre-flight that tells adopters what this flip will red; if the two computed
 * deadness separately that promise would be worth nothing, so the last test
 * here pins them to the same answer.
 */
describe('a dead selector fails at check time (plan 0074, R3b)', () => {
  it('reports the selector, not a violation of the rule', () => {
    const rule = modules(p)
      .that()
      .resideInFolder('**/no-such-folder/**')
      .should()
      .notImportFrom('**/anything/**')

    const found = rule.violations()
    expect(found).toHaveLength(1)
    expect(found[0]?.message).toContain('can never match anything in this project')
    expect(found[0]?.element).toBe('**/no-such-folder/**')
  })

  it('is a configuration finding, so no escape hatch downgrades it', () => {
    // ADR-008 rule 1. `bypassFilters` is what makes severity, `.excluding()`,
    // the baseline and diff-aware mode all refuse it. Asserting the flag rather
    // than each mechanism, because the flag is what every mechanism reads.
    const rule = modules(p)
      .that()
      .resideInFolder('**/no-such-folder/**')
      .should()
      .notImportFrom('**/x/**')
      .asSeverity('warn')

    const [finding] = rule.violations()
    expect(finding?.bypassFilters).toBe(true)
    expect(finding?.severity).toBe('error')
    // And the message says the hatches are refused, rather than leaving the
    // reader to discover it over four CI cycles.
    expect(finding?.message).toContain('cannot be suppressed')
  })

  it('CONTROL: a selector that CAN match is untouched', () => {
    // Without this, returning a finding unconditionally passes everything above.
    const rule = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .notImportFrom('**/no-such-target/**')
    expect(rule.violations()).toEqual([])
  })

  it('exempts a condition that declares emptiness as its passing state', () => {
    // The pre-emptive guard: "no module may appear in legacy/". Zero subjects is
    // the rule being SATISFIED. Declared by the condition (`assertsCardinality`),
    // never probed — probing asks "did it return violations for []?", which is
    // "no" for every condition ever written.
    const guard = modules(p)
      .that()
      .resideInFolder('**/no-such-folder/**')
      .should()
      .satisfy(notExist())
    expect(guard.violations()).toEqual([])
  })

  it('CONTROL: the exemption does not disable the condition it exempts', () => {
    // A `notExist()` over a selector that DOES match must still red, or the
    // exemption above would be indistinguishable from deleting the rule.
    const real = modules(p).that().resideInFolder('**/domain/**').should().satisfy(notExist())
    expect(real.violations().length).toBeGreaterThan(0)
  })

  it('does not fire for a condition-position glob, however dead', () => {
    // 0069's table, and plan 0072 got this wrong twice: a condition glob
    // matching nothing is indistinguishable from an armed tripwire that has not
    // fired. Banning a folder before it exists is legitimate and documented.
    //
    // The glob here is `parent-dir` in CONDITION position, which is the whole
    // point. A first version used `notImportFrom`, whose kind is
    // `import-target` — a kind with no path-universe views, so `isDeadSite` is
    // false for it whatever its position. That test passed for the wrong reason
    // and the sabotage matrix caught it: deleting the position filter outright
    // left it green.
    // `modules`, not `classes`: the fixture's `**/domain/**` holds 3 modules and
    // 0 classes, and over 0 subjects this would assert nothing — ∀ over ∅, the
    // vacuity this whole plan is about, inside its own guard.
    const tripwire = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .resideInFolder('**/no-such-folder/**')

    const found = tripwire.violations()
    // Ordinary violations — every subject fails the assertion — and NOT a
    // configuration finding. The rule works; the subjects do not satisfy it.
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((v) => v.bypassFilters !== true)).toBe(true)
    expect(found.some((v) => v.message.includes('can never match anything'))).toBe(false)
  })

  it('does not fire for a live tree that merely contains a dead branch', () => {
    // `or(dead, live)` is a working rule. Reporting its dead branch is the false
    // red the tree model exists to prevent.
    const rule = classes(p)
      .that()
      .satisfy(or(resideInFolder('**/no-such-folder/**'), resideInFolder('**/domain/**')))
      .should()
      .haveNameMatching(/./)
    expect(rule.violations().filter((v) => v.bypassFilters === true)).toEqual([])
  })

  it('reports the assertion-less rule instead when both are wrong', () => {
    // Ordering, committed to in `terminal-builder.ts` before R3b existed: no
    // selector makes an assertion-less rule capable of failing, so that is the
    // root cause. The selector fault resurfaces once there is something to
    // assert.
    const neither = functions(p).that().resideInFolder('**/no-such-folder/**')
    const [finding] = neither.violations()
    // The discriminator is which of the two findings it is, not the exact
    // wording of the winner — `assertionAdvice()` has seven per-shape texts and
    // pinning one here would break when an unrelated shape is reworded.
    expect(finding?.message).toContain('.should()')
    expect(finding?.message).not.toContain('can never match anything')
  })

  it('agrees with doctor, which is the pre-flight for this flip', () => {
    // The promise `doctor` makes is "this is what R3b will fail on". Two
    // separate deadness computations would make that promise worthless, so this
    // asserts the same rule is seen by both surfaces.
    const rule = modules(p)
      .that()
      .resideInFolder('**/no-such-folder/**')
      .should()
      .notImportFrom('**/x/**')

    expect(diagnose([rule]).map((f) => f.kind)).toEqual(['dead-glob'])
    expect(rule.violations()).toHaveLength(1)
  })
})
