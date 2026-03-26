import { describe, it, expect } from 'vitest'
import type { ArchRuleError } from '../../src/core/errors.js'
import { formatViolations } from '../../src/core/format.js'
import { formatViolationsGitHub } from '../../src/core/format-github.js'
import { formatViolationsJson } from '../../src/core/format-json.js'
import type { Condition, ConditionContext } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { SliceRuleBuilder } from '../../src/builders/slice-rule-builder.js'
import {
  type TestElement,
  TestRuleBuilder,
  stubProject,
  nameMatches,
  alwaysPass,
  makeViolation,
} from '../support/test-rule-builder.js'

// --- Helpers unique to this file ---

/** Condition that always fails, forwarding all metadata fields from context. */
function alwaysFailWithMetadata(): Condition<TestElement> {
  return {
    description: 'always fails',
    evaluate: (elements: TestElement[], context: ConditionContext): ArchViolation[] =>
      elements.map((el) => ({
        rule: context.rule,
        ruleId: context.ruleId,
        element: el.name,
        file: el.file,
        line: el.line,
        message: `violation in ${el.name}`,
        because: context.because,
        suggestion: context.suggestion,
        docs: context.docs,
      })),
  }
}

const elements: TestElement[] = [
  { name: 'ServiceA', file: `${process.cwd()}/src/a.ts`, line: 5, exported: true },
  { name: 'ServiceB', file: `${process.cwd()}/src/b.ts`, line: 10, exported: true },
]

describe('RuleMetadata', () => {
  it('.rule() attaches metadata and passes it to violations', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder
        .should()
        .withCondition(alwaysFailWithMetadata())
        .rule({
          id: 'test/rule-id',
          because: 'test reason',
          suggestion: 'do something else',
          docs: 'https://example.com/docs',
        })
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations[0]?.ruleId).toBe('test/rule-id')
      expect(archError.violations[0]?.because).toBe('test reason')
      expect(archError.violations[0]?.suggestion).toBe('do something else')
      expect(archError.violations[0]?.docs).toBe('https://example.com/docs')
    }
  })

  it('.rule({ because }) sets the reason (same as .because())', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder
        .should()
        .withCondition(alwaysFailWithMetadata())
        .rule({ because: 'typed errors required' })
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('typed errors required')
      expect(archError.violations[0]?.because).toBe('typed errors required')
    }
  })

  it('.because() still works alone without .rule()', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder.should().withCondition(alwaysFailWithMetadata()).because('legacy reason').check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('legacy reason')
      expect(archError.violations[0]?.because).toBe('legacy reason')
      // No metadata fields populated
      expect(archError.violations[0]?.ruleId).toBeUndefined()
      expect(archError.violations[0]?.docs).toBeUndefined()
    }
  })

  it('terminal format shows Why/Fix/Docs when present', () => {
    const violations = [
      makeViolation({
        element: 'MyService.getTotal',
        because: 'Generic Error loses context',
        suggestion: 'Replace new Error() with new NotFoundError()',
        docs: 'https://example.com/adr-011',
      }),
    ]
    const output = formatViolations(violations)
    expect(output).toContain('Why: Generic Error loses context')
    expect(output).toContain('Fix: Replace new Error() with new NotFoundError()')
    expect(output).toContain('Docs: https://example.com/adr-011')
  })

  it('terminal format omits Why/Fix/Docs when not present', () => {
    const violations = [makeViolation({ element: 'MyService.getTotal' })]
    const output = formatViolations(violations)
    expect(output).not.toContain('Why:')
    expect(output).not.toContain('Fix:')
    expect(output).not.toContain('Docs:')
  })

  it('GitHub format includes suggestion and docs in message', () => {
    const violations = [
      makeViolation({
        element: 'MyService.getTotal',
        because: 'security risk',
        suggestion: 'Use typed errors',
        docs: 'https://example.com/docs',
      }),
    ]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('. Fix: Use typed errors')
    expect(output).toContain('. Docs: https://example.com/docs')
  })

  it('GitHub format uses ruleId as title when present', () => {
    const violations = [
      makeViolation({
        element: 'MyService.getTotal',
        ruleId: 'repo/typed-errors',
      }),
    ]
    const output = formatViolationsGitHub(violations)
    expect(output).toContain('title=Architecture Violation: repo/typed-errors')
  })

  it('JSON format includes all metadata fields', () => {
    const violations = [
      makeViolation({
        element: 'MyService.getTotal',
        ruleId: 'test/json-rule',
        suggestion: 'do better',
        docs: 'https://example.com/docs',
      }),
    ]
    const output = formatViolationsJson(violations)
    const parsed = JSON.parse(output) as {
      violations: Array<{
        ruleId: string | null
        suggestion: string | null
        docs: string | null
      }>
    }
    expect(parsed.violations[0]?.ruleId).toBe('test/json-rule')
    expect(parsed.violations[0]?.suggestion).toBe('do better')
    expect(parsed.violations[0]?.docs).toBe('https://example.com/docs')
  })

  it('ArchViolation has ruleId and docs populated from context', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    try {
      builder
        .should()
        .withCondition(alwaysFailWithMetadata())
        .rule({
          id: 'ctx/rule',
          docs: 'https://example.com/rule',
        })
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      for (const v of archError.violations) {
        expect(v.ruleId).toBe('ctx/rule')
        expect(v.docs).toBe('https://example.com/rule')
      }
    }
  })

  it('named selections preserve metadata via fork()', () => {
    const selection = new TestRuleBuilder(stubProject, elements)
      .that()
      .withPredicate(nameMatches(/Service/))
      .rule({
        id: 'fork/test',
        because: 'fork reason',
        suggestion: 'fork suggestion',
        docs: 'https://example.com/fork',
      })

    // First rule from the selection
    try {
      selection.should().withCondition(alwaysFailWithMetadata()).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations[0]?.ruleId).toBe('fork/test')
      expect(archError.violations[0]?.because).toBe('fork reason')
      expect(archError.violations[0]?.suggestion).toBe('fork suggestion')
      expect(archError.violations[0]?.docs).toBe('https://example.com/fork')
    }

    // Second rule from the same selection (should not be affected by the first)
    expect(() => {
      selection.should().withCondition(alwaysPass()).check()
    }).not.toThrow()
  })

  it('SliceRuleBuilder supports .rule() method', () => {
    const builder = new SliceRuleBuilder(stubProject)
    // Verify .rule() is callable and returns the builder for chaining
    const result = builder.rule({
      id: 'slice/test',
      because: 'slice reason',
      suggestion: 'slice suggestion',
      docs: 'https://example.com/slice',
    })
    expect(result).toBe(builder)
  })
})
