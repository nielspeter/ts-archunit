import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkAll } from '../../src/core/check-all.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { RuleBuilderLike } from '../../src/core/rule-builder-like.js'

const rule = (violations: ArchViolation[]): RuleBuilderLike => ({ violations: () => violations })
const v = (ruleId: string, severity?: 'error' | 'warn'): ArchViolation => ({
  rule: 'r',
  element: 'e',
  file: '/f.ts',
  line: 1,
  message: 'm',
  ruleId,
  severity,
})

afterEach(() => vi.restoreAllMocks())

describe('checkAll', () => {
  it('does not throw when every rule passes', () => {
    expect(() => checkAll([rule([]), rule([])])).not.toThrow()
  })

  it('throws ONE aggregated error carrying every error-severity violation', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      checkAll([rule([v('a', 'error')]), rule([v('b', 'error')])])
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ArchRuleError)
      expect((e as ArchRuleError).violations.map((x) => x.ruleId).sort()).toEqual(['a', 'b'])
    }
  })

  it('treats an un-stamped violation as error (default)', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(() => checkAll([rule([v('a', undefined)])])).toThrow(ArchRuleError)
  })

  it('does not throw when only warn-severity violations are present', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(() => checkAll([rule([v('a', 'warn')])])).not.toThrow()
    expect(spy).toHaveBeenCalled() // the warn is still reported
  })

  it('filters known violations through a baseline before deciding', () => {
    const baseline = { filterNew: (_: ArchViolation[]) => [] as ArchViolation[] }
    expect(() => checkAll([rule([v('a', 'error')])], { baseline })).not.toThrow()
  })
})
