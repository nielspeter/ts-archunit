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
import { diagnose } from '../../src/core/diagnose.js'
import * as publicApi from '../../src/index.js'
import { crossLayer } from '../../src/builders/cross-layer-builder.js'
import {
  haveConsistentExports,
  haveMatchingCounterpart,
  satisfyPairCondition,
} from '../../src/conditions/cross-layer.js'
import type { PairCondition } from '../../src/core/pair-condition.js'
import type { ArchViolation } from '../../src/core/violation.js'

const loadCrossLayer = (): ReturnType<typeof project> =>
  project(path.resolve(import.meta.dirname, '../fixtures/cross-layer/tsconfig.json'))

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

  it('graphql CONTROL: a live glob is not reported as a DEAD one', () => {
    // This control exists so that "always report" cannot pass the row above it,
    // and plan 0099 nearly destroyed it: the fixture has no resolvers, so the
    // floor now reports a zero-subjects finding and a naive rewrite to
    // `toHaveLength(1)` would make the dead-glob row and this row produce the
    // same count — the control stops discriminating at exactly the moment it is
    // needed.
    //
    // So it discriminates by CAUSE instead of by count: whatever is reported here
    // must not be the discovery diagnosis, because the glob is live.
    const found = resolvers(dupProject(), '**/duplicate-bodies/**')
      .should()
      .notContain(call(/^eval$/))
      .violations()
    const config = found.filter((v) => v.bypassFilters === true)
    for (const v of config) {
      expect(v.message).not.toContain('discovery glob')
      expect(v.message).not.toContain('can never match')
    }
  })

  it('a dead FINAL layer is reported, by all three conditions alike', () => {
    // Bug 0040's "missing case", which it rates **worse** than the silence — and
    // which plan 0080's write-up implied had shipped fixed. It had not.
    //
    // `haveMatchingCounterpart`'s empty check lived inside a loop over
    // `layers[i]` for `i < length - 1`, so the last layer was never examined.
    // Measured on a dead final layer: **0** configuration findings and **2**
    // ordinary ones reading "has no matching counterpart in layer ghost". An
    // agent obeying that writes files into a layer whose glob is wrong, they
    // still do not match, and it improvises — bug 0017's shape. Its two siblings
    // already checked every layer, so the three disagreed about one input.
    const project = () => loadCrossLayer()
    const deadFinal = (condition: PairCondition): ArchViolation[] =>
      crossLayer(project())
        .layer('routes', '**/src/routes/**')
        .layer('ghost', '**/src/nowhere-at-all/**')
        .mapping(() => true)
        .forEachPair()
        .should(condition)
        .violations()

    for (const [name, condition] of [
      ['haveMatchingCounterpart', haveMatchingCounterpart()],
      [
        'haveConsistentExports',
        haveConsistentExports(
          () => ['X'],
          () => [],
        ),
      ],
      ['satisfyPairCondition', satisfyPairCondition('never reached', () => null)],
    ] as const) {
      const found = deadFinal(condition)
      const config = found.filter((v) => v.bypassFilters === true)
      expect(
        config.map((v) => v.element),
        `${name} on a dead FINAL layer`,
      ).toEqual(['ghost'])
      // …and NOT the confidently wrong "no matching counterpart" advice.
      expect(found.some((v) => v.message.includes('no matching counterpart'))).toBe(false)
    }
  })

  it('CONTROL: every layer live — none of the three reports a configuration finding', () => {
    // Without this, "always report an empty layer" passes the row above.
    for (const condition of [
      haveMatchingCounterpart(),
      haveConsistentExports(
        (f) => [f.getBaseName()],
        (f) => [f.getBaseName()],
      ),
      satisfyPairCondition('always satisfied', () => null),
    ]) {
      const found = crossLayer(loadCrossLayer())
        .layer('routes', '**/src/routes/**')
        .layer('schemas', '**/src/schemas/**')
        .mapping(() => true)
        .forEachPair()
        .should(condition)
        .violations()
      expect(found.filter((v) => v.bypassFilters === true)).toEqual([])
    }
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

describe('doctor and the build agree about a dead DISCOVERY glob (review M3)', () => {
  // The independent derivation for this defect IS the two consumers agreeing —
  // `diagnose()` said a dead discovery glob was a fault and the gate said it was
  // not, and that disagreement is the whole bug. `dead-selector-fails.test.ts`
  // pins the agreement for a dead **selector**: the position that never diverged.
  //
  // So the guard asserted parity for the case that was already fine and left the
  // case that was broken to a single-surface test each. Review caught it. This is
  // the same shape as the parity test that claimed an invariant it did not check
  // for two releases (bug 0048), which is why it is worth a row rather than a note.
  it('a dead .layer() glob is a fault in diagnose() AND at check time', () => {
    const rule = crossLayer(loadCrossLayer())
      .layer('live', '**/src/schemas/**')
      .layer('ghost', '**/src/nowhere-at-all/**')
      .mapping(() => true)
      .forEachPair()
      .should(haveMatchingCounterpart())

    // Both surfaces, one input, and both must object.
    expect(diagnose([rule]).map((f) => f.kind)).toEqual(['dead-glob'])

    const found = rule.violations()
    expect(found.filter((v) => v.bypassFilters === true)).toHaveLength(1)
    // And it names the dead layer rather than the files in the live one — the
    // final-layer defect fixed in v0.45.1, pinned here by identity not count.
    expect(found.map((v) => v.element)).toEqual(['ghost'])
  })

  it('a dead smells discovery glob is a fault in diagnose() AND at check time', () => {
    // A second entry point, because the gate and `diagnose()` reach discovery
    // globs by different routes and one builder agreeing proves one builder.
    const rule = smells
      .duplicateBodies(dupProject())
      .minLines(3)
      .withMinSimilarity(0.8)
      .inFolder('**/no-such-folder/**')

    expect(diagnose([rule]).map((f) => f.kind)).toEqual(['dead-glob'])
    expect(rule.violations().filter((v) => v.bypassFilters === true)).toHaveLength(1)
  })
})

describe('a condition declares discovery ownership, not its builder (plan 0081)', () => {
  // The granularity that let bug 0040's final-layer half hide: `PairFinalBuilder`
  // returned a blanket `true` while its docstring asserted a fact about three
  // implementations, and that fact was false for one of them. The gate stood down
  // for the case its declared owner did not handle, so the reader got silence.

  /** A pair condition that does NOT tag itself — an external one, or a future one. */
  const untagged: PairCondition = {
    description: 'be untagged, and therefore covered by the gate',
    evaluate: () => [],
  }

  it('DEFAULT: an untagged condition is covered by the gate, not exempted', () => {
    // The load-bearing row. If this ever flips to exempt, a condition that forgets
    // to diagnose an empty layer produces silence — which is what plan 0081 exists
    // to make impossible, and what the blanket `true` did.
    const rule = crossLayer(loadCrossLayer())
      .layer('live', '**/src/schemas/**')
      .layer('ghost', '**/src/nowhere-at-all/**')
      .mapping(() => true)
      .forEachPair()
      .should(untagged)

    const found = rule.violations()
    const config = found.filter((v) => v.bypassFilters === true)
    expect(config).toHaveLength(1)
    // The GATE's message, generic — recoverable, which is the point. It names the
    // glob rather than the layer, and that is the cost of not tagging.
    expect(config[0]?.message).toContain('can never match anything')
  })

  it('VACUITY: that fixture really does resolve a dead layer', () => {
    // Without this, the row above and the row below both pass over a project where
    // nothing is empty and neither the gate nor the condition would fire.
    const layers = crossLayer(loadCrossLayer())
      .layer('live', '**/src/schemas/**')
      .layer('ghost', '**/src/nowhere-at-all/**')
      .mapping(() => true)
      .forEachPair()
      .should(haveMatchingCounterpart())
      .violations()
    expect(layers.filter((v) => v.bypassFilters === true).map((v) => v.element)).toEqual(['ghost'])
  })

  it.each([
    ['haveMatchingCounterpart', haveMatchingCounterpart()],
    [
      'haveConsistentExports',
      haveConsistentExports(
        () => [],
        () => [],
      ),
    ],
    ['satisfyPairCondition', satisfyPairCondition('a custom pair assertion', () => null)],
  ] as const)('%s owns it, so its layer-naming finding survives', (_name, condition) => {
    const found = crossLayer(loadCrossLayer())
      .layer('live', '**/src/schemas/**')
      .layer('ghost', '**/src/nowhere-at-all/**')
      .mapping(() => true)
      .forEachPair()
      .should(condition)
      .violations()

    const config = found.filter((v) => v.bypassFilters === true)
    // By IDENTITY: the layer name is the whole reason the gate stands down, so a
    // count would not distinguish this from the gate's generic finding.
    expect(config.map((v) => v.element)).toEqual(['ghost'])
    expect(config[0]?.message).not.toContain('can never match anything')
  })

  it('the ownership mark cannot be read off a shipped condition, or forged', () => {
    // The row this replaces asserted only that a symbol was absent from the public
    // namespace — true, and much narrower than its name. Review broke the design in
    // two lines: `Object.getOwnPropertySymbols(haveMatchingCounterpart())` returned
    // the tag, and copying it onto a condition that reports nothing produced **0**
    // configuration findings on a dead layer. A symbol keyed on a public object is
    // not private; it is merely unlisted.
    //
    // Ownership is now WeakSet membership, so there is no property to read and
    // nothing to copy. Both halves asserted: nothing leaks off the object, and a
    // hand-built condition carrying every own key of a real one still does not own
    // the diagnosis.
    const real = haveMatchingCounterpart()
    expect(Object.getOwnPropertySymbols(real)).toEqual([])

    const forged: PairCondition = {
      ...real,
      description: 'a copy of every own property a real condition exposes',
      evaluate: () => [],
    }
    const found = crossLayer(loadCrossLayer())
      .layer('live', '**/src/schemas/**')
      .layer('ghost', '**/src/nowhere-at-all/**')
      .mapping(() => true)
      .forEachPair()
      .should(forged)
      .violations()

    const config = found.filter((v) => v.bypassFilters === true)
    // The GATE speaks, because the forgery owns nothing.
    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('can never match anything')

    // VACUITY: the namespace import really is populated, or the emptiness above
    // proves nothing about exports.
    const exported: Record<string, unknown> = publicApi
    expect(Object.keys(exported)).toContain('crossLayer')
    expect(Object.keys(exported)).not.toContain('OWNS_EMPTY_DISCOVERY')
    expect(Object.keys(exported)).not.toContain('marksOwnEmptyDiscovery')
  })
})
