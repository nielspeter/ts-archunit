import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { smells } from '../../src/smells/index.js'
import { call } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'

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
    const mixedFixturesDir = path.resolve(
      import.meta.dirname,
      '../fixtures/smells/inconsistent-siblings',
    )
    const mp = project(path.join(mixedFixturesDir, 'tsconfig.json'))

    it('a genuinely inert rule reports non-empty advice with the real numbers', () => {
      // mixed-beta/: 1 of 5 files call this.normalize(). editsToMajority =
      // ceil(0.6*5) - 1 = 2 > 1, so no folder is within one edit of a majority.
      const builder = smells
        .inconsistentSiblings(mp)
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
        .inconsistentSiblings(mp)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      expect(builder.inertAdvice()).toMatch(/examined \d+ sibling files.*only \d+ of them/)
    })

    it('repeated invocation cannot double-count', () => {
      const builder = smells
        .inconsistentSiblings(mp)
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
        .inconsistentSiblings(mp)
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
    })

    it('mixed-folder corpus does not raise it — a majority folder suppresses the whole rule', () => {
      // mixed-alpha (majority, canFireSoon) + mixed-beta (inert in isolation) in
      // ONE rule: canFireSoon is OR'd across folders, so the rule is not inert,
      // and mixed-alpha's real violation still fires.
      const builder = smells
        .inconsistentSiblings(mp)
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
        .inconsistentSiblings(mp)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.normalize'))
      expect(inert.inertAdvice()).not.toBe('')

      const remediated = smells
        .inconsistentSiblings(mp)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.raw.trim'))
      expect(remediated.inertAdvice()).toBe('')
      expect(remediated.violations().map((v) => v.element)).toEqual(['b1.ts'])
    })

    it('matching === 0 is never reported as inert (dead pattern, not majority arithmetic)', () => {
      // No file in mixed-beta/ calls a method named 'doesNotExist'.
      const builder = smells
        .inconsistentSiblings(mp)
        .inFolder('**/mixed-beta/**')
        .minLines(1)
        .forPattern(call('this.doesNotExistAnywhere'))
      expect(builder.inertAdvice()).toBe('')
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
})
