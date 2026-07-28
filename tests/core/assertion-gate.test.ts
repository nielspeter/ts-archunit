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

/**
 * Run a terminal call, capture the gate's stderr output, and report whether it
 * threw. The gate writes via `process.stderr.write`, NOT `console.warn` —
 * vitest's default reporter drops intercepted console output from passing
 * tests, which review measured making the pre-flight invisible in CI.
 *
 * `threw` is returned instead of swallowed: the first version of this helper
 * caught and discarded exceptions, and a warn-then-throw sabotage — the
 * 0.23.0 flip landing early, the exact thing "nothing throws that didn't
 * before" exists to prevent — passed 14 of the 16 tests here.
 */
function gate(run: () => void): { warnings: string[]; threw: unknown } {
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  let threw: unknown
  try {
    run()
  } catch (error) {
    threw = error
  }
  const calls = spy.mock.calls.map((c) => String(c[0]))
  spy.mockRestore()
  return { warnings: calls.filter((m) => m.includes("[ts-archunit] Rule '")), threw }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the assertion gate warns, per state (0.22.0)', () => {
  const p = load('poc')

  it('state 1: .should() with no condition', () => {
    const { warnings: w, threw } = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .check(),
    )
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('no condition follows')
    expect(w[0]).toContain('Add a condition after .should()')
    // The state-2 remedy must NOT appear — three shapes sharing one message is
    // the ADR-008 rule 2 failure this hook exists to prevent.
    expect(w[0]).not.toContain('is a predicate')
  })

  it('state 2: a predicate-only method after .should(), predicate named', () => {
    const { warnings: w, threw } = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .areAsync()
        .check(),
    )
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('is a predicate')
    expect(w[0]).toContain('are async')
    expect(w[0]).toContain('Move it before .should()')
    expect(w[0]).not.toContain('no condition follows')
  })

  it('state 3: predicates but no .should() at all', () => {
    const { warnings: w, threw } = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .check(),
    )
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('never reached .should()')
  })

  it('state 4: a bare entry point', () => {
    const { warnings: w, threw } = gate(() => functions(p).check())
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('never reached .should()')
    // And the warning is locatable: no empty-quoted name.
    expect(w[0]).not.toContain("Rule ''")
  })

  it("state 4b: .should().that() reached .should() and gets state 1's remedy, not a falsehood", () => {
    // `.should().that()` legally returns to the predicate phase. Deriving the
    // message from `_phase` would print "never reached .should()" about a rule
    // that did — the round-2 finding that killed draft 2's message contract.
    const { warnings: w, threw } = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .that()
        .check(),
    )
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(1)
    expect(w[0]).not.toContain('never reached .should()')
    expect(w[0]).toContain('Add a condition after .should()')
  })

  it('state 5: tsconfig() with no requirements', () => {
    const repo = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    const { warnings: w, threw } = gate(() => tsconfig(repo).check())
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('.requires(')
  })

  it('state 6: inconsistentSiblings() with no pattern', () => {
    const p2 = project(fixtures('smells/inconsistent-siblings'))
    const { warnings: w, threw } = gate(() => smells.inconsistentSiblings(p2).minLines(2).check())
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('.forPattern(')
    // Named, not 'unnamed' — this was the one state whose finding was
    // unlocatable before the describeRule override landed.
    expect(w[0]).toContain('smells.inconsistentSiblings()')
  })

  it('state 7: correspondence() with sides but no assertion — warns, and still throws for now', () => {
    const empty = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    const held = correspondence(p)
      .side('a', empty, (f) => f.getName() ?? '<anonymous>')
      .side('b', ['x'])
    const { warnings: w, threw } = gate(() => held.check())
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('.beComplete()')
    // The RangeError is unchanged in 0.22.0 (it becomes the finding in
    // 0.23.0), and the warn precedes it — asserted here rather than in a
    // second call, because the once-per-instance latch means a second call
    // would not warn again.
    expect(threw).toBeInstanceOf(RangeError)
  })

  it('slice, schema AND resolver rules warn at the terminal', () => {
    const sl = load('slices')
    const slice = gate(() => slices(sl).matching('src/').should().check())
    expect(slice.threw).toBeUndefined()
    expect(slice.warnings).toHaveLength(1)
    expect(slice.warnings[0]).toContain('beFreeOfCycles')
    // The name is bounded — derived from the discovery, not from a
    // description embedding every slice's file list (review measured a name
    // carrying ten filenames).
    expect(slice.warnings[0]).toContain('slices().matching("src/")')
    expect(slice.warnings[0]).not.toContain('.ts,')

    const s = schemaFromSDL('type Query { a: String }')
    const schema = gate(() => s.that().queries().should().check())
    expect(schema.threw).toBeUndefined()
    expect(schema.warnings).toHaveLength(1)
    expect(schema.warnings[0]).toContain('haveFields')

    // The resolver case the first version's title promised and its body
    // lacked — review measured ResolverRuleBuilder's gate firing zero times
    // anywhere in the suite, and its advice override deletable with nothing
    // failing.
    const gp = load('graphql')
    const resolver = gate(() => resolvers(gp, 'src/**/*.resolver.ts').check())
    expect(resolver.threw).toBeUndefined()
    expect(resolver.warnings).toHaveLength(1)
    expect(resolver.warnings[0]).toContain('contain(')
  })

  it('the gate fires at .violations() and .warn(), not only .check()', () => {
    // Review reverted the guard wiring at two of the three terminals and the
    // whole suite stayed green — the docs say "every terminal", so pin each.
    const viaViolations = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .violations(),
    )
    expect(viaViolations.warnings).toHaveLength(1)

    const viaWarn = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .warn(),
    )
    expect(viaWarn.warnings).toHaveLength(1)
  })

  it('warns once per builder instance, not once per terminal call', () => {
    // A held rule terminated in ten tests used to print ten identical lines —
    // repetition trains the reader to scroll past stderr during the one
    // release where reading these is the migration.
    const held = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
    const first = gate(() => held.violations())
    const second = gate(() => held.violations())
    expect(first.warnings).toHaveLength(1)
    expect(second.warnings).toHaveLength(0)
  })

  it('the id, when set, is IN the warning — the advice branches on it', () => {
    // State 1's advice says 'if it comes from a preset (ruleId "preset/...")'.
    // Review measured the main hierarchy's warning never printing the id, so
    // the one fact the remedy reads was withheld from the reader — and doctor
    // named the same rule differently.
    const { warnings: w } = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .rule({ id: 'preset/example/no-parsers' })
        .check(),
    )
    expect(w).toHaveLength(1)
    expect(w[0]).toContain("Rule 'preset/example/no-parsers'")
  })

  it('zero-condition rules still report NO violations on every builder (deletion equivalence)', () => {
    // The four old `warn + return []` early-exits were deleted; execution now
    // falls through an empty condition loop. Review fabricated a violation on
    // that path in slice/schema/resolver and 2384 of 2384 tests passed — the
    // equivalence was pinned for RuleBuilder only.
    const sl = load('slices')
    const sliceRule = slices(sl).matching('src/').should()
    expect(gate(() => sliceRule.check()).threw).toBeUndefined()
    expect(gate(() => slices(sl).matching('src/').should().violations()).warnings.length).toBe(1)
    expect(slices(sl).matching('src/').should().violations()).toEqual([])

    const schemaRule = schemaFromSDL('type Query { a: String }').that().queries().should()
    expect(gate(() => schemaRule.check()).threw).toBeUndefined()
    expect(
      schemaFromSDL('type Query { a: String }').that().queries().should().violations(),
    ).toEqual([])

    const gp = load('graphql')
    expect(gate(() => resolvers(gp, 'src/**/*.resolver.ts').check()).threw).toBeUndefined()
    expect(resolvers(gp, 'src/**/*.resolver.ts').violations()).toEqual([])
  })

  it('CONTROL: a rule with a real condition emits no warning', () => {
    // Non-vacuity anchor: the selector matches 4 subjects, so silence here is
    // "asserts something", not "matched nothing".
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    expect(sel.subjects()).toHaveLength(4)
    const { warnings: w, threw } = gate(() => sel.should().notExist().violations())
    expect(threw).toBeUndefined()
    expect(w).toHaveLength(0)
  })

  it('CONTROL: behaviour is unchanged in 0.22.0 — the gate only warns', () => {
    // The condition-less rule still passes and still reports no violations;
    // 0.23.0 is the flip. This is the "nothing throws that didn't before" pin.
    const checked = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .check(),
    )
    expect(checked.threw).toBeUndefined()
    const collected = gate(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .violations(),
    )
    expect(collected.threw).toBeUndefined()
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
