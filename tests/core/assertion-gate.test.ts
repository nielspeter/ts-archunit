/**
 * The assertion instrument, 0.22.0 form (plan 0070, bugs 0019/0020).
 *
 * A rule that asserts nothing is reported by `diagnose()` / `doctor` in this
 * release and FAILS in the next. Nothing at runtime changes here: these tests
 * pin that every assertion-less state carries its own remedy, that a rule with
 * a real condition carries none, that behaviour is unchanged, and that
 * `diagnose()` reports the SAME string the builder owns — the
 * one-string-one-place property round 2 measured the previous design breaking.
 *
 * An earlier revision of this release also emitted the remedy as a runtime
 * stderr warning. That was withdrawn: a bespoke output path bypassed the
 * formatter, the JSON payload, the annotation surface and the exit code, and a
 * five-persona review found a defect at each of those seams. At 0.23.0 the same
 * hook produces an `ArchViolation`, which reaches all four by construction.
 *
 * The classification block is the plan's item 6, with the load-bearing third
 * case from `glob-declaration.test.ts:119` that the drafted version omitted:
 * two prose lists certify whatever is written in them, and only the
 * prototype-walk case fails when a hook is deleted. Measured: draft 2's
 * version survived exactly that sabotage.
 */
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import * as rootExports from '../../src/index.js'
import * as graphqlExports from '../../src/graphql/index.js'
import { TerminalBuilder } from '../../src/core/terminal-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { correspondence } from '../../src/builders/correspondence-builder.js'
import { tsconfig } from '../../src/tsconfig/index.js'
import { smells } from '../../src/smells/index.js'
import { resolvers, schemaFromSDL } from '../../src/graphql/index.js'
import { diagnose } from '../../src/core/diagnose.js'
import { project } from '../../src/core/project.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'

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

describe('assertionAdvice: one remedy per state, and only its own (0.22.0)', () => {
  const p = load('poc')

  /** The advice a rule would be told, read from the builder that owns it. */
  const advice = (b: TerminalBuilder): string => {
    expect(b.assertsSomething()).toBe(false)
    return b.assertionAdvice()
  }

  it('state 1: .should() with no condition', () => {
    const a = advice(
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should(),
    )
    expect(a).toContain('no condition follows')
    expect(a).toContain('Add a condition after .should()')
    // The state-2 remedy must NOT appear — three shapes sharing one message is
    // the ADR-008 rule 2 failure this hook exists to prevent.
    expect(a).not.toContain('is a predicate')
  })

  it('state 2: a predicate-only method after .should(), predicate named', () => {
    const a = advice(
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .areAsync(),
    )
    expect(a).toContain('"are async" is a predicate')
    expect(a).toContain('Move it before .should()')
    expect(a).not.toContain('no condition follows')
  })

  it('state 2, plural: two misplaced predicates are both named, with plural grammar', () => {
    // The commit that introduced the plural branch shipped it untested — a
    // revert to always-'it' was caught by nothing.
    const a = advice(
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .areAsync()
        .areExported(),
    )
    expect(a).toContain('"are async"')
    expect(a).toContain('"are exported"')
    expect(a).toContain('are predicates, which filter')
    expect(a).toContain('Move them before .should()')
  })

  it('state 3/4: the rule never reached .should()', () => {
    expect(
      advice(
        functions(p)
          .that()
          .haveNameMatching(/^parse/),
      ),
    ).toContain('never reached .should()')
    expect(advice(functions(p))).toContain('never reached .should()')
  })

  it("state 4b: .should().that() reached .should(), so it gets state 1's remedy", () => {
    // `.should().that()` legally returns to the predicate phase. Deriving the
    // message from `_phase` would print "never reached .should()" about a rule
    // that did — the round-2 finding that killed draft 2's message contract.
    const a = advice(
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .that(),
    )
    expect(a).not.toContain('never reached .should()')
    expect(a).toContain('Add a condition after .should()')
  })

  it('state 5: tsconfig() with no requirements', () => {
    const repo = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    expect(advice(tsconfig(repo))).toContain('.requires(')
  })

  it('state 6: inconsistentSiblings() with no pattern', () => {
    const p2 = project(fixtures('smells/inconsistent-siblings'))
    expect(advice(smells.inconsistentSiblings(p2).minLines(2))).toContain('.forPattern(')
  })

  it('state 7: correspondence names the fault it actually has', () => {
    const parsers = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    const twoSides = correspondence(p)
      .side('a', parsers, (f) => f.getName() ?? '?')
      .side('b', ['x'])
    expect(advice(twoSides)).toContain('.beComplete()')

    // One side is an ARITY fault: adding .beComplete() would leave the rule
    // exactly as broken, so the advice must not name it.
    const oneSide = correspondence(p).side('a', parsers, (f) => f.getName() ?? '?')
    const a = advice(oneSide)
    expect(a).toContain('.side(')
    expect(a).not.toContain('.beComplete()')
  })

  it('slice, schema and resolver each carry their own remedy', () => {
    const sl = load('slices')
    expect(advice(slices(sl).matching('src/').should())).toContain('beFreeOfCycles')
    expect(advice(schemaFromSDL('type Query { a: String }').that().queries().should())).toContain(
      'haveFields',
    )
    expect(advice(resolvers(load('graphql'), 'src/**/*.resolver.ts'))).toContain('contain(')
  })

  it('CONTROL: a rule with a real condition asserts something and offers no remedy', () => {
    // Non-vacuity anchor: the selector matches 4 subjects, so this is
    // "asserts something", not "matched nothing".
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    expect(sel.subjects()).toHaveLength(4)
    expect(sel.should().notExist().assertsSomething()).toBe(true)
  })

  it('CONTROL: nothing throws and nothing is reported — 0.22.0 changes no behaviour', () => {
    // The gate is diagnostic only in this release. A rule that asserted nothing
    // before still passes and still reports no violations; 0.23.0 is the flip.
    const rule = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
    expect(() => rule.check()).not.toThrow()
    expect(rule.violations()).toEqual([])
  })

  it('zero-condition rules still report NO violations on every builder', () => {
    // The four old `warn + return []` early-exits were deleted; execution now
    // falls through an empty condition loop. Review fabricated a violation on
    // that path in slice/schema/resolver and 2384 of 2384 tests passed.
    const sl = load('slices')
    expect(slices(sl).matching('src/').should().violations()).toEqual([])
    expect(() => slices(sl).matching('src/').should().check()).not.toThrow()
    expect(
      schemaFromSDL('type Query { a: String }').that().queries().should().violations(),
    ).toEqual([])
    expect(resolvers(load('graphql'), 'src/**/*.resolver.ts').violations()).toEqual([])
  })
})

/**
 * A builder that can be assertion-less and does NOT override `assertionAdvice`
 * — the shape a consumer's own subclass takes, and the one that proves
 * `diagnose()` reads the base method rather than a duplicated literal.
 */
class AdviceLessBuilder extends TerminalBuilder {
  override assertsSomething(): boolean {
    return false
  }

  protected collectViolations(): ArchViolation[] {
    return []
  }
}

describe('diagnose() parity — one string, one place', () => {
  const p = load('poc')

  it("the doctor advice IS the builder's own advice, for every hook", () => {
    const repo = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    const sl = load('slices')
    const gp = load('graphql')
    // ALL SEVEN hooks — the first version covered three under this same
    // title, which is why deleting ResolverRuleBuilder's advice override was
    // caught by nothing.
    const cases: readonly { rule: TerminalBuilder; label: string }[] = [
      {
        rule: functions(p)
          .that()
          .haveNameMatching(/^parse/)
          .should(),
        label: 'RuleBuilder',
      },
      { rule: slices(sl).matching('src/').should(), label: 'SliceRuleBuilder' },
      {
        rule: schemaFromSDL('type Query { a: String }').that().queries().should(),
        label: 'SchemaRuleBuilder',
      },
      { rule: resolvers(gp, 'src/**/*.resolver.ts'), label: 'ResolverRuleBuilder' },
      { rule: tsconfig(repo), label: 'TsconfigBuilder' },
      {
        rule: correspondence(p)
          .side(
            'a',
            functions(p)
              .that()
              .haveNameMatching(/^parse/),
            (f) => f.getName() ?? '?',
          )
          .side('b', ['x']),
        label: 'CorrespondenceBuilder',
      },
      {
        rule: smells.inconsistentSiblings(project(fixtures('smells/inconsistent-siblings'))),
        label: 'InconsistentSiblingsBuilder',
      },
      // The eighth case: a builder that implements only `assertsSomething` and
      // inherits the advice. It pins `diagnose()`'s fallback to
      // TerminalBuilder's own method — an earlier revision hard-coded a second
      // copy of that string, and either copy could be rewritten with nothing
      // failing.
      {
        rule: new AdviceLessBuilder().rule({ id: 'test/advice-less' }),
        label: 'inherits the base advice',
      },
    ]
    for (const { rule, label } of cases) {
      const findings = diagnose([rule]).filter((f) => f.kind === 'no-condition')
      expect(findings, label).toHaveLength(1)
      // toBe-equality with the builder's own advice: one string, one place.
      // Round 2 measured these diverging, and a later revision hard-coded a
      // second copy of the generic fallback in diagnose() that either side
      // could change unnoticed.
      expect(findings[0]?.advice, label).toBe(rule.assertionAdvice())
      // And the finding is locatable — not 'unnamed'.
      expect(findings[0]?.rule, label).not.toBe('unnamed')
    }
  })

  it('the inherited base advice names the fault and both remedies', () => {
    // The parity case above compares the advice to itself, so a rewrite of the
    // base text passes it — measured. This pins the substance: any builder that
    // does not override the hook still gets a usable remedy.
    const advice = new AdviceLessBuilder().assertionAdvice()
    expect(advice).toContain('asserts nothing')
    expect(advice).toContain('can never fail')
    expect(advice).toContain('Add an assertion')
    expect(advice).toContain('delete the rule')
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
    // CrossLayerBuilder does not extend TerminalBuilder at all — it is a
    // factory outside the gate's universe, and the prototype-chain discovery
    // correctly excludes it (the earlier name-suffix discovery wrongly
    // included it). MappedCrossLayerBuilder, PairConditionBuilder and
    // PairFinalBuilder are not exported from the entry points — covered
    // behaviourally, same recorded caveat as glob-declaration.test.ts.
    // abstract root of the smell detectors
    'SmellBuilder',
    // the abstract root that defines the exempt default itself; every concrete
    // assertion-less builder must override it, which the third case enforces
    'TerminalBuilder',
  ]

  // Discovery by PROTOTYPE CHAIN, not by name suffix — the cited precedent's
  // mechanism (glob-declaration.test.ts:89). Review exported an assertion-less
  // `class ScratchGate extends TerminalBuilder` (no 'Builder' suffix) and the
  // name-based version was blind to it.
  function extendsTerminalBuilder(value: unknown): boolean {
    if (typeof value !== 'function') return false
    if (value === TerminalBuilder) return true
    const proto: unknown = (value as { prototype?: object }).prototype
    if (proto === undefined || proto === null) return false
    return Object.prototype.isPrototypeOf.call(TerminalBuilder.prototype, proto)
  }
  const exported = new Map<string, unknown>()
  for (const mod of [rootExports, graphqlExports]) {
    for (const [name, value] of Object.entries(mod)) {
      if (extendsTerminalBuilder(value)) {
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
      let owner: object | undefined
      while (proto) {
        if (Object.hasOwn(proto, 'assertsSomething')) {
          owner = proto
          break
        }
        proto = Object.getPrototypeOf(proto) as object | null
      }
      // Owner compared by prototype IDENTITY, per the precedent — a
      // constructor.name string survives neither mangling nor a same-named
      // class.
      if (owner === undefined || owner === TerminalBuilder.prototype) {
        offenders.push(name)
      }
    }
    expect(
      offenders,
      'these builders can reach an assertion-less state but inherit the exempt default',
    ).toEqual([])
  })
})
