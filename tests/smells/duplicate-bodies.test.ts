import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { Project } from 'ts-morph'
import { project } from '../../src/core/project.js'
import { smells } from '../../src/smells/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import * as fingerprintModule from '../../src/smells/fingerprint.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')

/** Two functions sharing one body — the vocabulary of `body` is fully controlled by the caller. */
function twoFunctionsSharing(body: string): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  tsm.createSourceFile(
    '/src/pair.ts',
    `export function f1() {\n${body}\n}\nexport function f2() {\n${body}\n}\n`,
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}

describe('smells.duplicateBodies()', () => {
  const p = project(path.join(fixturesDir, 'tsconfig.json'))

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flags near-identical function bodies above threshold', () => {
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    expect(() => builder.check()).toThrow(ArchRuleError)
  })

  it('.asSeverity() stamps severity on .violations() (TerminalBuilder)', () => {
    const warned = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .asSeverity('warn')
      .violations()
    expect(warned.length).toBeGreaterThan(0)
    expect(warned.every((v) => v.severity === 'warn')).toBe(true)

    const defaulted = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).violations()
    expect(defaulted.every((v) => v.severity === 'error')).toBe(true)
  })

  it('violation message contains similarity percentage', () => {
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    try {
      builder.check()
      expect.fail('Expected ArchRuleError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      expect(archErr.violations.length).toBeGreaterThan(0)
      expect(archErr.violations[0]!.message).toMatch(/\d+% similar to/)
    }
  })

  it('does not flag different functions below threshold', () => {
    // With threshold 1.0, only exact structural matches are flagged
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(1.0)
    expect(() => builder.check()).not.toThrow()
  })

  it('respects minLines filter — and a filter that empties the corpus now FAILS', () => {
    // Behaviour flip, plan 0099. This asserted `.not.toThrow()`: a `minLines` so
    // high that no function qualifies used to pass silently, which is bug 0066 in
    // one line — the detector reported nothing and the suite counted it as
    // coverage.
    const builder = smells.duplicateBodies(p).minLines(1000).withMinSimilarity(0.5)
    expect(() => builder.check()).toThrow(ArchRuleError)
    // By identity, not by the throw alone: assert it is the FLOOR's finding and
    // names the filter that did it, rather than any error at all.
    const config = builder.violations().filter((v) => v.bypassFilters === true)
    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('examined 0 function bodies')
    expect(config[0]?.message).toContain('minLines(1000)')
  })

  it('CONTROL: a filter that leaves subjects behind still enforces normally', () => {
    // Without this the row above passes if `minLines` were ignored entirely and
    // every corpus reported the floor finding.
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    const config = builder.violations().filter((v) => v.bypassFilters === true)
    expect(config).toEqual([])
    expect(builder.violations().length).toBeGreaterThan(0)
  })

  it('.warn() logs but does not throw', () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8).warn()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('.check() throws ArchRuleError with violations', () => {
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    try {
      builder.check()
      expect.fail('Expected ArchRuleError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      expect(archErr.violations.length).toBeGreaterThan(0)
    }
  })

  it('withMinSimilarity(1.0) only flags exact structural matches', () => {
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(1.0)
    // file-a and file-b are near-clones but not identical structure
    expect(() => builder.check()).not.toThrow()
  })

  it('describe() reflects the configured threshold', () => {
    const builder = smells.duplicateBodies(p).withMinSimilarity(0.9)
    // Access describe via check error message
    try {
      builder.minLines(3).check()
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      expect(archErr.violations[0]!.rule).toContain('0.9')
    }
  })

  it('.because() includes reason in violations', () => {
    const builder = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .because('Extract shared logic')

    try {
      builder.check()
      expect.fail('Expected ArchRuleError')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ArchRuleError)
      const archErr = err as ArchRuleError
      expect(archErr.violations[0]!.because).toBe('Extract shared logic')
    }
  })

  it('groupByFolder() does not change violation count', () => {
    const builderPlain = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    const builderGrouped = smells
      .duplicateBodies(p)
      .minLines(3)
      .withMinSimilarity(0.8)
      .groupByFolder()

    let plainCount = 0
    let groupedCount = 0

    try {
      builderPlain.check()
    } catch (err: unknown) {
      const archErr = err as ArchRuleError
      plainCount = archErr.violations.length
    }

    try {
      builderGrouped.check()
    } catch (err: unknown) {
      const archErr = err as ArchRuleError
      groupedCount = archErr.violations.length
    }

    expect(groupedCount).toBe(plainCount)
    expect(plainCount).toBeGreaterThan(0)
  })

  describe('plan 0103: minDistinctVocabulary()', () => {
    // Exactly 5 distinct identifier/literal texts: alpha, 1, beta, 2, gamma.
    const FIVE_TOKEN_BODY =
      '  const alpha = 1\n  const beta = 2\n  const gamma = alpha + beta\n  return gamma'
    const fiveTokenPair = twoFunctionsSharing(FIVE_TOKEN_BODY)

    it('a below-floor pair does not pair', () => {
      const violations = smells
        .duplicateBodies(fiveTokenPair)
        .minLines(2)
        .minDistinctVocabulary(6)
        .violations()
      expect(violations).toEqual([])
    })

    it('an at-floor pair (exact boundary) does pair', () => {
      const violations = smells
        .duplicateBodies(fiveTokenPair)
        .minLines(2)
        .minDistinctVocabulary(5)
        .violations()
      expect(violations.length).toBeGreaterThan(0)
    })

    it('the floor reads Math.min, not Math.max — an ASYMMETRIC pair is required to prove it', () => {
      // The plan's own sabotage matrix names this row explicitly: "a symmetric
      // pair can't distinguish Math.min from Math.max at all." Every other
      // fixture in this describe block IS symmetric (two functions sharing one
      // body string), so none of them can catch `Math.max` swapped in — found
      // by review, verified independently by reverting to `Math.max` and
      // confirming the pair below is the one that reds.
      //
      // Same shape, same nodeCount, near-identical kinds (so similarity clears
      // the 0.85 default) — but distinctVocabulary 5 vs 11.
      const tsm = new Project({ useInMemoryFileSystem: true })
      tsm.createSourceFile(
        '/src/asymmetric.ts',
        [
          'export function low(): number {',
          '  const s1 = 9',
          '  const s2 = s1 + s1',
          '  const s3 = s2 + s2',
          '  const s4 = s3 + s3',
          '  return s4',
          '}',
          'export function high(alpha: number, beta: number, gamma: number, delta: number, epsilon: number, zeta: number): number {',
          '  const t1 = 91',
          '  const t2 = alpha + beta',
          '  const t3 = gamma + delta',
          '  const t4 = epsilon + zeta',
          '  return t4',
          '}',
        ].join('\n'),
      )
      const asymmetric: ArchProject = {
        tsConfigPath: '/tsconfig.json',
        _project: tsm,
        getSourceFiles: () => tsm.getSourceFiles(),
      }

      // Between the two vocabularies (5 and 11): Math.min excludes, Math.max
      // would include.
      const violations = smells
        .duplicateBodies(asymmetric)
        .minLines(2)
        .minDistinctVocabulary(8)
        .violations()
      expect(violations).toEqual([])
    })

    it('.minDistinctVocabulary(0) is a real config no-op, not a config no-op for the OTHER knob', () => {
      // Proves the gate is additive to withMinSimilarity, not a replacement: at
      // floor 0 the pair is exactly today's (broken) behaviour — it still pairs
      // purely on similarity, regardless of how little vocabulary it carries.
      const violations = smells
        .duplicateBodies(fiveTokenPair)
        .minLines(2)
        .minDistinctVocabulary(0)
        .violations()
      expect(violations.length).toBeGreaterThan(0)
    })

    it('the floor participates in dedupe identity', () => {
      // Same proof plan 0099 used for minLines/ignorePaths: two rules differing
      // in exactly one field must not collapse into one describe() string, or
      // dedupeConfigFindings silently discards one of them.
      const a = smells.duplicateBodies(p).minDistinctVocabulary(4)
      const b = smells.duplicateBodies(p).minDistinctVocabulary(8)
      // describe() is protected; read it via the rule text a config finding carries.
      const describeOf = (builder: ReturnType<typeof smells.duplicateBodies>): string => {
        const configFinding = builder.minLines(1000).violations()[0]
        return configFinding?.rule ?? ''
      }
      expect(describeOf(a)).not.toBe(describeOf(b))
      expect(describeOf(a)).toContain('minDistinctVocabulary >= 4')
      expect(describeOf(b)).toContain('minDistinctVocabulary >= 8')
    })

    it('examinedUnits() is unchanged by the floor — it gates pairing, not selection', () => {
      const withFloor = smells.duplicateBodies(fiveTokenPair).minLines(2).minDistinctVocabulary(999)
      const withoutFloor = smells
        .duplicateBodies(fiveTokenPair)
        .minLines(2)
        .minDistinctVocabulary(0)
      expect(withFloor.examinedUnits()).toBe(withoutFloor.examinedUnits())
      expect(withFloor.examinedUnits()).toBeGreaterThan(0)
    })

    it('an absurdly high floor behaves like an absurdly high withMinSimilarity: silent, no config finding', () => {
      // `.minDistinctVocabulary(9999)` can zero every finding while
      // `examinedUnits() > 0` — indistinguishable from a genuinely clean corpus.
      // Accepted risk (Release): the same shape `withMinSimilarity(1.0)` already
      // has today. Proven as parity, not merely asserted — both arms must
      // actually SUPPRESS a real finding, or the comparison proves nothing
      // (review: testing — `fixturePair()` originally measured similarity 1.0,
      // so the `withMinSimilarity(1.0)` arm never excluded anything and this
      // test's "parity" claim was untested on that side).
      const control = smells.duplicateBodies(fixturePair()).minLines(3).violations()
      expect(control.length).toBeGreaterThan(0)

      const byVocab = smells
        .duplicateBodies(fixturePair())
        .minLines(3)
        .minDistinctVocabulary(9999)
        .violations()
      const bySimilarity = smells
        .duplicateBodies(fixturePair())
        .minLines(3)
        .withMinSimilarity(1.0)
        .violations()
      expect(byVocab.filter((v) => v.bypassFilters === true)).toEqual([])
      expect(bySimilarity.filter((v) => v.bypassFilters === true)).toEqual([])
      expect(byVocab.filter((v) => v.bypassFilters !== true)).toEqual([])
      expect(bySimilarity.filter((v) => v.bypassFilters !== true)).toEqual([])
    })

    it('a real body with ZERO distinct vocabulary never pairs again once the floor is set', () => {
      // Different from the hand-built empty-fingerprint case in fingerprint.test.ts:
      // this is a real, non-empty body (kinds/nodeCount > 0) with no
      // Identifier/*Literal descendants at all.
      const trivial = twoFunctionsSharing('  return true')
      const fp = fingerprintModule.buildFingerprint(
        trivial._project.getSourceFiles()[0]!.getFunctions()[0]!.getBody()!,
      )
      expect(fp.distinctVocabulary).toBe(0)

      const withoutFloor = smells
        .duplicateBodies(trivial)
        .minLines(1)
        .minDistinctVocabulary(0)
        .violations()
      expect(withoutFloor.length).toBeGreaterThan(0)

      const withFloor = smells
        .duplicateBodies(trivial)
        .minLines(1)
        .minDistinctVocabulary(1)
        .violations()
      expect(withFloor).toEqual([])
    })

    it('fast rejection actually rejects computeSimilarity — verified, not assumed', () => {
      // ADR-008 rule 5: spying on an internal, same-package collaborator is
      // unprecedented in this codebase, so the mechanism is specified exactly
      // (namespace import + vi.spyOn on the namespace property) rather than
      // hedged, and its correctness is asserted directly rather than inferred
      // from the surrounding tests passing.
      const spy = vi.spyOn(fingerprintModule, 'computeSimilarity')
      smells.duplicateBodies(fiveTokenPair).minLines(2).minDistinctVocabulary(6).violations()
      expect(spy).not.toHaveBeenCalled()

      spy.mockClear()
      smells.duplicateBodies(fiveTokenPair).minLines(2).minDistinctVocabulary(5).violations()
      expect(spy).toHaveBeenCalled()
    })
  })
})

/**
 * A fresh in-memory near-clone pair, similarity genuinely < 1.0 (review: testing
 * — an earlier version differed only in STRING LITERAL content, which
 * `computeSimilarity`'s kinds-only LCS cannot see, so it measured 1.0 and the
 * parity test below it asserted nothing on that arm). `beta` has one extra
 * statement `alpha` does not, so the `kinds` sequences genuinely diverge.
 */
function fixturePair(): ArchProject {
  const tsm = new Project({ useInMemoryFileSystem: true })
  tsm.createSourceFile(
    '/src/pair.ts',
    [
      'export function alpha(raw: number) {',
      '  const scaled = raw * 2',
      '  const shifted = scaled + 1',
      '  const bounded = shifted > 100 ? 100 : shifted',
      '  const labeled = bounded > 0 ? "positive" : "non-positive"',
      '  return { bounded, labeled }',
      '}',
      'export function beta(raw: number) {',
      '  const scaled = raw * 2',
      '  const shifted = scaled + 1',
      '  const noise = 1',
      '  const bounded = shifted > 100 ? 100 : shifted',
      '  const labeled = bounded > 0 ? "affirmative" : "negative"',
      '  return { bounded, labeled }',
      '}',
    ].join('\n'),
  )
  return {
    tsConfigPath: '/tsconfig.json',
    _project: tsm,
    getSourceFiles: () => tsm.getSourceFiles(),
  }
}
