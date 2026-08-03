/**
 * A dead **discovery** glob fails, wherever it is written —
 * [plan 0080](../../plans/completed/0080-admit-discovery-globs-to-the-dead-glob-gate.md).
 *
 * `deadSelectorFindings` skipped every position but `selector`, on the stated
 * premise that *"discovery already fails"*. That premise was **false**, and the
 * two hand-maintained position lists disagreed about exactly this: `diagnose()`
 * treated `discovery` as a fault, so `doctor` reported a dead layer glob while
 * the check that gates the build did not. `isFaultPosition` is now the one owner.
 *
 * ## The ownership question, and why it is declared
 *
 * The gate short-circuits before `collectViolations()`, so admitting discovery
 * globs makes it **replace** a builder's own finding rather than add to one. Two
 * builders already say something better and therefore declare
 * `ownsDiscoveryDiagnosis()`:
 *
 * | builder | why it owns the message |
 * | --- | --- |
 * | `SliceRuleBuilder` | its discovery is **not per-tree** — one empty slice among populated ones is legitimate, a guard withdrawn before release for firing on real projects |
 * | `PairFinalBuilder` | all three cross-layer conditions name the empty *layer*, with a remedy corrected three times to point at `.layer()` (bug 0042) |
 *
 * Declared by the builder, never listed in the gate. A list of exceptions is an
 * unchecked claim about who owns what — which is the comment this plan was filed
 * to correct.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { project } from '../../src/core/project.js'
import { smells } from '../../src/smells/index.js'
import { resolvers } from '../../src/graphql/index.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { call } from '../../src/helpers/matchers.js'
import { isFaultPosition } from '../../src/core/glob-site.js'

const dupProject = (): ReturnType<typeof project> =>
  project(path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies/tsconfig.json'))
const sliceProject = (): ReturnType<typeof project> =>
  project(path.resolve(import.meta.dirname, '../fixtures/slices/tsconfig.json'))

describe('isFaultPosition is the one owner of the decision', () => {
  it('selector and discovery are faults; condition and exclusion are not', () => {
    // The two sites used inverse hand-maintained lists and disagreed about
    // `discovery` — `diagnose()` included it, the gate did not. That divergence
    // IS bug 0040's silence half.
    expect(isFaultPosition('selector')).toBe(true)
    expect(isFaultPosition('discovery')).toBe(true)
    // A condition glob matching nothing is a satisfied rule (bug 0014), and an
    // unused exclusion is reported on its own terms by `.excluding()`.
    expect(isFaultPosition('condition')).toBe(false)
    expect(isFaultPosition('exclusion')).toBe(false)
  })
})

describe('a dead discovery glob fails at every entry point (plan 0080)', () => {
  it('smells: a dead inFolder glob is a configuration finding', () => {
    const found = smells
      .duplicateBodies(dupProject())
      .minLines(3)
      .withMinSimilarity(0.8)
      .inFolder('**/no-such-folder/**')
      .violations()
    const config = found.filter((v) => v.bypassFilters === true)
    expect(config).toHaveLength(1)
    // Position-aware in BOTH clauses. Fixing only the noun would ship a
    // grammatical sentence that still says "it has no subjects".
    expect(config[0]?.message).toContain('discovery glob')
    expect(config[0]?.message).toContain('discovers nothing to check')
    expect(config[0]?.message).not.toContain("rule's selector")
  })

  it('smells CONTROL: a live inFolder glob produces no configuration finding', () => {
    // Without this, "always report" passes the row above — and the detector's
    // real findings would be replaced by a false one on every run.
    const found = smells
      .duplicateBodies(dupProject())
      .minLines(3)
      .withMinSimilarity(0.8)
      .inFolder('**/duplicate-bodies/**')
      .violations()
    expect(found.filter((v) => v.bypassFilters === true)).toEqual([])
    expect(found.length).toBeGreaterThan(0)
  })

  it('graphql resolvers: a dead discovery glob went from 0 findings to 1', () => {
    const found = resolvers(dupProject(), '**/no-such-resolvers/**')
      .should()
      .notContain(call(/^eval$/))
      .violations()
    const config = found.filter((v) => v.bypassFilters === true)
    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('discovery glob')
  })

  it('graphql CONTROL: a live glob is silent', () => {
    const found = resolvers(dupProject(), '**/duplicate-bodies/**')
      .should()
      .notContain(call(/^eval$/))
      .violations()
    expect(found.filter((v) => v.bypassFilters === true)).toEqual([])
  })

  it('slice OWNS its discovery, so the gate stays out — all-empty', () => {
    // Slice's message names the discovery mode and its remedy (bug 0009's
    // corpus), which the gate's generic sentence cannot match. If the gate ever
    // preempts it, 13 tests of that corpus die — measured.
    const [finding] = slices(sliceProject())
      .matching('**/nowhere-at-all/**')
      .should()
      .beFreeOfCycles()
      .violations()
    expect(finding?.bypassFilters).toBe(true)
    expect(finding?.message).not.toContain('discovery glob')
  })

  it('slice OWNS its discovery — one empty entry among populated ones still passes', () => {
    // Critical 3. `assignedFrom` fans out one tree per entry, so a single dead
    // entry is a dead *tree* that the gate would report — and that guard was
    // written and **withdrawn before release** for firing on legitimate projects:
    // a layer not created yet, and the `strict-boundaries` scaffold itself.
    const found = slices(sliceProject())
      .assignedFrom({ real: '**/src/**', ghost: '**/does-not-exist/**' })
      .should()
      .beFreeOfCycles()
      .violations()
    expect(found.some((v) => v.bypassFilters === true)).toBe(false)
  })
})
