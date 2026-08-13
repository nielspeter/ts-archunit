/**
 * `.asSeverity('warn', { accepted })` — plan 0090.
 *
 * Two kinds of warning, one method. `.asSeverity('warn')` alone is ADVISORY:
 * permanent, unchanged from every release before this plan, for a finding
 * ADR-008 rule 1 says the reader must judge. `.asSeverity('warn', { accepted })`
 * is DEFERRED: debt, with a ceiling — a violation whose `subjectOf()` is not in
 * `accepted` escalates to `error`.
 *
 * The mechanism is deliberately identity-based, not a bare count. A bare `≤ N`
 * ceiling is exactly the anti-pattern `tests/archunit/dogfood.test.ts` already
 * argues against for a different reason (ADR-008 rule 5: "a ceiling reads as
 * coverage while a real regression can still hide under it") — a finding could
 * disappear while a different, genuinely new one appears, leaving the count
 * unchanged and the ceiling untripped. The swap test below is the point of the
 * whole design: it is the one case a bare count could never catch.
 */
import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'
import { classes, functions, checkAll, ArchRuleError } from '../../src/index.js'
import { diagnose } from '../../src/core/diagnose.js'
import { subjectOf } from '../../src/core/violation.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ClassRuleBuilder } from '../../src/builders/class-rule-builder.js'

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ useInMemoryFileSystem: true })
  tsMorphProject.createSourceFile('/src/alpha.ts', 'export class AlphaBad {}')
  tsMorphProject.createSourceFile('/src/beta.ts', 'export class BetaBad {}')
  tsMorphProject.createSourceFile('/src/gamma.ts', 'export class GammaBad {}')
  tsMorphProject.createSourceFile('/src/delta.ts', 'export class DeltaService {}')
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const p = loadProject()

/** Fresh builder per call — `.asSeverity()` returns a new immutable chain step. */
function rule(): ClassRuleBuilder {
  return classes(p)
    .that()
    .resideInFolder('**/src/**')
    .should()
    .haveNameMatching(/Service$/)
    .rule({ id: 'test/service-suffix' })
}

describe('VACUITY: the fixture really produces findings, not an empty selection', () => {
  it('three classes violate, one (DeltaService) does not', () => {
    const violations = rule().violations()
    expect(violations.map((v) => v.element).sort()).toEqual(['AlphaBad', 'BetaBad', 'GammaBad'])
  })
})

describe('an advisory warning (no accepted list) — unchanged behaviour', () => {
  it('every violation stays warn, however many, and checkAll never throws', () => {
    const violations = rule().asSeverity('warn').violations()
    expect(violations.map((v) => v.severity)).toEqual(['warn', 'warn', 'warn'])
    expect(() => checkAll([rule().asSeverity('warn')])).not.toThrow()
  })

  it('.check() still always throws, regardless of .asSeverity — the terminal is untouched', () => {
    expect(() => rule().asSeverity('warn').check()).toThrow(ArchRuleError)
  })

  it('.warn() still never throws for ordinary violations, regardless of .asSeverity', () => {
    expect(() => rule().warn()).not.toThrow()
  })

  it('diagnose() stays silent — an advisory warning is doing its job, not a problem', () => {
    expect(diagnose([rule().asSeverity('warn')])).toEqual([])
  })
})

describe('a deferred warning (accepted list) — plan 0090', () => {
  it('stays warn for accepted findings, escalates the one not accepted', () => {
    const found = rule().violations()
    const accepted = [
      subjectOf(found.find((v) => v.element === 'AlphaBad')!),
      subjectOf(found.find((v) => v.element === 'BetaBad')!),
    ]
    const violations = rule().asSeverity('warn', { accepted }).violations()
    const byElement = Object.fromEntries(violations.map((v) => [v.element, v.severity]))
    expect(byElement).toEqual({ AlphaBad: 'warn', BetaBad: 'warn', GammaBad: 'error' })
  })

  it('checkAll throws because of the one finding not in the accepted list', () => {
    const found = rule().violations()
    const accepted = [
      subjectOf(found.find((v) => v.element === 'AlphaBad')!),
      subjectOf(found.find((v) => v.element === 'BetaBad')!),
    ]
    expect(() => checkAll([rule().asSeverity('warn', { accepted })])).toThrow(ArchRuleError)
  })

  it('checkAll does not throw when every current finding is accepted', () => {
    const accepted = rule()
      .violations()
      .map((v) => subjectOf(v))
    expect(() => checkAll([rule().asSeverity('warn', { accepted })])).not.toThrow()
  })

  it('is identity-based, not a bare count: matching COUNT with the wrong subjects still fails', () => {
    // The property a bare count ceiling cannot have. Three findings are
    // present and three subjects are accepted — the count matches exactly —
    // but none of the accepted subjects are the ones actually found, so
    // every one of them escalates. A `≤ 3` count ceiling would have stayed
    // green here; this must not.
    const wrongAccepted = ['fake::one', 'fake::two', 'fake::three']
    const violations = rule().asSeverity('warn', { accepted: wrongAccepted }).violations()
    expect(violations.every((v) => v.severity === 'error')).toBe(true)
    expect(() => checkAll([rule().asSeverity('warn', { accepted: wrongAccepted })])).toThrow(
      ArchRuleError,
    )
  })

  it('the swap: removing an accepted finding and adding a NEW one still fails, at the same count', () => {
    // Bug 0084's exact regression shape, reproduced as a test of the mechanism
    // meant to prevent it: accept the three real, CURRENT findings (count 3) —
    // healthy. Now simulate a NEW violation (`OmegaBad`) replacing one that got
    // fixed (`AlphaBad` no longer violates) — same COUNT of accepted entries,
    // different actual findings.
    const healthy = rule()
      .violations()
      .map((v) => subjectOf(v))
    expect(healthy).toHaveLength(3)

    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    tsMorphProject.createSourceFile('/src/beta.ts', 'export class BetaBad {}')
    tsMorphProject.createSourceFile('/src/gamma.ts', 'export class GammaBad {}')
    tsMorphProject.createSourceFile('/src/omega.ts', 'export class OmegaBad {}') // NEW, replacing AlphaBad
    const after: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
    const afterRule = classes(after)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .haveNameMatching(/Service$/)
      .rule({ id: 'test/service-suffix' })
      .asSeverity('warn', { accepted: healthy })

    const violations = afterRule.violations()
    expect(violations.map((v) => v.element).sort()).toEqual(['BetaBad', 'GammaBad', 'OmegaBad'])
    const omega = violations.find((v) => v.element === 'OmegaBad')
    expect(omega?.severity).toBe('error')
    expect(() => checkAll([afterRule])).toThrow(ArchRuleError)
  })
})

describe('identity collisions make `accepted` unsafe, and are escalated — review fix', () => {
  // Bug found in review, reproduced and fixed before this plan shipped:
  // `subjectOf()` alone is not guaranteed unique WITHIN one rule's own batch
  // of violations — two violations sharing an element+message (no
  // producer-set `identity`) get a POSITIONAL "#1"/"#2" suffix from
  // `disambiguateIdentities()` (`applyFilters()`'s own first step), and that
  // suffix is not stable: which violation is "first" depends on file
  // traversal order. A fixed finding that held the bare subject and a
  // genuinely NEW finding that lands on the same position both read as the
  // SAME accepted-list entry — bug 0084's exact swap-blindness, reintroduced
  // through the identity primitive `accepted` is built on.
  function collidingRule(project: ArchProject) {
    return functions(project)
      .that()
      .areExported()
      .should()
      .haveNameMatching(/Handler$/)
      .rule({ id: 'test/collision' })
  }

  function inMemory(files: Record<string, string>): ArchProject {
    const tsMorphProject = new Project({ useInMemoryFileSystem: true })
    for (const [filePath, content] of Object.entries(files)) {
      tsMorphProject.createSourceFile(filePath, content)
    }
    return {
      tsConfigPath: '/tsconfig.json',
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  }

  it('two same-named violations across files collide onto bare + "#1"', () => {
    const p = inMemory({
      '/src/a.ts': 'export function parseConfig() {}',
      '/src/b.ts': 'export function parseConfig() {}',
    })
    const violations = collidingRule(p).violations()
    expect(violations.map((v) => v.file).sort()).toEqual(['/src/a.ts', '/src/b.ts'])
    const subjects = violations.map((v) => subjectOf(v)).sort()
    expect(subjects[1]).toMatch(/#1$/)
  })

  it('the swap, reproduced with a colliding subject: a genuinely new finding is escalated, not silently absorbed', () => {
    const before = inMemory({
      '/src/a.ts': 'export function parseConfig() {}',
      '/src/b.ts': 'export function parseConfig() {}',
    })
    const accepted = collidingRule(before)
      .violations()
      .map((v) => subjectOf(v))

    // a.ts is fixed; c.ts is NEW — a violation that never existed before,
    // landing on the same "#1" position the fixed a.ts finding vacated.
    const after = inMemory({
      '/src/b.ts': 'export function parseConfig() {}',
      '/src/c.ts': 'export function parseConfig() {}',
    })
    const afterRule = collidingRule(after).asSeverity('warn', { accepted })
    const violations = afterRule.violations()

    // The bug this fixes: without the collision guard, this would read
    // ['warn', 'warn'] — the count and the (post-repair) identities both
    // happen to match `accepted`, and the new finding on c.ts is absorbed.
    expect(violations.every((v) => v.severity === 'error')).toBe(true)
    expect(() => checkAll([afterRule])).toThrow(ArchRuleError)
  })

  it('diagnose() names the collision, not "not accepted" — a different, more urgent cause', () => {
    const p = inMemory({
      '/src/a.ts': 'export function parseConfig() {}',
      '/src/b.ts': 'export function parseConfig() {}',
    })
    const accepted = collidingRule(p)
      .violations()
      .map((v) => subjectOf(v))
    const findings = diagnose([collidingRule(p).asSeverity('warn', { accepted })])
    expect(findings.map((f) => f.kind)).toEqual(['deferred-warning'])
    expect(findings[0]?.advice).toContain('not reliably identifiable')
    expect(findings[0]?.advice).not.toContain('not in that list')
  })

  it('a rule with no collision is unaffected — the fix does not widen', () => {
    // Control: the swap test earlier in this file (AlphaBad/BetaBad/GammaBad,
    // all uniquely named) must still pass unchanged, or this fix over-fires.
    const violations = rule().asSeverity('warn', { accepted: [] }).violations()
    expect(violations.every((v) => v.severity === 'error')).toBe(true) // nothing accepted
    const healthy = rule()
      .violations()
      .map((v) => subjectOf(v))
    expect(
      rule()
        .asSeverity('warn', { accepted: healthy })
        .violations()
        .every((v) => v.severity === 'warn'),
    ).toBe(true)
  })
})

describe('the accepted/severity invariant survives a re-severity — review coverage', () => {
  it('switching to error clears accepted, so a later warn is advisory again', () => {
    // Review found this untested: `asSeverity()`'s own implementation clears
    // `_acceptedWarnings` whenever level is not 'warn'. Proven here via
    // observable behaviour (not by reaching into protected state): re-warning
    // AFTER a detour through 'error' must behave as a fresh advisory warning,
    // not silently keep the earlier accepted list.
    const deferred = rule().asSeverity('warn', { accepted: [] }) // nothing accepted — everything errors
    const detoured = deferred.asSeverity('error').asSeverity('warn') // back to warn, no accepted re-supplied
    const violations = detoured.violations()
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
    expect(() => checkAll([detoured])).not.toThrow()
  })
})

describe('diagnose() previews a breach before check() discovers it — plan 0090', () => {
  it('reports deferred-warning with the count and identities of what is not accepted', () => {
    const found = rule().violations()
    const accepted = [subjectOf(found.find((v) => v.element === 'AlphaBad')!)]
    const findings = diagnose([rule().asSeverity('warn', { accepted })])
    expect(findings.map((f) => f.kind)).toEqual(['deferred-warning'])
    expect(findings[0]?.advice).toContain('BetaBad')
    expect(findings[0]?.advice).toContain('GammaBad')
    expect(findings[0]?.advice).not.toContain('AlphaBad::')
  })

  it('stays silent when every current finding is accepted', () => {
    const accepted = rule()
      .violations()
      .map((v) => subjectOf(v))
    expect(diagnose([rule().asSeverity('warn', { accepted })])).toEqual([])
  })

  it('stays silent for a rule at default (error) severity', () => {
    // Not this kind's job — a rule that will already fail at check() with no
    // preview needed has nothing for THIS kind to preview.
    //
    // Review note: `deferredWarningAdvice()`'s guard is one `if` with two
    // OR'd clauses (`_severity !== 'warn'`, `_acceptedWarnings === undefined`).
    // Both are `undefined` here simultaneously — the public API's own
    // invariant keeps them in lockstep (see "the accepted/severity invariant
    // survives a re-severity" below) — so this test cannot tell the two
    // clauses apart, only that at least one of them holds. If BOTH were
    // removed, the method would crash on `undefined.length` rather than
    // return `[]` here; that crash is itself a legitimate catch (fail loud
    // beats silently reporting a wrong finding), just not what this test's
    // own name asserts.
    expect(diagnose([rule()])).toEqual([])
  })
})

describe("type safety: `accepted` only means something on 'warn'", () => {
  it('a deferred warning compiles — the control', () => {
    const configured = rule().asSeverity('warn', { accepted: ['x::y'] })
    expect(configured).toBeDefined()
  })

  it('accepted is rejected on error severity at compile time', () => {
    // @ts-expect-error — `accepted` means nothing on 'error': every violation
    // already fails there, so pairing them is a contradiction the type should
    // not let a caller write silently.
    rule().asSeverity('error', { accepted: ['x::y'] })
  })
})
