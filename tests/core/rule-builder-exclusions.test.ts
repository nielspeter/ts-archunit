import { describe, it, expect, vi } from 'vitest'
import { ArchRuleError } from '../../src/core/errors.js'
import { Baseline, hashViolation } from '../../src/helpers/baseline.js'
import type { ArchViolation } from '../../src/core/violation.js'
import {
  TestRuleBuilder,
  stubProject,
  nameMatches,
  alwaysFail,
} from '../support/test-rule-builder.js'
import { silent } from '../../src/core/silent-exclusion.js'

const elements = [
  { name: 'UserService', file: '/project/src/services/user.ts', line: 5, exported: true },
  { name: 'OrderService', file: '/project/src/services/order.ts', line: 3, exported: true },
  { name: 'FooHelper', file: '/project/src/helpers/foo.ts', line: 1, exported: true },
  { name: 'BarHelper', file: '/project/src/helpers/bar.ts', line: 10, exported: true },
]

describe('.excluding()', () => {
  it('suppresses violations matching exact element name', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      builder.should().withCondition(alwaysFail()).excluding('UserService').check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(3)
        expect(error.violations.map((v) => v.element)).not.toContain('UserService')
      }
    }
    warnSpy.mockRestore()
  })

  it('suppresses violations matching regex pattern', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      builder
        .should()
        .withCondition(alwaysFail())
        .excluding(/Helper$/)
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(2)
        const names = error.violations.map((v) => v.element)
        expect(names).not.toContain('FooHelper')
        expect(names).not.toContain('BarHelper')
      }
    }
    warnSpy.mockRestore()
  })

  it('does not suppress non-matching violations', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      builder.should().withCondition(alwaysFail()).excluding('UserService').check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        const names = error.violations.map((v) => v.element)
        expect(names).toContain('OrderService')
        expect(names).toContain('FooHelper')
        expect(names).toContain('BarHelper')
      }
    }
    warnSpy.mockRestore()
  })

  it('supports multiple exclusion patterns', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      builder
        .should()
        .withCondition(alwaysFail())
        .excluding('UserService', /Helper$/)
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(1)
        expect(error.violations[0]?.element).toBe('OrderService')
      }
    }
    warnSpy.mockRestore()
  })

  it('warns about unused exclusions', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().withCondition(alwaysFail()).excluding('NonExistent').check()
    } catch {
      // expected
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unused exclusion 'NonExistent'"))
    warnSpy.mockRestore()
  })

  it('works with .check() — excluded violations do not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builder = new TestRuleBuilder(stubProject, elements)
    expect(() => {
      builder
        .should()
        .withCondition(alwaysFail())
        .excluding('UserService', 'OrderService', 'FooHelper', 'BarHelper')
        .check()
    }).not.toThrow()
    warnSpy.mockRestore()
  })

  it('works with .warn() — excluded violations not logged', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builder = new TestRuleBuilder(stubProject, elements)
    builder
      .should()
      .withCondition(alwaysFail())
      .excluding('UserService', 'FooHelper', 'BarHelper')
      .warn()

    // One call from console.warn for the remaining violation, zero for excluded
    // The formatViolations call for the 1 remaining violation
    const outputs = warnSpy.mock.calls.map((c) => String(c[0]))
    const violationOutput = outputs.find((o) => o.includes('OrderService'))
    expect(violationOutput).toBeDefined()
    expect(violationOutput).not.toContain('UserService')
    warnSpy.mockRestore()
  })

  it('works with baseline — exclusions applied before baseline filter', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Create a baseline that knows about OrderService
    const knownViolation: ArchViolation = {
      rule: 'should always fails with "violated"',
      element: 'OrderService',
      file: '/project/src/services/order.ts',
      line: 3,
      message: 'violated: OrderService',
    }
    const hashes = new Set([hashViolation(knownViolation)])
    const baseline = new Baseline(hashes, '/project')

    // Exclude UserService via .excluding(), OrderService via baseline
    // FooHelper and BarHelper should remain
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().withCondition(alwaysFail()).excluding('UserService').check({ baseline })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        const names = error.violations.map((v) => v.element)
        expect(names).not.toContain('UserService')
        expect(names).not.toContain('OrderService')
        expect(names).toContain('FooHelper')
        expect(names).toContain('BarHelper')
      }
    }
    warnSpy.mockRestore()
  })

  it('preserved across named selections (fork)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const selection = new TestRuleBuilder(stubProject, elements)
      .that()
      .withPredicate(nameMatches(/Service$/))
      .excluding('UserService')

    // First rule from the selection
    try {
      selection.should().withCondition(alwaysFail()).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(1)
        expect(error.violations[0]?.element).toBe('OrderService')
      }
    }

    // Second rule — exclusion should still be preserved
    expect(() => {
      selection.should().withCondition(alwaysFail()).excluding('OrderService').check()
    }).not.toThrow()
    warnSpy.mockRestore()
  })

  it('silent() exclusion suppresses unused-exclusion warning through builder chain', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder
        .should()
        .withCondition(alwaysFail())
        .excluding(silent(/SilentPattern/), 'LoudPattern')
        .rule({ id: 'test/silent-rule' })
        .check()
    } catch {
      // expected — other violations remain
    }
    // silent(/SilentPattern/) should NOT warn, but 'LoudPattern' should
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]))
    const unusedWarnings = warnings.filter((w) => w.includes('Unused exclusion'))
    expect(unusedWarnings).toHaveLength(1)
    expect(unusedWarnings[0]).toContain('LoudPattern')
    expect(unusedWarnings[0]).not.toContain('SilentPattern')
    warnSpy.mockRestore()
  })

  it('silent() exclusion still filters violations when matched', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder
        .should()
        .withCondition(alwaysFail())
        .excluding(silent(/Helper$/))
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(2)
        const names = error.violations.map((v) => v.element)
        expect(names).not.toContain('FooHelper')
        expect(names).not.toContain('BarHelper')
      }
    }
    warnSpy.mockRestore()
  })

  it('silent() exclusion preserved across fork', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const selection = new TestRuleBuilder(stubProject, elements)
      .that()
      .withPredicate(nameMatches(/Service$/))
      .excluding(silent(/NonExistent/))

    try {
      selection.should().withCondition(alwaysFail()).check()
    } catch {
      // expected
    }
    // silent exclusion should not warn even after fork
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(warnings.filter((w) => w.includes('Unused exclusion'))).toHaveLength(0)
    warnSpy.mockRestore()
  })

  it('unused exclusion warning includes the rule ID', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder
        .should()
        .withCondition(alwaysFail())
        .excluding('NonExistent')
        .rule({ id: 'test/my-rule' })
        .check()
    } catch {
      // expected
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("rule 'test/my-rule'"))
    warnSpy.mockRestore()
  })
})
