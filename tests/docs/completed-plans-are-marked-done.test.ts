/**
 * A plan in `plans/completed/` says it is done.
 *
 * `CLAUDE.md`: _"Completed plans move to `/plans/completed/`"_, and the protocol is that a
 * plan is **marked finished, given what was actually done, and then moved** — the move is
 * the last step, not the only one. Three plans had been moved without the first step:
 * `0089` and `0098` said "Open" while carrying a full `## Outcome`, and `0099` said "Open,
 * not started" while shipped in v0.59.0 and tagged.
 *
 * The location was the status, so the header contradicted the folder and nothing noticed.
 * A five-persona architecture review of 0099 did notice — it reported the stale header —
 * and it was still not fixed, because a review finding with no guard behind it is a note.
 * This is the guard.
 *
 * ## What this does NOT check, and why the gap is stated rather than closed
 *
 * It does not require an `## Outcome` section. Six in-scope plans lack one (`0079`, `0081`,
 * `0082`, `0084`, `0085`, `0087`), and there are only two ways to make that row green:
 * retrofit six historical plans with outcomes reconstructed after the fact, or move the
 * boundary to 88 where the data happens to comply. The first invents a record; the second
 * fits the boundary to the data, which is the move [ADR-008](../../adr/008-agent-first-failure-surfaces.md)
 * exists to forbid — a threshold chosen because it passes is not a threshold.
 *
 * So the Outcome half stays a convention, named here so that "we thought about this" and
 * "we forgot this" do not look the same. Close it by writing the six outcomes, then adding
 * the row — in that order.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The same boundary as `every-plan-declares-its-blast-radius.test.ts`, for the same reason:
 * 0078 is the lowest-numbered plan filed after ADR-008 rule 6 landed on 2026-07-31, and
 * that is when this repo's plan headers became a checked format rather than prose. Plans
 * below it predate the `**Status:**` field entirely — most carry no status line at all.
 *
 * Shared with that test by value, not by import, so the two can disagree: if one is raised
 * to grandfather a plan that should comply, the other still fails on it.
 */
const FIRST_IN_SCOPE = 78

const COMPLETED_DIR = path.resolve(import.meta.dirname, '../../plans/completed')

interface CompletedPlan {
  readonly number: number
  readonly name: string
  readonly status: string | undefined
  readonly saysDone: boolean
}

function completedPlans(): CompletedPlan[] {
  return fs
    .readdirSync(COMPLETED_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /^\d{4}-.*\.md$/.test(e.name))
    .map((e) => {
      const text = fs.readFileSync(path.join(COMPLETED_DIR, e.name), 'utf-8')
      const status = /^\*\*Status:\*\*.*$/m.exec(text)?.[0]
      return {
        number: Number(e.name.slice(0, 4)),
        name: e.name,
        status,
        // `Superseded` counts: a plan replaced by another is finished too, and saying so is
        // the honest record. What must not appear is a plan in this folder still claiming
        // to be open or unstarted.
        saysDone: status !== undefined && /\b(DONE|Superseded)\b/i.test(status),
      }
    })
}

describe('a plan in plans/completed/ says it is done', () => {
  const plans = completedPlans()
  const inScope = plans.filter((p) => p.number >= FIRST_IN_SCOPE)
  const grandfathered = plans.filter((p) => p.number < FIRST_IN_SCOPE)

  it('VACUITY: the walk finds plans, and both sides of the boundary are populated', () => {
    // Every row below filters, so an empty walk makes them all trivially true — the false
    // green this library is named after. And an empty side leaves the boundary untested.
    expect(plans.length).toBeGreaterThan(50)
    expect(inScope.length).toBeGreaterThan(5)
    expect(grandfathered.length).toBeGreaterThan(5)
  })

  it('names the plans whose header contradicts their folder, not how many', () => {
    // By identity (ADR-008 rule 4): a count tells a reader a number to reduce; a list tells
    // them which file to open. The status text is included because "0099 is wrong" is less
    // useful than seeing that it says "Open, not started" while sitting in completed/.
    const contradicting = inScope
      .filter((p) => !p.saysDone)
      .map((p) => `${p.name} — ${p.status ?? '(no **Status:** line)'}`)
    expect(contradicting).toEqual([])
  })

  it('the boundary is doing work — plans below it really do fail this check', () => {
    // The escape hatch, guarded (rule 3). Without this row, `FIRST_IN_SCOPE = 9999` passes
    // the row above while enforcing nothing. Measured: plans below 78 include ones with no
    // status line at all and ones reading "Not Started" or "Complete (implemented on
    // branch …)", none of which match the required wording.
    expect(grandfathered.filter((p) => !p.saysDone).length).toBeGreaterThan(0)
  })

  it('the boundary is not set beyond the newest completed plan', () => {
    // The other way to neuter it: park the constant past the highest number so `inScope` is
    // empty. The vacuity row catches that today; this states the invariant so the reason
    // outlives the row.
    expect(FIRST_IN_SCOPE).toBeLessThanOrEqual(Math.max(...plans.map((p) => p.number)))
  })
})
