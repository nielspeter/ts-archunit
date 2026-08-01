/**
 * What `applyFilters`' enrichment step promises, asserted directly.
 *
 * Both cases here were found by a sabotage run over
 * [bug 0041](../../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md)'s
 * diff, and both came back **green** — the suite could not see either mutation.
 * They are unrelated to that bug; the reorder simply put a spotlight on the
 * block. Recorded here rather than in either bug's guard, because neither is
 * about exclusion comments.
 */
import { describe, expect, it } from 'vitest'
import { applyFilters } from '../../src/core/execute-rule.js'
import type { ArchViolation } from '../../src/core/violation.js'

function violation(over: Partial<ArchViolation> = {}): ArchViolation {
  return { rule: 'r', element: 'e', file: 'src/a.ts', line: 1, message: 'm', ...over }
}

describe('enrichment: the author’s remedy never reaches a configuration finding', () => {
  // Sabotage row E5. Flattening `suggestion: v.bypassFilters ? v.suggestion : (...)`
  // to `v.suggestion ?? meta?.suggestion` left the whole suite green, because all
  // twelve `bypassFilters` producers now set their own `suggestion` — so the
  // ternary has no live subject anywhere in `src/`. The mechanism is bug 0021's
  // guard and it works; nothing asserted it. Asserted here directly, for the same
  // reason the `isExcludedByComment` residue is: a green sabotage row that nobody
  // can account for is worse than a red one.
  it('withholds suggestion and docs from a bypassFilters finding', () => {
    const [out] = applyFilters([violation({ bypassFilters: true })], {
      metadata: { id: 'r/id', suggestion: "AUTHOR'S FIX", docs: 'https://example.test/a' },
    })
    expect(out?.suggestion).toBeUndefined()
    expect(out?.docs).toBeUndefined()
    expect(out?.ruleId).toBe('r/id')
  })

  it('CONTROL: an ordinary violation receives both', () => {
    const [out] = applyFilters([violation()], {
      metadata: { id: 'r/id', suggestion: "AUTHOR'S FIX", docs: 'https://example.test/a' },
    })
    expect(out?.suggestion).toBe("AUTHOR'S FIX")
    expect(out?.docs).toBe('https://example.test/a')
  })

  it('a producer’s own suggestion outranks the author’s', () => {
    const [out] = applyFilters([violation({ suggestion: 'PRODUCER' })], {
      metadata: { id: 'r/id', suggestion: "AUTHOR'S FIX" },
    })
    expect(out?.suggestion).toBe('PRODUCER')
  })
})

describe('enrichment: because precedence', () => {
  // Sabotage row E10. Swapping `ctx.reason` and `meta?.because` left the suite
  // green: `tests/core/rule-metadata.test.ts` sets one or the other, never both
  // on the same rule, so nothing in CI could see the order change. The two only
  // differ when both are present, which is precisely the case no test covered.
  it('.because() outranks .rule({ because })', () => {
    const [out] = applyFilters([violation()], {
      reason: 'FROM because()',
      metadata: { id: 'r/id', because: 'FROM rule()' },
    })
    expect(out?.because).toBe('FROM because()')
  })

  it('each alone still lands', () => {
    const [fromReason] = applyFilters([violation()], { reason: 'FROM because()' })
    expect(fromReason?.because).toBe('FROM because()')

    const [fromMeta] = applyFilters([violation()], {
      metadata: { id: 'x', because: 'FROM rule()' },
    })
    expect(fromMeta?.because).toBe('FROM rule()')
  })

  it('a producer’s own because outranks both', () => {
    const [out] = applyFilters([violation({ because: 'PRODUCER' })], {
      reason: 'FROM because()',
      metadata: { id: 'r/id', because: 'FROM rule()' },
    })
    expect(out?.because).toBe('PRODUCER')
  })
})
