import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { Project } from 'ts-morph'
import { project } from '../../src/core/project.js'
import { smells } from '../../src/smells/index.js'
import { call } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { InconsistentSiblingsBuilder } from '../../src/index.js'
import { checkAll } from '../../src/index.js'
import type { ArchProject } from '../../src/core/project.js'
import * as bodyTraversalModule from '../../src/helpers/body-traversal.js'

/**
 * Test-only subclass exercising the emit path — plan 0102's `INERT_FINDING_EMIT`
 * gate makes `detect()`'s inert-violation branch, `inertViolation()` and
 * `inertElement()` unreachable at runtime until the N+1 flip (plan 0105) ships,
 * so without this override that whole path would ship with zero test coverage
 * (review: architect + testing, independently). `inertEmitEnabled()` is
 * `protected` for exactly this reason — see its own doc comment.
 */
class EmittingSiblings extends InconsistentSiblingsBuilder {
  protected override inertEmitEnabled(): boolean {
    return true
  }
}

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/inconsistent-siblings')

describe('smells.inconsistentSiblings()', () => {
  const p = project(path.join(fixturesDir, 'tsconfig.json'))

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flags the odd-one-out when majority matches pattern', () => {
    const builder = smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(2)

    expect(() => builder.check()).toThrow(ArchRuleError)
  })

  it('violation message references the pattern and counts', () => {
    const builder = smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(2)

    try {
      builder.check()
      expect.fail('Expected ArchRuleError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      expect(archErr.violations.length).toBeGreaterThan(0)
      // Should mention the pattern and the count
      expect(archErr.violations[0]!.message).toContain('extractCount')
      expect(archErr.violations[0]!.message).toMatch(/\d+ of \d+/)
    }
  })

  it('flags legacy-repo.ts as the non-matching file', () => {
    const builder = smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(2)

    try {
      builder.check()
      expect.fail('Expected ArchRuleError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      const violationFiles = archErr.violations.map((v) => path.basename(v.file))
      expect(violationFiles).toContain('legacy-repo.ts')
    }
  })

  it('does not flag when no majority exists', () => {
    // parseInt is used by only 1 of 4 files — no majority
    const builder = smells.inconsistentSiblings(p).forPattern(call('parseInt')).minLines(2)

    expect(() => builder.check()).not.toThrow()
  })

  it('a detector with no pattern IS a violation — it detects nothing (bug 0019)', () => {
    // REVERSED at 0.23.0: this asserted `.not.toThrow()`, pinning a detector
    // that can never report as correct behaviour.
    const builder = smells.inconsistentSiblings(p).minLines(2)
    const v = builder.violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.bypassFilters).toBe(true)
    expect(v[0]?.message).toContain('.forPattern(')
    expect(() => builder.check()).toThrow(ArchRuleError)
  })

  it('the remedy remediates: adding .forPattern() clears the finding', () => {
    const v = smells
      .inconsistentSiblings(p)
      .minLines(2)
      .forPattern(call('this.extractCount'))
      .violations()
    expect(v.every((x) => x.bypassFilters !== true)).toBe(true)
  })

  it('.warn() logs but does not throw', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(2).warn()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('.check() throws ArchRuleError', () => {
    const builder = smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(2)

    try {
      builder.check()
      expect.fail('Expected ArchRuleError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
    }
  })

  it('.because() includes reason in violations', () => {
    const builder = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.extractCount'))
      .minLines(2)
      .because('Align with sibling conventions')

    try {
      builder.check()
      expect.fail('Expected ArchRuleError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      expect(archErr.violations[0]!.because).toBe('Align with sibling conventions')
    }
  })

  it('describe() includes the pattern description', () => {
    const builder = smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(2)

    try {
      builder.check()
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      expect(archErr.violations[0]!.rule).toContain('extractCount')
    }
  })

  it('respects minLines filter', () => {
    // With very high minLines, no functions qualify
    const builder = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.extractCount'))
      .minLines(1000)

    expect(() => builder.check()).not.toThrow()
  })

  it('parseInt boundary fixture is canFireSoon, not inert (strong-vs-weak resolution)', () => {
    // repositories/ now has archive-repo.ts alongside legacy-repo.ts: parseInt is
    // 2-of-5, one edit from the 60% majority (ceil(0.6*5) - 2 = 1 <= 1). Plan
    // 0102's strong predicate must NOT report this as inert.
    const builder = smells.inconsistentSiblings(p).forPattern(call('parseInt')).minLines(2)
    expect(builder.inertAdvice()).toBe('')
  })

  describe('plan 0102: the inert finding (diagnose-first, N-phase)', () => {
    // `mixedFixturesDir`/`mp` used to duplicate `fixturesDir`/`p` above — same
    // path, a second ts-morph `Project` over the same tsconfig, read as a
    // separate corpus when it wasn't (review: testing). Use `p`.

    it('a genuinely inert rule reports non-empty advice with the real numbers', () => {
      // mixed-beta/: 1 of 5 files call this.normalize(). editsToMajority =
      // ceil(0.6*5) - 1 = 2 > 1, so no folder is within one edit of a majority.
      const builder = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      const advice = builder.inertAdvice()
      expect(advice).toContain('examined 5 sibling files')
      expect(advice).toContain('only 1 of them')
      expect(advice).toContain('correspondence().side(...).beComplete()')
    })

    it('diagnose does not require the flip — truthful on a FRESH builder', () => {
      // No .check() or .violations() run first: inertAdvice() recomputes via
      // inertAssessment(), so diagnose() gets real numbers without materializing
      // detect() first.
      const builder = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      expect(builder.inertAdvice()).toMatch(/examined \d+ sibling files.*only \d+ of them/)
    })

    it('repeated invocation cannot double-count', () => {
      const builder = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      const first = builder.inertAdvice()
      const second = builder.inertAdvice()
      expect(first).toBe(second)
      expect(first).toContain('examined 5 sibling files')
    })

    it('a healthy control (majority present) reports no advice — the C1 regression test', () => {
      // mixed-alpha/: 4 of 5 files call this.normalize(); a5-odd.ts is the real
      // violation. canFireSoon is true (editsToMajority = ceil(3) - 4 = -1 <= 1),
      // so the preview must be silent even though a real violation exists.
      const builder = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-alpha/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      expect(builder.inertAdvice()).toBe('')
      expect(builder.violations().length).toBeGreaterThan(0)
    })

    it('a majority with real violations is NOT inert', () => {
      // repositories/: extractCount is 3-of-5, a genuine majority with 2
      // non-matching files. editsToMajority = ceil(3)-3 = 0 <= 1, canFireSoon.
      // The full all-conforming (nonMatching === 0) latch case is covered in
      // tests/archunit/dogfood.test.ts's validateOverrides row (5-of-5, real
      // src) — this repo has no all-conforming fixture of its own.
      const builder = smells
        .inconsistentSiblings(p)
        .forPattern(call('this.extractCount'))
        .minLines(2)
      expect(builder.inertAdvice()).toBe('')
      // A dead pattern (matching === 0) reaches '' via a DIFFERENT branch of the
      // same guard (the sibling test below asserts exactly that) — so '' alone
      // does not distinguish "healthy majority" from "dead pattern". This is the
      // test that actually proves a majority (review: testing — the original
      // version passed for the same reason a dead pattern would have).
      expect(builder.violations().length).toBeGreaterThan(0)
    })

    it('mixed-folder corpus does not raise it — a majority folder suppresses the whole rule', () => {
      // mixed-alpha (majority, canFireSoon) + mixed-beta (inert in isolation) in
      // ONE rule: canFireSoon is OR'd across folders, so the rule is not inert,
      // and mixed-alpha's real violation still fires.
      const builder = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-alpha/**')
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      expect(builder.inertAdvice()).toBe('')
      expect(builder.violations().map((v) => v.element)).toContain('a5-odd.ts')
    })

    it('ADR-008 rule 2: "choose a shared pattern" remediates — verified, not just stated', () => {
      // mixed-beta/: forPattern(call('this.normalize')) is inert (1 of 5).
      // Every file has a read(): string method; b2-b5 call this.raw.trim()
      // directly (b1 calls this.normalize(this.raw) instead) — a pattern the
      // MAJORITY already shares. Swapping to it is exactly the message's
      // second remedy ("choose a pattern the sibling files already share"),
      // and it clears the inert finding — replacing it with a real, normal
      // violation on the one file that doesn't follow the majority.
      const inert = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      expect(inert.inertAdvice()).not.toBe('')

      const remediated = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.raw.trim'))
      expect(remediated.inertAdvice()).toBe('')
      expect(remediated.violations().map((v) => v.element)).toEqual(['b1.ts'])
    })

    it('matching === 0 is never reported as inert (dead pattern, not majority arithmetic)', () => {
      // No file in mixed-beta/ calls a method named 'doesNotExist'.
      const builder = smells
        .inconsistentSiblings(p)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.doesNotExistAnywhere'))
      expect(builder.inertAdvice()).toBe('')
    })

    describe('the emit path (EmittingSiblings — exercises code the N-phase gate makes unreachable)', () => {
      it('the finding IS the preview: byte-identical message, real shape', () => {
        // THE central invariant plan 0102 claims: "the preview and the finding
        // cannot diverge because they are the same derivation." Unverifiable
        // through the shipped gate — this is that verification (review: testing).
        const builder = new EmittingSiblings(p)
          .inFolder('**/mixed-beta/**')
          .minLines(1)
          .forPattern(call('this.normalize'))
        const preview = builder.inertAdvice()
        expect(preview).not.toBe('')

        const violations = builder.violations()
        expect(violations).toHaveLength(1)
        expect(violations[0]!.message).toBe(preview)
        expect(violations[0]!.bypassFilters).toBe(true)
        expect(violations[0]!.file).toBe('')
        expect(violations[0]!.line).toBe(0)
      })

      it('a declared-empty rule reports its expiry, not the inert finding, on BOTH surfaces', () => {
        // Guards the fix that moved `!declaresEmpty()` into the shared guard
        // (`inertAdviceFor`) instead of leaving it only in `inertEmitEnabled()`
        // (review: architect) — before that fix, `diagnose()`'s preview and
        // `check()`'s eventual failure could name different causes for the
        // same rule state.
        const builder = new EmittingSiblings(p)
          .inFolder('**/mixed-beta/**')
          .minLines(1)
          .forPattern(call('this.normalize'))
          .expectEmpty()
        expect(builder.inertAdvice()).toBe('')
        const violations = builder.violations().filter((v) => v.bypassFilters === true)
        expect(violations.some((v) => v.message.includes('cannot produce a finding today'))).toBe(
          false,
        )
      })

      it('inertElement() keeps two same-pattern/different-scope rules distinct under checkAll', () => {
        // Zero coverage otherwise (review: testing, I3) — its whole reason to
        // exist is preventing exactly this collapse under `dedupeConfigFindings`.
        const a = new EmittingSiblings(p)
          .inFolder('**/mixed-alpha/**')
          .minLines(1)
          .forPattern(call('this.normalize'))
        const b = new EmittingSiblings(p)
          .inFolder('**/mixed-beta/**')
          .minLines(1)
          .forPattern(call('this.normalize'))
        // mixed-alpha is canFireSoon (not inert); mixed-beta is genuinely inert —
        // so only b's inert finding is expected, and it must survive checkAll
        // rather than collapsing with anything a produced.
        expect(() => checkAll([a, b])).toThrow(ArchRuleError)
        try {
          checkAll([a, b])
        } catch (err: unknown) {
          const archErr = err as ArchRuleError
          const inert = archErr.violations.filter((v) => v.bypassFilters === true)
          // Which finding survived, not just how many (review: the scan in
          // tests/tools/scan-cardinality-assertions.ts flagged a `toHaveLength(1)`
          // here as count-only — a dead selector also yields exactly one
          // violation, so a bare count would accept the wrong cause too).
          // `a` (mixed-alpha, canFireSoon) must not have produced an inert
          // finding at all; the one that survived must be `b`'s (mixed-beta).
          expect(inert.map((v) => v.message)).toEqual([b.inertAdvice()])
        }
      })

      it('one AST pass, not two — detect() does not re-partition beyond inertAssessment()', () => {
        // Named in plan 0102's own test inventory and never landed (review:
        // architect + testing, independently). Without this, `detect()`
        // silently regressing to a second `partitionByPattern` call — doubling
        // the dominant cost on every check() — has nothing to catch it.
        //
        // `searchFunctionBody` short-circuits per file (stops at the first
        // matching function), so its exact call count depends on fixture
        // content and is not a stable number to pin directly. What IS stable:
        // if `detect()` only ever calls `inertAssessment()` once and never
        // re-partitions, then `.violations()` on a fresh builder makes exactly
        // as many `searchFunctionBody` calls as `.inertAdvice()` alone does on
        // an identical fresh builder (which computes ONE `inertAssessment()`
        // and nothing else). A second partition walk inside `detect()` would
        // make the `.violations()` count strictly larger.
        const params = (): InconsistentSiblingsBuilder =>
          new EmittingSiblings(p)
            .inFolder('**/mixed-beta/**')
            .minLines(1)
            .forPattern(call('this.normalize'))

        const spy = vi.spyOn(bodyTraversalModule, 'searchFunctionBody')

        spy.mockClear()
        params().inertAdvice()
        const onePassCount = spy.mock.calls.length
        expect(onePassCount).toBeGreaterThan(0)

        spy.mockClear()
        params().violations()
        expect(spy.mock.calls.length).toBe(onePassCount)
      })

      it('ADR-008 rule 2, on the ACTUAL violation object: remediation clears a real inertViolation()', () => {
        // The census in tests/core/every-config-finding-is-classified.test.ts cites
        // this family's "choose a shared pattern" remediation as
        // `verified: 'behavioural'` for `inertViolation` specifically — but the
        // cited test (above) only ever calls `.inertAdvice()`/`.violations()`
        // through the DEFAULT (non-emitting) builder, where `inertViolation()` is
        // never constructed at all (review: testing, C2). This is that same
        // remediation, through `EmittingSiblings`, so the claim is true of the
        // function it names, not just of the preview string.
        const inert = new EmittingSiblings(p)
          .inFolder('**/mixed-beta/**')
          .minLines(1)
          .forPattern(call('this.normalize'))
        const before = inert.violations()
        expect(before.some((v) => v.bypassFilters === true)).toBe(true)

        const remediated = new EmittingSiblings(p)
          .inFolder('**/mixed-beta/**')
          .minLines(1)
          .forPattern(call('this.raw.trim'))
        const after = remediated.violations()
        expect(after.some((v) => v.bypassFilters === true)).toBe(false)
        expect(after.map((v) => v.element)).toEqual(['b1.ts'])
      })
    })
  })

  it('groupByFolder() does not change violation count', () => {
    const plain = smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(2)

    const grouped = smells
      .inconsistentSiblings(p)
      .forPattern(call('this.extractCount'))
      .minLines(2)
      .groupByFolder()

    let plainCount = 0
    let groupedCount = 0

    try {
      plain.check()
    } catch (err: unknown) {
      const archErr = err as ArchRuleError
      plainCount = archErr.violations.length
    }

    try {
      grouped.check()
    } catch (err: unknown) {
      const archErr = err as ArchRuleError
      groupedCount = archErr.violations.length
    }

    expect(groupedCount).toBe(plainCount)
    expect(plainCount).toBeGreaterThan(0)
  })

  it('groupByFolder() sorts violations across folders — the real guard for this family', () => {
    // The code comment above `detect()`'s `groupByFolder` sort used to cite a
    // test on a DIFFERENT family that asserts only `.toThrow()`, not order
    // (review: testing) — this is the real, family-specific guard it should
    // have named. `zzz-folder` is created before `aaa-folder`, so the
    // filesystem walk order is the OPPOSITE of alphabetical; only the sort
    // makes the violations come back `aaa-folder` before `zzz-folder`.
    const tsm = new Project({ useInMemoryFileSystem: true })
    for (const [folder, extra] of [
      ['zzz-folder', 'a'],
      ['aaa-folder', 'b'],
    ] as const) {
      tsm.createSourceFile(`/src/${folder}/one.ts`, 'export function one() { this.doIt() }')
      tsm.createSourceFile(`/src/${folder}/two.ts`, 'export function two() { this.doIt() }')
      tsm.createSourceFile(`/src/${folder}/odd${extra}.ts`, 'export function odd() { this.skip() }')
    }
    const inMemory: ArchProject = {
      tsConfigPath: '/tsconfig.json',
      _project: tsm,
      getSourceFiles: () => tsm.getSourceFiles(),
    }

    const found = smells
      .inconsistentSiblings(inMemory)
      .minLines(1)
      .forPattern(call('this.doIt'))
      .groupByFolder()
      .violations()
      .filter((v) => v.bypassFilters !== true)

    expect(found.map((v) => v.file)).toEqual([
      expect.stringContaining('/aaa-folder/'),
      expect.stringContaining('/zzz-folder/'),
    ])
  })
})
