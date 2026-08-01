import { describe, it, expect } from 'vitest'
import { parseExclusionComments, isExcludedByComment } from '../../src/core/exclusion-comments.js'
import { applyFilters } from '../../src/core/execute-rule.js'
import type { ExclusionComment } from '../../src/core/exclusion-comments.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { TestRuleBuilder, stubProject, alwaysFail } from '../support/test-rule-builder.js'
import type { TestElement } from '../support/test-rule-builder.js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('parseExclusionComments', () => {
  it('parses single-line exclusion comment', () => {
    const source = [
      'const x = 1',
      '// ts-archunit-exclude sdk/no-manual-urlsearchparams: builds image transform URL',
      'const params = new URLSearchParams()',
    ].join('\n')

    const result = parseExclusionComments(source, 'src/foo.ts')
    expect(result.exclusions).toHaveLength(1)
    expect(result.exclusions[0]?.ruleId).toBe('sdk/no-manual-urlsearchparams')
    expect(result.exclusions[0]?.reason).toBe('builds image transform URL')
    expect(result.exclusions[0]?.file).toBe('src/foo.ts')
    expect(result.exclusions[0]?.line).toBe(2)
    expect(result.exclusions[0]?.isBlock).toBe(false)
    expect(result.warnings).toHaveLength(0)
  })

  it('parses block exclusion (start/end) with line range', () => {
    const source = [
      '// ts-archunit-exclude-start sdk/no-manual-urlsearchparams: image URL builder',
      'async function getImageUrl() {',
      '  const params = new URLSearchParams()',
      '  return params.toString()',
      '}',
      '// ts-archunit-exclude-end',
    ].join('\n')

    const result = parseExclusionComments(source, 'src/asset.ts')
    expect(result.exclusions).toHaveLength(1)
    expect(result.exclusions[0]?.ruleId).toBe('sdk/no-manual-urlsearchparams')
    expect(result.exclusions[0]?.reason).toBe('image URL builder')
    expect(result.exclusions[0]?.isBlock).toBe(true)
    expect(result.exclusions[0]?.line).toBe(1)
    expect(result.exclusions[0]?.endLine).toBe(6)
    expect(result.warnings).toHaveLength(0)
  })

  it('parses multiple rule IDs on one line (comma-separated)', () => {
    const source = ['// ts-archunit-exclude rule-a, rule-b: shared reason', 'doSomething()'].join(
      '\n',
    )

    const result = parseExclusionComments(source, 'src/bar.ts')
    expect(result.exclusions).toHaveLength(2)
    expect(result.exclusions[0]?.ruleId).toBe('rule-a')
    expect(result.exclusions[1]?.ruleId).toBe('rule-b')
    expect(result.exclusions[0]?.reason).toBe('shared reason')
    expect(result.exclusions[1]?.reason).toBe('shared reason')
  })

  it('warns about missing reason', () => {
    const source = [
      '// ts-archunit-exclude sdk/no-manual-urlsearchparams',
      'const params = new URLSearchParams()',
    ].join('\n')

    const result = parseExclusionComments(source, 'src/foo.ts')
    expect(result.exclusions).toHaveLength(1)
    expect(result.exclusions[0]?.reason).toBe('')
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.message).toContain('Undocumented exclusion')
    expect(result.warnings[0]?.message).toContain('Add a reason')
  })

  // Bug 0039. This test used to assert a `Nested` warning and never looked at
  // `result.exclusions` — which is exactly how the real behaviour stayed
  // invisible: the inner directive was dropped, the inner `-end` closed the
  // OUTER block, and the fixture silently produced a `rule-a` exclusion ending
  // at line 5 that nothing asserted. Nesting two different rules is legitimate
  // and now works.
  it('nests two different rules, innermost closed first', () => {
    const source = [
      '// ts-archunit-exclude-start rule-a: outer block',
      'const x = 1',
      '// ts-archunit-exclude-start rule-b: inner block',
      'const y = 2',
      '// ts-archunit-exclude-end',
      'const z = 3',
      '// ts-archunit-exclude-end',
    ].join('\n')

    const result = parseExclusionComments(source, 'src/nested.ts')
    expect(result.warnings).toHaveLength(0)

    const byRule = new Map(result.exclusions.map((e) => [e.ruleId, e]))
    // Innermost closes at the FIRST end, outermost at the second — the whole
    // fix, as one assertion. Before it, `rule-a` ended at line 5 and `rule-b`
    // did not exist.
    expect(byRule.get('rule-b')).toMatchObject({ line: 3, endLine: 5 })
    expect(byRule.get('rule-a')).toMatchObject({ line: 1, endLine: 7 })
  })

  it('re-opening a rule that is already open is warned, and still applies', () => {
    const source = [
      '// ts-archunit-exclude-start rule-a: outer',
      '// ts-archunit-exclude-start rule-a: redundant',
      '// ts-archunit-exclude-end',
      '// ts-archunit-exclude-end',
    ].join('\n')

    const result = parseExclusionComments(source, 'src/dup.ts')
    // Warned because the likeliest cause is a missing `-end` — but still
    // applied, because refusing it is what produced the early-close bug.
    expect(result.warnings.map((w) => w.kind)).toEqual(['malformed'])
    expect(result.warnings[0]?.message).toContain('already open')
    expect(result.exclusions).toHaveLength(2)
  })
})

describe('isExcludedByComment', () => {
  it('matches violation within block line range', () => {
    const comment: ExclusionComment = {
      ruleId: 'test/rule',
      reason: 'intentional',
      file: 'src/foo.ts',
      line: 5,
      isBlock: true,
      endLine: 10,
    }

    const violation: ArchViolation = {
      rule: 'test rule',
      ruleId: 'test/rule',
      element: 'doSomething',
      file: 'src/foo.ts',
      line: 7,
      message: 'violation',
    }

    expect(isExcludedByComment(violation, [comment])).toBe(true)
  })

  it('matches single-line exclusion on next line', () => {
    const comment: ExclusionComment = {
      ruleId: 'test/rule',
      reason: 'intentional',
      file: 'src/foo.ts',
      line: 5,
      isBlock: false,
    }

    const violation: ArchViolation = {
      rule: 'test rule',
      ruleId: 'test/rule',
      element: 'doSomething',
      file: 'src/foo.ts',
      line: 6,
      message: 'violation',
    }

    expect(isExcludedByComment(violation, [comment])).toBe(true)
  })

  it('does not match wrong rule ID', () => {
    const comment: ExclusionComment = {
      ruleId: 'rule-a',
      reason: 'intentional',
      file: 'src/foo.ts',
      line: 5,
      isBlock: false,
    }

    const violation: ArchViolation = {
      rule: 'test rule',
      ruleId: 'rule-b',
      element: 'doSomething',
      file: 'src/foo.ts',
      line: 6,
      message: 'violation',
    }

    expect(isExcludedByComment(violation, [comment])).toBe(false)
  })

  it('does not match wrong file', () => {
    const comment: ExclusionComment = {
      ruleId: 'test/rule',
      reason: 'intentional',
      file: 'src/foo.ts',
      line: 5,
      isBlock: false,
    }

    const violation: ArchViolation = {
      rule: 'test rule',
      ruleId: 'test/rule',
      element: 'doSomething',
      file: 'src/bar.ts',
      line: 6,
      message: 'violation',
    }

    expect(isExcludedByComment(violation, [comment])).toBe(false)
  })
})

describe('inline exclusion end-to-end', () => {
  it('inline exclusion comment suppresses violation in full pipeline', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-test-'))
    const filePath = path.join(tmpDir, 'test-source.ts')
    const sourceContent = [
      'const x = 1',
      '// ts-archunit-exclude my/test-rule: intentional violation for testing',
      'function doSomething() {}',
    ].join('\n')
    fs.writeFileSync(filePath, sourceContent)

    const elements: TestElement[] = [
      { name: 'doSomething', file: filePath, line: 3, exported: true },
    ]

    const builder = new TestRuleBuilder(stubProject, elements)
    // With rule ID matching the exclusion comment, the violation should be suppressed
    expect(() => {
      builder.should().withCondition(alwaysFail()).rule({ id: 'my/test-rule' }).check()
    }).not.toThrow()

    // Clean up
    fs.unlinkSync(filePath)
    fs.rmdirSync(tmpDir)
  })
})

describe('a configuration finding cannot be silenced by a `ts-archunit-exclude` comment', () => {
  // `applyFilters` filters comment exclusions with
  // `v.bypassFilters === true || !isExcludedByComment(...)`, and that first
  // clause is load-bearing: it is the only thing stopping a `ts-archunit-exclude`
  // comment from suppressing a finding that says the rule enforces nothing.
  //
  // Its own docstring named the temptation — "the moment one carries a real
  // path" — and bug 0026 is that moment: configuration findings are now stamped
  // with the rule file they came from, so `readFileSync` succeeds and the
  // comments in that file are parsed. Until then the clause was untestable in
  // practice and nothing exercised it: these findings carried `file: ''`, so
  // `readFileSync('')` threw into the catch and no comment could ever match.
  const scratch = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-exclude-comment-'))

  it('survives a comment that WOULD match it, while an ordinary violation does not', () => {
    const dir = scratch()
    try {
      const file = path.join(dir, 'arch.rules.ts')
      // Line 1 is the comment, so line 2 is what it excludes — and the stamped
      // configuration finding sits at line 1. Both are covered by a block form.
      fs.writeFileSync(
        file,
        [
          '// ts-archunit-exclude-start test/rule: intentional',
          'const x = 1',
          '// ts-archunit-exclude-end',
          '',
        ].join('\n'),
      )
      const ctx = {
        metadata: { id: 'test/rule' },
        exclusions: [],
        silentIndices: new Set<number>(),
      }
      const ordinary: ArchViolation = {
        rule: 'r',
        ruleId: 'test/rule',
        element: 'x',
        file,
        line: 2,
        message: 'an ordinary violation',
      }
      const configFinding: ArchViolation = {
        rule: 'test/rule',
        ruleId: 'test/rule',
        element: 'test/rule',
        file,
        line: 1,
        message: 'this rule asserts nothing and can never fail',
        bypassFilters: true,
      }

      const kept = applyFilters([ordinary, configFinding], ctx)

      // The comment works — otherwise this test proves nothing about the
      // configuration finding surviving it (the guard would pass because the
      // comment matched neither).
      expect(kept.map((v) => v.message)).not.toContain('an ordinary violation')
      // And the configuration finding is still there.
      expect(kept.map((v) => v.message)).toContain('this rule asserts nothing and can never fail')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
