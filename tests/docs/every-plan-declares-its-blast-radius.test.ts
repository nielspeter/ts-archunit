/**
 * Every plan in scope declares its **Blast radius** —
 * [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6, enforced rather than
 * conventional.
 *
 * Rule 6 says recursion depth tracks blast radius, and `CLAUDE.md` requires the line in a
 * plan's header *"because that is where the decision is made; recorded afterwards it is a
 * retrospective, and rule 6 exists to be decided in advance"*.
 *
 * It was a convention with no check. Audited 2026-08-04 as
 * [plan 0083](../../plans/0083-eat-our-own-dogfood.md) Phase 4: present on **17 of 88**
 * plans overall, and on all 16 in scope — so this guard is green on arrival. That is
 * deliberate. Its job is not to find today's violations; it is to stop the eighty-ninth
 * plan being filed without one **silently**, which is exactly what a convention cannot do.
 *
 * ## Why a boundary, and why it is guarded too
 *
 * Rule 6 landed on 2026-07-31 and plan **0078** is the first filed after it. Plans written
 * before the rule existed cannot be held to it, so they are grandfathered — and a
 * grandfather clause is an escape hatch, which under rule 3 must be *stated* and must not
 * be silently widenable. So the boundary is asserted from both sides: in-scope plans must
 * carry the line, and at least one plan below the boundary must **lack** it. Without that
 * second assertion the constant could be raised to 9999 and every row would still pass.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The first plan filed after rule 6 landed (2026-07-31).
 *
 * Not a taste threshold: `git log` for `docs(adr-008): land rule 6` is 2026-07-31, and 0078
 * is the lowest-numbered plan filed after that date. Raising it grandfathers a plan that
 * should have complied, which is why the row below checks the boundary is doing work.
 */
const FIRST_IN_SCOPE = 78

const PLANS_DIR = path.resolve(import.meta.dirname, '../../plans')

interface Plan {
  readonly number: number
  readonly relPath: string
  readonly declaresBlastRadius: boolean
}

/** Every numbered plan, open or completed. */
function allPlans(): Plan[] {
  const dirs = [PLANS_DIR, path.join(PLANS_DIR, 'completed')]
  return dirs.flatMap((dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^\d{4}-.*\.md$/.test(e.name))
      .map((e) => {
        const full = path.join(dir, e.name)
        return {
          number: Number(e.name.slice(0, 4)),
          relPath: path.relative(PLANS_DIR, full),
          // The header line, not a passing mention: it must be a bolded field, which is
          // what `CLAUDE.md` specifies and what a reader scans for.
          declaresBlastRadius: /\*\*Blast radius:\*\*/.test(fs.readFileSync(full, 'utf-8')),
        }
      }),
  )
}

describe('every plan in scope declares its blast radius (ADR-008 rule 6)', () => {
  const plans = allPlans()
  const inScope = plans.filter((p) => p.number >= FIRST_IN_SCOPE)
  const grandfathered = plans.filter((p) => p.number < FIRST_IN_SCOPE)

  it('VACUITY: the walk finds the plans, and both sides of the boundary are populated', () => {
    // Every row below turns on a filtered list, so an empty walk makes all of them
    // trivially true — which is the false green this library is named after. And if either
    // side of the boundary were empty, the boundary itself would be untested.
    expect(plans.length).toBeGreaterThan(80)
    expect(inScope.length).toBeGreaterThan(10)
    expect(grandfathered.length).toBeGreaterThan(10)
  })

  it('names the plans missing it, not how many', () => {
    // By identity (rule 4): a count tells a reader a number to make go down; a list tells
    // them which file to open.
    const missing = inScope.filter((p) => !p.declaresBlastRadius).map((p) => p.relPath)
    expect(missing).toEqual([])
  })

  it('the boundary is doing work — plans below it really do lack the line', () => {
    // The escape hatch, guarded. Without this, `FIRST_IN_SCOPE = 9999` passes the row above
    // while enforcing nothing, and a grandfather clause that can be widened silently is
    // worse than no clause (rule 3).
    const withoutIt = grandfathered.filter((p) => !p.declaresBlastRadius)
    expect(withoutIt.length).toBeGreaterThan(0)
  })

  it('the boundary is not set beyond the newest plan', () => {
    // The other way to neuter it: set the constant just past the highest plan number, so
    // `inScope` is empty and nothing is checked. The vacuity row catches that today, and
    // this states the invariant directly so the reason survives.
    const highest = Math.max(...plans.map((p) => p.number))
    expect(FIRST_IN_SCOPE).toBeLessThanOrEqual(highest)
  })
})
