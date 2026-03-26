import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { project } from '../../src/core/project.js'
import { smells } from '../../src/smells/index.js'
import { ArchRuleError } from '../../src/core/errors.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')

describe('smells.duplicateBodies()', () => {
  const p = project(path.join(fixturesDir, 'tsconfig.json'))

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('flags near-identical function bodies above threshold', () => {
    const builder = smells.duplicateBodies(p).minLines(3).withMinSimilarity(0.8)
    expect(() => builder.check()).toThrow(ArchRuleError)
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

  it('respects minLines filter', () => {
    // With a very high minLines, no functions qualify
    const builder = smells.duplicateBodies(p).minLines(1000).withMinSimilarity(0.5)
    expect(() => builder.check()).not.toThrow()
  })

  it('.warn() logs but does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
})
