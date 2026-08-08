import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import fs from 'node:fs'
import { modules, functions, classes, or, defineCondition } from '../../src/index.js'
import type { Condition } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { ClassDeclaration } from 'ts-morph'
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
 * `condition` and `exclusion` positions are never faults.
 *
 * **`discovery` did NOT already fail, and this docstring claimed it did.** That
 * was the false premise [plan 0080](../../plans/completed/0080-admit-discovery-globs-to-the-dead-glob-gate.md)
 * was filed to correct: `diagnose()` treated discovery as a fault and this gate
 * did not, so `doctor` reported a dead layer glob and the build stayed green. The
 * sentence survived the fix, in the one place a reader checks the premise. Both
 * positions are faults now, and `isFaultPosition` is the single owner of that.
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
    // `modules`, not `classes`: the live branch has to actually select
    // something, or `emptyIsPass` fires on the empty runtime selection and this
    // stops testing the tree model at all. Measured — `**/domain/**` holds 3
    // modules and 0 classes, so the first version of this test passed for the
    // wrong reason until R3b made it fail.
    const rule = modules(p)
      .that()
      .satisfy(or(resideInFolder('**/no-such-folder/**'), resideInFolder('**/domain/**')))
      .should()
      .notImportFrom('**/nothing-imports-this/**')
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

/**
 * `emptyIsPass` — an empty selection is a fault by default (plan 0074, R3b).
 *
 * The other half of the flip, and the one that fires at **runtime** rather than
 * statically. A condition reports a violation when SOME subject fails; over an
 * empty subject set that is vacuously false, so the rule passed and the suite
 * counted it as coverage. `.expectNonEmpty()` was the opt-in, and
 * `terminal-builder.ts` records why that was not enough: it is "the opt-in this
 * whole plan exists because nobody uses".
 *
 * The escape hatch is `.expectEmpty()`, not `.allowEmpty()` — 0069's appendix
 * rejected the latter as "one word, silent forever, typo or not, and nothing
 * revisits it". The difference is that `.expectEmpty()` is an **assertion**.
 */
describe('an empty selection is a fault by default (plan 0074, emptyIsPass)', () => {
  it('fails when the selector matches nothing at runtime', () => {
    // The glob is satisfiable — `**/domain/**` exists — so this is not the
    // static fault. Nothing in it has this name, which is the runtime case.
    const rule = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .and()
      .haveNameMatching(/^definitely-not-a-module-name$/)
      .should()
      .notImportFrom('**/x/**')

    const [finding] = rule.violations()
    expect(finding?.bypassFilters).toBe(true)
    expect(finding?.suggestion).toContain('.expectEmpty()')
  })

  it('CONTROL: a selection with subjects is untouched', () => {
    const rule = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .notImportFrom('**/no-such-target/**')
    expect(rule.violations()).toEqual([])
  })

  it('.expectEmpty() accepts an empty selection', () => {
    const rule = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .and()
      .haveNameMatching(/^definitely-not-a-module-name$/)
      .expectEmpty()
      .should()
      .notImportFrom('**/x/**')
    expect(rule.violations()).toEqual([])
  })

  it('.expectEmpty() FAILS the day the selection stops being empty', () => {
    // This is the whole difference from the rejected `.allowEmpty()`. A silencer
    // stays silent forever; an assertion reports when its premise expires.
    const rule = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .expectEmpty()
      .should()
      .notImportFrom('**/x/**')

    // Derived, not hard-coded: `'matched 3'` sat here and broke the day an
    // unrelated file was added to the shared fixture. The property is that the
    // message reports the REAL count, so take the count from the same selector.
    const matched = modules(p).that().resideInFolder('**/domain/**').subjects().length
    expect(matched).toBeGreaterThan(0)

    const [finding] = rule.violations()
    expect(finding?.message).toContain('.expectEmpty() asserted this rule examines nothing')
    // `examinedUnits()` is `filterElements().length` — the same number `matched`
    // was — so the property this row asserts (the message reports the REAL count,
    // never a hard-coded one) survives plan 0099's rewording verbatim.
    expect(finding?.message).toContain(`examined ${String(matched)} subjects`)
    expect(finding?.bypassFilters).toBe(true)
  })

  it('refuses both emptiness assertions on one rule, at build time', () => {
    // 0069's appendix: "a contradiction and must fail at build time, not
    // silently pick one". Both orders, because picking one silently would be
    // order-dependent and only one order would be caught.
    const base = modules(p).that().resideInFolder('**/domain/**')
    expect(() => base.expectEmpty().expectNonEmpty()).toThrow(TypeError)
    expect(() => base.expectNonEmpty().expectEmpty()).toThrow(TypeError)
  })

  it('a cardinality condition still exempts, and only when EVERY condition is one', () => {
    // `andShould()` ANDs. A rule that asserts `notExist()` AND something about
    // subjects that exist is not satisfied by emptiness — exempting it on the
    // strength of one condition would silence the other. 0069's appendix names
    // this as an implementation constraint, and the first cut used `.some()`.
    const onlyCardinality = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .and()
      .haveNameMatching(/^nope$/)
      .should()
      .satisfy(notExist())
    expect(onlyCardinality.violations()).toEqual([])

    const mixed = modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .and()
      .haveNameMatching(/^nope$/)
      .should()
      .satisfy(notExist())
      .andShould()
      .notImportFrom('**/x/**')
    expect(mixed.violations()).toHaveLength(1)
  })

  it('the exemption cannot be set from outside this library', () => {
    // 0069's appendix constraint 2: `Condition` is a public export and
    // `defineCondition` is its sanctioned constructor, so a plain property
    // would be a one-line silent opt-out on any user condition — `.allowEmpty()`
    // relocated onto the condition object. The key is a module-private symbol.
    //
    // Derived independently of the implementation: the public entry point is
    // read for the symbol's name rather than the source of `cardinality.ts`.
    const publicApi = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../src/index.ts'),
      'utf-8',
    )
    expect(publicApi).not.toContain('ASSERTS_CARDINALITY')
    expect(publicApi).not.toContain('cardinality.js')

    // And `defineCondition` has no parameter for it, so the sanctioned
    // constructor cannot produce one either.
    const userCondition = defineCondition<never>('user condition', () => [])
    expect(Object.getOwnPropertySymbols(userCondition)).toEqual([])
  })
})

describe('the cardinality exemption cannot be forged (bug 0050)', () => {
  // A module-private `unique symbol` keyed onto the condition was thought
  // unreachable: a consumer cannot import it to name the key. They never needed
  // to — four shipped conditions carried it as an own property and `notExist` is
  // publicly exported, so the key was two lines away:
  //
  //   const stolen = Object.getOwnPropertySymbols(notExist())[0]
  //   const mine = { description: 'x', evaluate: () => [], [stolen]: true }
  //
  // Measured before the fix: honest condition on an empty selection → 1
  // configuration finding; that forgery → **0**. One line to exempt any rule from
  // the empty-selection gate, through documented exports.
  //
  // Found by review of plan 0081, which had just closed the identical hole in a
  // different symbol — while citing this one as the safe precedent. "Module-private"
  // describes the binding, not the value.
  const emptyProject = (): ArchProject => {
    const tsm = new Project({ useInMemoryFileSystem: true })
    tsm.createSourceFile('/a.ts', 'export class Real {}')
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }
  }
  /**
   * The gate's findings, BY IDENTITY — `toHaveLength(1)` cannot say WHICH finding,
   * and on this path a dead selector and a gated empty selection both yield
   * exactly one. Keyed on the element plus the sentence's opening clause, which is
   * what distinguishes the empty-selection gate from every other producer.
   */
  const gateFindings = (condition: Condition<ClassDeclaration>): string[] =>
    configFindings(condition).map(
      (v) =>
        `${v.element} :: ${v.message.includes('examined 0 subjects') ? 'examined 0 subjects' : v.message}`,
    )

  const configFindings = (condition: Condition<ClassDeclaration>): ArchViolation[] =>
    classes(emptyProject())
      .that()
      .haveNameMatching(/NoSuchClassAnywhere/)
      .should()
      .satisfy(condition)
      .violations()
      .filter((v) => v.bypassFilters === true)

  it('a shipped condition leaks no own symbol to copy', () => {
    expect(Object.getOwnPropertySymbols(notExist())).toEqual([])
  })

  it('CONTROL: an honest condition on an empty selection is still gated', () => {
    // Without this the row below passes when the gate stops firing altogether,
    // which would look like the forgery being blocked.
    const honest: Condition<ClassDeclaration> = {
      description: 'asserts nothing',
      evaluate: () => [],
    }
    expect(gateFindings(honest)).toEqual([
      'that have name matching /NoSuchClassAnywhere/ should asserts nothing :: examined 0 subjects',
    ])
  })

  it('a condition carrying every own key of a real one is still gated', () => {
    // The forgery, expressed the only way it now can be: copy everything the
    // shipped object exposes. Registry membership is not among it.
    const forged: Condition<ClassDeclaration> = {
      ...notExist<ClassDeclaration>(),
      description: 'a copy of every own property notExist() exposes',
      evaluate: () => [],
    }
    expect(gateFindings(forged)).toEqual([
      'that have name matching /NoSuchClassAnywhere/ should a copy of every own property notExist() exposes :: examined 0 subjects',
    ])
  })

  it('the real condition is still exempt, so the registry works at all', () => {
    // The other direction: if registration broke, `notExist()` would start
    // producing a finding on the pre-emptive guard it exists to permit, and the
    // rows above would pass for the wrong reason.
    expect(configFindings(notExist<ClassDeclaration>())).toEqual([])
  })
})
