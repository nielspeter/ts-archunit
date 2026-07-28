/**
 * The assertion gate, 0.22.0 form (plan 0070, bugs 0019/0020's instrument).
 *
 * A rule that asserts nothing WARNS on every terminal call in this release and
 * fails in the next. These tests pin the instrument: every assertion-less
 * state emits one warning whose text carries that state's own remedy, the
 * control stays silent, and `diagnose()` reports the SAME string — the
 * one-string-one-place property round 2 measured the previous design breaking.
 *
 * The classification block is the plan's item 6, with the load-bearing third
 * case from `glob-declaration.test.ts:119` that the drafted version omitted:
 * two prose lists certify whatever is written in them, and only the
 * prototype-walk case fails when a hook is deleted. Measured: draft 2's
 * version survived exactly that sabotage.
 */
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Project } from 'ts-morph'
import * as rootExports from '../../src/index.js'
import * as graphqlExports from '../../src/graphql/index.js'
import type { TerminalBuilder } from '../../src/core/terminal-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { correspondence } from '../../src/builders/correspondence-builder.js'
import { tsconfig } from '../../src/tsconfig/index.js'
import { smells } from '../../src/smells/index.js'
import { schemaFromSDL } from '../../src/graphql/index.js'
import { diagnose } from '../../src/core/diagnose.js'
import { project } from '../../src/core/project.js'
import type { ArchProject } from '../../src/core/project.js'

const fixtures = (name: string): string =>
  path.resolve(import.meta.dirname, `../fixtures/${name}/tsconfig.json`)

function load(name: string): ArchProject {
  const p = new Project({ tsConfigFilePath: fixtures(name) })
  return {
    tsConfigPath: fixtures(name),
    _project: p,
    getSourceFiles: () => p.getSourceFiles(),
  }
}

/** Run a terminal call and capture the gate's warnings. */
function warningsOf(run: () => void): string[] {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    run()
  } catch {
    // 0.22.0: the gate itself never throws; a builder that throws today
    // (correspondence) still does, after warning.
  }
  const calls = spy.mock.calls.map((c) => String(c[0]))
  spy.mockRestore()
  return calls.filter((m) => m.includes('[ts-archunit]'))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the assertion gate warns, per state (0.22.0)', () => {
  const p = load('poc')

  it('state 1: .should() with no condition', () => {
    const w = warningsOf(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .check(),
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('no condition follows')
    expect(w[0]).toContain('Add a condition after .should()')
    // The state-2 remedy must NOT appear — three shapes sharing one message is
    // the ADR-008 rule 2 failure this hook exists to prevent.
    expect(w[0]).not.toContain('is a predicate')
  })

  it('state 2: a predicate-only method after .should(), predicate named', () => {
    const w = warningsOf(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .areAsync()
        .check(),
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('is a predicate')
    expect(w[0]).toContain('are async')
    expect(w[0]).toContain('Move it before .should()')
    expect(w[0]).not.toContain('no condition follows')
  })

  it('state 3: predicates but no .should() at all', () => {
    const w = warningsOf(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .check(),
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('never reached .should()')
  })

  it('state 4: a bare entry point', () => {
    const w = warningsOf(() => functions(p).check())
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('never reached .should()')
    // And the warning is locatable: no empty-quoted name.
    expect(w[0]).not.toContain("Rule ''")
  })

  it("state 4b: .should().that() reached .should() and gets state 1's remedy, not a falsehood", () => {
    // `.should().that()` legally returns to the predicate phase. Deriving the
    // message from `_phase` would print "never reached .should()" about a rule
    // that did — the round-2 finding that killed draft 2's message contract.
    const w = warningsOf(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .that()
        .check(),
    )
    expect(w).toHaveLength(1)
    expect(w[0]).not.toContain('never reached .should()')
    expect(w[0]).toContain('Add a condition after .should()')
  })

  it('state 5: tsconfig() with no requirements', () => {
    const repo = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    const w = warningsOf(() => tsconfig(repo).check())
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('.requires(')
  })

  it('state 6: inconsistentSiblings() with no pattern', () => {
    const p2 = project(fixtures('smells/inconsistent-siblings'))
    const w = warningsOf(() => smells.inconsistentSiblings(p2).minLines(2).check())
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('.forPattern(')
  })

  it('state 7: correspondence() with sides but no assertion — warns, and still throws for now', () => {
    const empty = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    const held = correspondence(p)
      .side('a', empty, (f) => f.getName() ?? '<anonymous>')
      .side('b', ['x'])
    const w = warningsOf(() => held.check())
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('.beComplete()')
    // The RangeError is unchanged in 0.22.0; it becomes the finding in 0.23.0.
    expect(() => held.check()).toThrow(RangeError)
  })

  it('slice, schema and resolver rules warn at the terminal too', () => {
    const sl = load('slices')
    const wSlice = warningsOf(() => slices(sl).matching('src/').should().check())
    expect(wSlice).toHaveLength(1)
    expect(wSlice[0]).toContain('beFreeOfCycles')

    const s = schemaFromSDL('type Query { a: String }')
    const wSchema = warningsOf(() => s.that().queries().should().check())
    expect(wSchema).toHaveLength(1)
    expect(wSchema[0]).toContain('haveFields')
  })

  it('CONTROL: a rule with a real condition emits no warning', () => {
    // Non-vacuity anchor: the selector matches 4 subjects, so silence here is
    // "asserts something", not "matched nothing".
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    expect(sel.subjects()).toHaveLength(4)
    const w = warningsOf(() => sel.should().notExist().violations())
    expect(w).toHaveLength(0)
  })

  it('CONTROL: behaviour is unchanged in 0.22.0 — the gate only warns', () => {
    // The condition-less rule still passes and still reports no violations;
    // 0.23.0 is the flip. This is the "nothing throws that didn't before" pin.
    expect(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .check(),
    ).not.toThrow()
    expect(
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .violations(),
    ).toHaveLength(0)
  })
})

describe('diagnose() parity — one string, one place', () => {
  const p = load('poc')

  it('the doctor advice IS the runtime warning text, for every hook', () => {
    const repo = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    const sl = load('slices')
    const cases: readonly { rule: TerminalBuilder; label: string }[] = [
      {
        rule: functions(p)
          .that()
          .haveNameMatching(/^parse/)
          .should(),
        label: 'RuleBuilder',
      },
      { rule: slices(sl).matching('src/').should(), label: 'SliceRuleBuilder' },
      { rule: tsconfig(repo), label: 'TsconfigBuilder' },
    ]
    for (const { rule, label } of cases) {
      const findings = diagnose([rule]).filter((f) => f.kind === 'no-condition')
      expect(findings, label).toHaveLength(1)
      // toBe-equality with the builder's own advice — the runtime warning is
      // `[ts-archunit] Rule '<name>': <advice>`, so advice-equality is the
      // whole non-prefix text. Round 2 measured these diverging.
      expect(findings[0]?.advice, label).toBe(rule.assertionAdvice())
      // And the finding is locatable — not 'unnamed'.
      expect(findings[0]?.rule, label).not.toBe('unnamed')
    }
  })

  it('a rule that asserts something produces no no-condition finding', () => {
    const rule = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
      .notExist()
    expect(diagnose([rule]).filter((f) => f.kind === 'no-condition')).toHaveLength(0)
  })
})

/**
 * Item 6: every exported builder is classified, with the third case that
 * actually bites. The lists are claims; the discovery case makes a NEW builder
 * land in one; the prototype case makes a listed CAN_BE_ASSERTIONLESS builder
 * actually implement the hook. Deleting `TsconfigBuilder.assertsSomething`
 * fails the third case — draft 2's two-case version survived that sabotage.
 */
describe('assertion classification of every exported builder', () => {
  const CAN_BE_ASSERTIONLESS: readonly string[] = [
    // conditions accumulate after .should(); zero is reachable
    'CallRuleBuilder',
    'ClassRuleBuilder',
    'FunctionRuleBuilder',
    'ScopedFunctionRuleBuilder',
    'JsxRuleBuilder',
    'ModuleRuleBuilder',
    'TypeRuleBuilder',
    'SliceRuleBuilder',
    'SchemaRuleBuilder',
    'ResolverRuleBuilder',
    // requirements object; {} is reachable
    'TsconfigBuilder',
    // both check flags false is reachable
    'CorrespondenceBuilder',
    // no pattern is reachable
    'InconsistentSiblingsBuilder',
    // the abstract root that OWNS the conditions hook — its subclasses inherit
    // a real implementation, so the prototype walk finds 'RuleBuilder', never
    // the exempt default
    'RuleBuilder',
  ]
  const ASSERTION_IS_STRUCTURAL: readonly string[] = [
    // pairwise similarity is the assertion; there is no state without it
    'DuplicateBodiesBuilder',
    // the pair condition is a constructor argument of the final builder;
    // CrossLayerBuilder itself is a factory and never reaches a terminal.
    // MappedCrossLayerBuilder, PairConditionBuilder and PairFinalBuilder are
    // not exported from the entry points — covered behaviourally, same
    // recorded caveat as glob-declaration.test.ts.
    'CrossLayerBuilder',
    // abstract root of the smell detectors
    'SmellBuilder',
    // the abstract root that defines the exempt default itself; every concrete
    // assertion-less builder must override it, which the third case enforces
    'TerminalBuilder',
  ]

  const exported = new Map<string, unknown>()
  for (const mod of [rootExports, graphqlExports]) {
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value === 'function' && name.endsWith('Builder')) {
        exported.set(name, value)
      }
    }
  }

  it('actually discovers the builders', () => {
    // [].filter() is [] — the guard-the-guard case, kept from the precedent.
    expect(exported.size).toBeGreaterThanOrEqual(15)
  })

  it('every exported builder is classified, and no name is stale', () => {
    const classified = new Set([...CAN_BE_ASSERTIONLESS, ...ASSERTION_IS_STRUCTURAL])
    const unclassified = [...exported.keys()].filter((n) => !classified.has(n))
    expect(unclassified, 'new builders must be classified for the assertion gate').toEqual([])
    const stale = [...classified].filter((n) => !exported.has(n))
    expect(stale, 'classified names that are no longer exported').toEqual([])
  })

  it('every CAN_BE_ASSERTIONLESS builder implements assertsSomething on its own hierarchy', () => {
    // The load-bearing case (glob-declaration.test.ts:119's analogue): walks
    // the prototype chain and fails when the owner is TerminalBuilder itself —
    // i.e. when a builder in the list would silently inherit `return true` and
    // be EXEMPT. This is the case that catches a deleted hook.
    const offenders: string[] = []
    for (const name of CAN_BE_ASSERTIONLESS) {
      const cls = exported.get(name)
      if (typeof cls !== 'function') continue
      let proto: object | null = cls.prototype as object
      let owner: string | undefined
      while (proto) {
        if (Object.hasOwn(proto, 'assertsSomething')) {
          owner = (proto.constructor as { name: string }).name
          break
        }
        proto = Object.getPrototypeOf(proto) as object | null
      }
      if (owner === undefined || owner === 'TerminalBuilder') {
        offenders.push(`${name} (owner: ${owner ?? 'none'})`)
      }
    }
    expect(
      offenders,
      'these builders can reach an assertion-less state but inherit the exempt default',
    ).toEqual([])
  })
})
