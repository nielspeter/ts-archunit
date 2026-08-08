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
import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import * as rootExports from '../../src/index.js'
import * as graphqlExports from '../../src/graphql/index.js'
import { TerminalBuilder, ASSERTION_DOCS } from '../../src/core/terminal-builder.js'
import type { CollectResult } from '../../src/core/terminal-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { emptyProjectAdvice } from '../../src/core/empty-project-advice.js'
import { correspondence } from '../../src/builders/correspondence-builder.js'
import { tsconfig } from '../../src/tsconfig/index.js'
import { smells } from '../../src/smells/index.js'
import { call } from '../../src/helpers/matchers.js'
import { resolvers, schemaFromSDL } from '../../src/graphql/index.js'
import { diagnose } from '../../src/core/diagnose.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { formatViolations, formatViolationsPlain } from '../../src/core/format.js'
import { formatViolationsJson } from '../../src/core/format-json.js'
import { formatViolationsGitHub } from '../../src/core/format-github.js'
import { generateBaseline, withBaseline } from '../../src/helpers/baseline.js'
import fs from 'node:fs'
import os from 'node:os'
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

describe('assertionAdvice: one remedy per state, and only its own', () => {
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

  it('NO remedy may name a mechanism that does not remediate', () => {
    // Found by sabotage, and it is the sharpest hole the reviews found: adding
    // `.expectNonEmpty()` to state 1's advice — which verifiably does NOT clear
    // the finding, since the gate wins over it (`rule-builder.test.ts`) — left
    // all 2411 tests green. Every other block asserts the correct remedy is
    // PRESENT; none asserted no wrong remedy was added beside it. That is
    // bug 0017's shape (a remedy that reads perfectly and does not work) inside
    // the block written to close bug 0017's corollary.
    //
    // An explicit list, not a count (ADR-008 rule 4): every mechanism a reader
    // might reach for to make the finding go away without fixing the rule.
    const suppressors =
      /expectNonEmpty|allowEmpty|emptyIsPass|\.excluding\(|asSeverity|\.warn\(|--changed|baseline|silent\(/
    const sl = load('slices')
    const repo = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    const p2 = project(fixtures('smells/inconsistent-siblings'))
    const parsers = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    const everyState: TerminalBuilder[] = [
      parsers.should(),
      parsers.should().areAsync(),
      parsers.should().areAsync().areExported(),
      parsers.should().notExist().areAsync(),
      parsers,
      functions(p),
      parsers.should().that(),
      tsconfig(repo),
      smells.inconsistentSiblings(p2).minLines(2),
      correspondence(p)
        .side('a', parsers, (f) => f.getName() ?? '?')
        .side('b', ['x']),
      correspondence(p).side('a', parsers, (f) => f.getName() ?? '?'),
      slices(sl).matching('src/').should(),
      schemaFromSDL('type Query { a: String }').that().queries().should(),
      resolvers(load('graphql'), 'src/**/*.resolver.ts'),
    ]
    expect(everyState).toHaveLength(14)
    for (const rule of everyState) {
      expect(rule.assertsSomething()).toBe(false)
      expect(rule.assertionAdvice()).not.toMatch(suppressors)
    }
  })

  it('a misplaced predicate disqualifies the rule even WITH a real condition', () => {
    // The false green both other shapes hide behind, measured on the shipped
    // branch before the fix: `areAsync()` after `.should()` lands in
    // addPredicate and retroactively narrows the set the conditions are
    // evaluated over — to nothing here, so `notExist` held vacuously.
    //
    //   subjects 4 -> 0   violations 4 -> 0   diagnose() []   check() passed
    //
    // This is the one assertion-less shape whose description reads as
    // deliberate, so nobody goes looking. `assertsSomething()` consulted
    // `_misplaced` only when `_conditions.length === 0`.
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    const good = sel.should().notExist()
    const bad = sel.should().notExist().areAsync()

    // Non-vacuity anchor: the correct rule really does report 4.
    expect(good.assertsSomething()).toBe(true)
    expect(good.violations()).toHaveLength(4)

    // The broken one selects nothing and must not be allowed to pass.
    expect(bad.subjects()).toHaveLength(0)
    expect(bad.assertsSomething()).toBe(false)
    const v = bad.violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.bypassFilters).toBe(true)
    expect(() => bad.check()).toThrow(ArchRuleError)
    expect(diagnose([bad])).toHaveLength(1)

    // Its remedy is "move it", NOT "add a condition" — it has one. Naming the
    // wrong fix here would leave the rule exactly as broken (ADR-008 rule 2).
    const a = bad.assertionAdvice()
    expect(a).toContain('"are async"')
    expect(a).toContain('Move it before .should()')
    expect(a).toContain('vacuously')
    expect(a).not.toContain('then add a condition')

    // And the remedy remediates: moving it before .should() restores all four.
    const moved = sel.and().areAsync().should().notExist()
    expect(moved.assertsSomething()).toBe(true)
    expect(moved.violations().every((x) => x.bypassFilters !== true)).toBe(true)
  })

  it("the gate finding carries its own identity, remedy and docs — not the author's", () => {
    // Seven reverts of this finding's fields were each caught by nothing: the
    // plan specified this test and it was never written. `file`/`line` matter
    // beyond metadata — `!v.file` is the branch both the GitHub-annotation fix
    // and the render-once dedupe hang on, so a location stamped here silently
    // breaks two shipped fixes without failing anything.
    const AUTHOR = {
      id: 'arch/example',
      because: 'the reason the rule exists',
      suggestion: "the author's fix for a VIOLATION of the rule",
      docs: 'https://example.com/author-docs',
    }
    const rule = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
      .rule(AUTHOR)
    const v = rule.violations()[0]
    expect(v).toBeDefined()

    // Identity: named by the author's id, never empty, never a placeholder word.
    expect(v?.ruleId).toBe(AUTHOR.id)
    expect(v?.rule).toBe(AUTHOR.id)
    expect(v?.element).toBe(AUTHOR.id)

    // Inherited: `because` states why the rule exists, which is context rather
    // than a claim about this finding's cause. Supplied by `applyFilters`, not
    // by the gate — asserted here on the post-filter result because that is
    // what a consumer receives, and the gate deliberately leaves it unset so
    // there is one place that fills it.
    expect(v?.because).toBe(AUTHOR.because)
    expect(v?.ruleId).toBe(AUTHOR.id)

    // Refused: both channels that claim to be a remedy (bug 0021).
    expect(v?.suggestion).not.toBe(AUTHOR.suggestion)
    expect(v?.suggestion).toContain(rule.assertionAdvice())
    expect(v?.docs).not.toBe(AUTHOR.docs)
    expect(v?.docs).toBe(ASSERTION_DOCS)

    // ...and the link resolves. Comparing the field to the constant is a
    // same-derivation check — changing the constant changes both sides, which
    // sabotage confirmed — so the section is looked up in the docs source. A
    // `Fix:`/`Docs:` line that 404s is a remedy that cannot remediate, and
    // nothing else in the suite would notice the anchor rotting.
    const anchor = ASSERTION_DOCS.split('#')[1]
    expect(anchor).toBeTruthy()
    const page = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../docs/violation-reporting.md'),
      'utf-8',
    )
    const slugs = [...page.matchAll(/^#{2,4} (.+)$/gm)].map((m) =>
      (m[1] ?? '')
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-'),
    )
    expect(slugs).toContain(anchor)

    // Location-less, and asserted because two renderers branch on it.
    expect(v?.file).toBe('')
    expect(v?.line).toBe(0)
  })

  it('both name derivations are non-empty for a bare entry point', () => {
    // `describeRule()` returns `rule: ''` for an entry point with no predicates
    // and no conditions, and `'' ` is not nullish — so `?? 'unnamed rule'` was
    // dead code and `doctor` printed an empty name for exactly the shape it
    // exists to report. The gate and `diagnose()` derive the name separately;
    // both are asserted, which is what makes this a two-derivation guard.
    const bare = functions(p)
    expect(bare.describeRule().rule).toBe('')
    expect(bare.violations()[0]?.rule).toBe('FunctionRuleBuilder')
    expect(diagnose([bare])[0]?.rule).not.toBe('')
    expect(diagnose([bare])[0]?.rule).toBeTruthy()
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

  it('an assertion-less rule now FAILS, as a configuration finding (0.23.0 flip)', () => {
    // INVERTED at 0.23.0. Through 0.22.0 this asserted the opposite — that the
    // gate was diagnostic only and behaviour was unchanged — which was that
    // release's contract, deliberately.
    const rule = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
    const v = rule.violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.bypassFilters).toBe(true)
    // The per-shape remedy verbatim, plus the one sentence the finding adds:
    // ADR-008 rule 3 requires it to say there is no escape hatch, and a reader
    // given only the remedy tries four suppression channels first (measured).
    expect(v[0]?.message).toContain(rule.assertionAdvice())
    expect(v[0]?.message).toContain('cannot be suppressed')
    expect(v[0]?.docs).toBe(ASSERTION_DOCS)
    expect(() => rule.check()).toThrow(ArchRuleError)
  })

  it('the finding is a configuration finding: error severity, unexcludable, unbaselineable', () => {
    // R3a's machinery, inherited rather than rebuilt — asserted through it
    // rather than by reading the flag back (ADR-008: a test that restates the
    // implementation is not a test of it).
    const rule = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
    // asSeverity('warn') cannot soften it.
    expect(rule.asSeverity('warn').violations()[0]?.severity).toBe('error')
    // .warn() throws on it.
    expect(() => rule.asSeverity('warn').warn()).toThrow(ArchRuleError)
    // A baseline built from its own hash does not suppress it. Constructed for
    // real: the previous version of this block asserted `toBeDefined()` on a
    // finding it never passed through a baseline, so it could not fail for the
    // reason its comment named — the property held only by inheritance from
    // `bypassFilters`, which is a different claim.
    const finding = rule.violations()[0]
    expect(finding).toBeDefined()
    const file = path.join(
      os.tmpdir(),
      `tsau-gate-baseline-${String(process.pid)}-${String(finding?.line ?? 0)}.json`,
    )
    try {
      generateBaseline(finding === undefined ? [] : [finding], file)
      expect(withBaseline(file).filterNew(finding === undefined ? [] : [finding])).toHaveLength(1)
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
  })

  it('the remedy remediates: adding a condition clears the finding', () => {
    const cleared = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
      .notExist()
      .violations()
    expect(cleared.every((v) => v.bypassFilters !== true)).toBe(true)
  })

  it('every builder family fails at the terminal, not only RuleBuilder (0.23.0 flip)', () => {
    // INVERTED at 0.23.0: through 0.22.0 these asserted `[]`, pinning that
    // release's no-behaviour-change contract. The plan's own Upgrading note
    // calls slices/schemas/resolvers the population that will actually fire, so
    // each is taken to a terminal here rather than only through diagnose().
    const sl = load('slices')
    const cases = [
      slices(sl).matching('src/').should(),
      schemaFromSDL('type Query { a: String }').that().queries().should(),
      resolvers(load('graphql'), 'src/**/*.resolver.ts'),
    ]
    for (const rule of cases) {
      const v = rule.violations()
      expect(v).toHaveLength(1)
      expect(v[0]?.bypassFilters).toBe(true)
      expect(v[0]?.message).toContain(rule.assertionAdvice())
      expect(v[0]?.message).toContain('cannot be suppressed')
      expect(() => rule.check()).toThrow(ArchRuleError)
    }
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

  protected collectViolations(): CollectResult {
    // Plan 0098 retyped this seam. This fixture is the closest thing in-repo to
    // an ADR-010 foreign dialect, and updating it here IS the upgrade an external
    // dialect performs — a compile error naming the member, not a silent drift.
    return { violations: [], examined: 0 }
  }
}

describe('every remedy remediates (ADR-008 rule 2, behavioural corollary)', () => {
  const p = load('poc')

  // A remedy asserted only by its words is a same-derivation check: the test
  // and the message are written from one understanding and agree even when it
  // is wrong. Bug 0017 is a remedy that reads perfectly and reproduces the
  // violation it claims to fix. So for every state: apply the stated fix,
  // assert the finding clears.
  const configFindings = (b: TerminalBuilder): number =>
    b.violations().filter((v) => v.bypassFilters === true).length

  it('state 1 — "add a condition after .should()"', () => {
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    expect(configFindings(sel.should())).toBe(1)
    expect(configFindings(sel.should().notExist())).toBe(0)
  })

  it('state 2 — "move it before .should()"', () => {
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    expect(configFindings(sel.should().areAsync())).toBe(1)
    // The stated fix, applied literally: the predicate moves ahead of should(),
    // and a condition follows.
    expect(configFindings(sel.and().areAsync().should().notExist())).toBe(0)
  })

  it('state 3/4 — "add .should() and a condition"', () => {
    const sel = functions(p)
      .that()
      .haveNameMatching(/^parse/)
    expect(configFindings(sel)).toBe(1)
    expect(configFindings(sel.should().notExist())).toBe(0)
  })

  it('slice, schema and resolver — each names a condition that clears it', () => {
    const sl = load('slices')
    expect(configFindings(slices(sl).matching('src/').should())).toBe(1)
    expect(configFindings(slices(sl).matching('src/').should().beFreeOfCycles())).toBe(0)

    const sdl = (): ReturnType<typeof schemaFromSDL> => schemaFromSDL('type Query { a: String }')
    expect(configFindings(sdl().that().queries().should())).toBe(1)
    expect(configFindings(sdl().that().queries().should().haveFields('a'))).toBe(0)

    const gp = load('graphql')
    expect(configFindings(resolvers(gp, 'src/**/*.resolver.ts'))).toBe(1)
    expect(
      configFindings(resolvers(gp, 'src/**/*.resolver.ts').should().contain(call('loader.load'))),
    ).toBe(0)
  })

  it('the exclusion refusal names no particular cause', () => {
    // Third site in the bug-0021 family: the refusal hard-coded the
    // empty-SELECTOR remedy for every configuration finding, and the assertion
    // gate's finding has nothing to do with the selector.
    const warnings: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      warnings.push(String(chunk))
      return true
    })
    functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
      .excluding(/.*/)
      .violations()
    spy.mockRestore()
    const refusal = warnings.find((w) => w.includes('cannot be excluded'))
    expect(refusal).toBeDefined()
    expect(refusal).toContain('Fix the fault it names')
    expect(refusal).not.toContain('selector')
  })

  // Sabotage found this hole: delete `suggestion: advice` from the gate's
  // finding and all 2408 tests passed. Every assertion read `message`, and a
  // configuration finding is the one kind that CANNOT borrow the author's
  // `suggestion` as a fallback (`execute-rule.ts:155` refuses it, bug 0021) —
  // so the finding would have shipped with no `Fix:` line on any surface, and
  // the remedy that the whole state-machine above computes would reach nobody.
  //
  // Asserted through the three renderers rather than the field, so the check
  // and the code are differently derived (ADR-008 rule 5).
  it('the remedy reaches every surface a consumer reads, exactly once', () => {
    const rule = functions(p)
      .that()
      .haveNameMatching(/^parse/)
      .should()
    // The finding's own text, not the bare advice: the gate appends the ADR-008
    // rule 3 sentence, and what must reach each surface exactly once is what the
    // reader is actually shown.
    const found = rule.violations()
    const advice = found[0]?.message ?? ''
    expect(advice).toContain(rule.assertionAdvice())
    const occurrences = (haystack: string): number => haystack.split(advice).length - 1

    // Each renderer must show the remedy — and show it once. Twice was the
    // shipped behaviour before this fix: `message` renders in the location's
    // place for a location-less finding, then `suggestion` rendered again as
    // `Fix:`. Both fields still carry it; only the rendering deduplicates.
    expect(occurrences(formatViolations(found, undefined, { codeFrames: false }))).toBe(1)
    expect(occurrences(formatViolationsPlain(found))).toBe(1)
    expect(occurrences(formatViolationsGitHub(found))).toBe(1)

    // The JSON payload is not rendered prose — a tool reads `suggestion`, and
    // `format-json` writes it as `?? null`, so a dropped remedy is a literal
    // null rather than an absent key.
    // Compared in encoded form: the advice quotes `"preset/..."`, and those
    // quotes are backslash-escaped in the payload.
    const json = formatViolationsJson(found)
    expect(json).toContain(JSON.stringify(advice).slice(1, -1))
    expect(json).not.toContain('"suggestion": null')

    // And the thrown error: a one-line summary by design, so the assertion is
    // that it is an ArchRuleError carrying the finding — the detail arrives via
    // `writeReport`, measured on a real child `vitest run` (plan 0070 notes).
    let thrown: unknown
    try {
      rule.check({ format: 'json' })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ArchRuleError)
    expect(thrown instanceof ArchRuleError ? thrown.violations[0]?.suggestion : '').toBe(advice)
  })
})

describe('empty-project parity — one string, one place', () => {
  // The second state to get a single owner, after `assertionAdvice`. Bug 0031's
  // fix wrote a SECOND text for it while quoting the bug's own instruction not
  // to, and the two diverged at birth in the wrong direction: the builder's
  // copy — the one a FAILING BUILD prints — kept the wording bug 0031 itself
  // records as not actionable, while the diagnostic got the better text.
  //
  // Nothing failed when they disagreed, which is the same hole plan 0070 closed
  // for `assertionAdvice` and a later review found reopened by a third copy.
  const solutionStyle = path.resolve(import.meta.dirname, '../fixtures/does-not-load/tsconfig.json')

  function emptyProject(): ArchProject {
    const tsMorphProject = new Project({ tsConfigFilePath: solutionStyle })
    return {
      tsConfigPath: solutionStyle,
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }
  }

  it('the SELECTOR path says it too — the row this test never had (bug 0048)', () => {
    // The test below is named "the doctor's empty-project advice IS the
    // builder's, character for character" and it passed for two releases while
    // this was broken. It drives the builder with `slices().matching()`, whose
    // glob sits at DISCOVERY position — so `deadSelectorFindings` skips it
    // (`terminal-builder.ts:433`) and the text comes from `SliceRuleBuilder`'s
    // own empty-project branch.
    //
    // There were three implementations of "the project loaded nothing" —
    // `diagnose.ts`, `SliceRuleBuilder`, and none in the gate — and the parity
    // test compared the two that had one. The selector path is the common one:
    // every `modules()`, `classes()`, `functions()` and `types()` rule.
    //
    // Measured before the fix: *"This rule's selector … can never match
    // anything … Correct the glob, or remove the rule."* The glob was correct.
    const target = emptyProject()
    expect(target.getSourceFiles()).toEqual([])

    const rule = modules(target)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notImportFrom('**/y/**')
    const messages = rule.violations().map((v) => v.message)

    // ONE finding for the project, not one per glob: the identity of this fault
    // is the tsconfig (ADR-008 rule 4), which is why `diagnose()` dedupes too.
    expect(messages).toHaveLength(1)

    const shared = emptyProjectAdvice(target)
    expect(messages[0]).toContain(shared.charAt(0).toUpperCase() + shared.slice(1))
    // …and it must NOT blame the glob, which is the whole defect.
    expect(messages[0]).not.toContain('can never match anything')
    expect(messages[0]).not.toContain('Correct the glob')
  })

  it('the empty-project finding is unsuppressable, as its own message claims', () => {
    // Found by sabotage: flipping `bypassFilters` to false left the subset green.
    // That is worse than an untested field — the message ends with "This finding
    // cannot be suppressed: not by .warn(), .asSeverity('warn'), .excluding(), …",
    // so a suppressable finding makes its own sentence a lie. ADR-008 rule 3.
    const target = emptyProject()
    const rule = modules(target)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notImportFrom('**/y/**')
      .rule({ id: 'probe/empty' })

    const [finding] = rule.violations()
    expect(finding?.suggestion).toContain('cannot be suppressed')
    expect(finding?.bypassFilters).toBe(true)

    // And behaviourally: an `.excluding()` naming it does not remove it.
    const excluded = modules(target)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notImportFrom('**/y/**')
      .rule({ id: 'probe/empty' })
      .excluding('probe/empty')
      .violations()
    expect(excluded).toHaveLength(1)
  })

  it('CONTROL: a genuinely dead glob in a LOADED project still blames the glob', () => {
    // Without this, "always report project-empty" passes the row above and
    // destroys the distinction the gate exists to draw.
    const loaded = load('poc')
    expect(loaded.getSourceFiles().length).toBeGreaterThan(0)

    const rule = modules(loaded)
      .that()
      .resideInFolder('**/no-such-folder-anywhere/**')
      .should()
      .notImportFrom('**/y/**')
    const [message] = rule.violations().map((v) => v.message)

    expect(message).toContain('can never match anything')
    expect(message).not.toContain('loaded 0 source files')
  })

  it("the doctor's empty-project advice IS the builder's, character for character", () => {
    const target = emptyProject()
    expect(target.getSourceFiles()).toEqual([])

    const [finding] = diagnose([
      modules(target).that().resideInFolder('**/x/**').should().notImportFrom('**/y/**'),
    ])
    const fromDoctor = finding?.advice
    expect(fromDoctor).toBeTruthy()

    // The builder's failing-check message embeds the same text plus its own
    // trailing sentence, and capitalises the opening. `toBe` on the shared
    // fragment, not `toContain` on a paraphrase.
    const fromBuilder = slices(target)
      .matching('src/')
      .should()
      .beFreeOfCycles()
      .describeRule().rule
    const builderMessage = slices(target)
      .matching('src/')
      .should()
      .beFreeOfCycles()
      .violations()
      .map((v) => v.message)
      .join('\n')
    expect(fromBuilder).toBeTruthy()

    const shared = emptyProjectAdvice(target)
    expect(fromDoctor).toBe(shared)
    expect(builderMessage).toContain(shared.charAt(0).toUpperCase() + shared.slice(1))
  })
})

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
      // INHERITS the advice through the prototype chain. Note what it does and
      // does not pin — it takes the left branch of `diagnose()`'s `??`, because
      // extending TerminalBuilder means `assertionAdvice` is present. The `??`
      // right-hand side is for a duck-typed plain object, and it has its own
      // case below; a comment claiming this one covered the fallback was wrong
      // in the same way the historical `this._x.push` guard was.
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
      // And the finding is locatable — not 'unnamed', and not empty. `''` is
      // what `describeRule()` returns for a bare entry point, and it is not
      // nullish, so the `?? 'unnamed rule'` fallback never fired for it.
      expect(findings[0]?.rule, label).not.toBe('unnamed')
      expect(findings[0]?.rule, label).toBeTruthy()
    }
  })

  it("a duck-typed DiagnosableRule with no advice hook gets TerminalBuilder's text", () => {
    // The `??` right-hand side in diagnose(), which nothing exercised: every
    // existing case extends TerminalBuilder and so takes the left branch.
    // Replacing the fallback with `''` left all 2411 tests green.
    //
    // `diagnose()` consumes a structural interface, so a plain object is a legal
    // input — that is the whole reason the interface is structural, and it is
    // what an external tool holding its own rule objects passes.
    // `violations` is required by `RuleBuilderLike`, which `DiagnosableRule`
    // extends — the minimum a real external caller would hold.
    const ducked = { assertsSomething: () => false, violations: (): ArchViolation[] => [] }
    const findings = diagnose([ducked]).filter((f) => f.kind === 'no-condition')
    expect(findings).toHaveLength(1)
    expect(findings[0]?.advice).toBe(TerminalBuilder.prototype.assertionAdvice.call(ducked))
    expect(findings[0]?.advice).toContain('Add an assertion')
    expect(findings[0]?.rule).toBe('unnamed rule')
  })

  it('tsconfig() with no requirements fails at .check(), not only in violations()', () => {
    // The one shape covered at the advice-string level and through violations()
    // but never end-to-end: unwiring `check()`'s gate call failed five tests and
    // none of them was tsconfig's. Same code path as the others, so this is
    // cheap — and "same code path" is exactly the assumption that stops being
    // true one refactor later.
    const repo = project(path.resolve(import.meta.dirname, '../../tsconfig.json'))
    expect(() => tsconfig(repo).check()).toThrow(ArchRuleError)
    // The remedy remediates: a real requirement makes it a normal rule.
    expect(() => tsconfig(repo).requires({ strict: true }).check()).not.toThrow()
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
