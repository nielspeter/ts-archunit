/**
 * An inline exclusion comment says what it silenced.
 *
 * Every other filter in the pipeline discloses itself — `.excluding()` warns on
 * an unused pattern, diff-aware has `suppressionNotice`, the baseline has
 * `unmatchedBaselineFinding`. The comment filter dropped violations and returned
 * nothing, and [bug 0041](../../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md)
 * made it the widest filter we ship. `diff-disclosure.ts` names the principle:
 * *a run with every finding suppressed is indistinguishable from a clean run.*
 *
 * The notice reports **identities** — which rule in which file — not a bare
 * count, per ADR-008 rule 4. A count moves whenever anything moves and tells the
 * reader nothing to act on.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  commentSuppressionNotice,
  commentSuppressions,
  recordCommentSuppression,
  resetCommentSuppression,
} from '../../src/core/comment-suppression.js'

afterEach(() => {
  resetCommentSuppression()
})

describe('inline comment suppression is disclosed', () => {
  it('says nothing when nothing was suppressed — no blank line, no empty header', () => {
    resetCommentSuppression()
    expect(commentSuppressionNotice()).toBeUndefined()
    expect(commentSuppressions()).toHaveLength(0)
  })

  it('names the rule and the file, not just a total', () => {
    resetCommentSuppression()
    recordCommentSuppression('arch/no-cycles', 'src/legacy/gateway.ts')
    const notice = commentSuppressionNotice()
    expect(notice).toBeDefined()
    expect(notice).toContain('arch/no-cycles')
    expect(notice).toContain('src/legacy/gateway.ts')
    // The stakes, so a reader does not file it as noise.
    expect(notice).toContain('exemptions, not passes')
  })

  it('collapses repeats of one identity into a count, not repeated lines', () => {
    resetCommentSuppression()
    for (let i = 0; i < 3; i++) recordCommentSuppression('arch/x', 'src/a.ts')
    const notice = commentSuppressionNotice() ?? ''
    expect(notice).toContain('(3×)')
    // One identity line, not three.
    expect(notice.split('\n').filter((l) => l.includes('arch/x'))).toHaveLength(1)
    // …and the run total is still the truth.
    expect(notice).toContain('3 findings suppressed')
  })

  it('states the cap instead of truncating silently', () => {
    // A silent truncation reads as "that is all of them", which is the same lie
    // as no disclosure at all.
    resetCommentSuppression()
    for (let i = 0; i < 9; i++)
      recordCommentSuppression(`arch/r${String(i)}`, `src/f${String(i)}.ts`)
    const notice = commentSuppressionNotice() ?? ''
    expect(notice).toContain('…and 4 more')
    expect(notice).toContain('9 findings suppressed')
  })

  it('reset actually resets — a run does not inherit the previous run’s tally', () => {
    resetCommentSuppression()
    recordCommentSuppression('arch/x', 'src/a.ts')
    expect(commentSuppressions()).toHaveLength(1)
    resetCommentSuppression()
    expect(commentSuppressions()).toHaveLength(0)
    expect(commentSuppressionNotice()).toBeUndefined()
  })
})
