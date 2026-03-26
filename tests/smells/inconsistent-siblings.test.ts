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

  it('returns no violations when no pattern is set', () => {
    const builder = smells.inconsistentSiblings(p).minLines(2)
    expect(() => builder.check()).not.toThrow()
  })

  it('.warn() logs but does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
