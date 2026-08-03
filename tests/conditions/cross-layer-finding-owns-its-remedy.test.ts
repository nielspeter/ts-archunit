/**
 * The empty-layer finding carries its own remedy, never the author's —
 * [bug 0042](../../bugs/fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md),
 * a live recurrence of [bug 0021](../../bugs/fixed/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md).
 *
 * `conditions/cross-layer.ts` reported an empty left layer correctly and then
 * copied `context.suggestion` / `context.docs` onto the finding. Two faults from
 * two lines: with author metadata it printed the author's fix for a *real*
 * violation under `Fix:` — measured, an empty-layer finding advising "Split the
 * cycle by extracting a shared module." — and with none it shipped bare, because
 * `ConditionContext.suggestion` is optional. It was the only configuration
 * finding of the twelve that could reach a reader with no remedy at all.
 *
 * ## Why `toBeTruthy()` is not the assertion
 *
 * `tests/core/config-findings-carry-their-own-remedy.test.ts` asserts
 * `expect(f.suggestion).toBeTruthy()` for the three producers it enumerates.
 * That check passes on the *first* fault above — the author's remedy is perfectly
 * truthy — so presence is not the property. The property is **two-directional**:
 * the finding must carry a remedy, and it must not be the author's. Bug 0021's
 * own test established that shape; this applies it to the producer 0021's fix
 * never reached, because this one assigned the fields rather than leaving them
 * for `execute-rule.ts` to withhold.
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'
import { crossLayer } from '../../src/builders/cross-layer-builder.js'
import {
  haveMatchingCounterpart,
  haveConsistentExports,
  satisfyPairCondition,
} from '../../src/conditions/cross-layer.js'
import type { SourceFile } from 'ts-morph'
import type { Layer, LayerPair } from '../../src/models/cross-layer.js'
import type { PairConditionContext } from '../../src/core/pair-condition.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { RuleMetadata } from '../../src/core/rule-metadata.js'

const tsConfigPath = path.resolve(import.meta.dirname, '../fixtures/cross-layer/tsconfig.json')

function load(): ArchProject {
  const p = new Project({ tsConfigFilePath: tsConfigPath })
  return { tsConfigPath, _project: p, getSourceFiles: () => p.getSourceFiles() }
}

/** Deliberately about the rule's subject matter, so it is wrong for a config finding. */
const AUTHOR: RuleMetadata = {
  id: 'arch/layers',
  because: 'every route needs a schema',
  suggestion: 'Split the cycle by extracting a shared module.',
  docs: 'https://example.test/authors-page',
}

/**
 * The empty layer now comes from a **dead builder glob**, because there is no
 * caller-supplied array left to rig — [bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)
 * made the builder pass its own resolved layers.
 *
 * That is why this file was rewritten rather than adjusted: every fixture used to
 * hand-build a `Layer[]` with an empty entry, and the whole point of 0040 is that
 * such an array is no longer consulted. A test that kept doing it would assert
 * over a value the library ignores.
 */
function emptyLeftLayer(meta?: RuleMetadata): ArchViolation[] {
  const builder = crossLayer(load())
    .layer('ghost', '**/src/nowhere-at-all/**')
    .layer('schemas', '**/src/schemas/**')
    .mapping(() => true)
    .forEachPair()
    .should(haveMatchingCounterpart())
  return (meta ? builder.rule(meta) : builder).violations()
}

/** A three-layer chain whose FIRST layer is dead, for the removal clause. */
function emptyLeftLayerOfThree(): ArchViolation[] {
  return crossLayer(load())
    .layer('ghost', '**/src/nowhere-at-all/**')
    .layer('schemas', '**/src/schemas/**')
    .layer('sdk', '**/src/sdk/**')
    .mapping(() => true)
    .forEachPair()
    .should(haveMatchingCounterpart())
    .violations()
}

/** Both layers resolve and nothing pairs — so every finding is a real violation. */
function bothLayersResolve(meta: RuleMetadata): ArchViolation[] {
  return crossLayer(load())
    .layer('routes', '**/src/routes/**')
    .layer('schemas', '**/src/schemas/**')
    .mapping(() => false)
    .forEachPair()
    .should(haveMatchingCounterpart())
    .rule(meta)
    .violations()
}

describe('an empty-layer finding carries its own remedy (bug 0042)', () => {
  it('VACUITY: the empty layer actually produces a configuration finding', () => {
    const findings = emptyLeftLayer().filter((v) => v.bypassFilters === true)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((v) => v.message.includes('matched 0 files'))).toBe(true)
  })

  it('with author metadata: its own remedy, never the author’s', () => {
    const findings = emptyLeftLayer(AUTHOR).filter((v) => v.bypassFilters === true)
    expect(findings.length).toBeGreaterThan(0)

    for (const f of findings) {
      // The direction that `toBeTruthy()` cannot see.
      expect(f.suggestion).not.toBe(AUTHOR.suggestion)
      // Asserted as a value, not as `not.toBe(AUTHOR.docs)` — `undefined` passes
      // that for free, which is exactly the trap this file's docstring names for
      // `suggestion`, one field over. There is deliberately no docs page for this
      // fault: `GLOB_DOCS` points at the slices page and would be a wrong link.
      expect(f.docs).toBeUndefined()
      // …and the remedy it does carry names the layer, so it is about THIS fault.
      expect(f.suggestion).toContain('ghost')
      // Kept deliberately: neither asserts a remedy.
      expect(f.ruleId).toBe(AUTHOR.id)
      expect(f.because).toBe(AUTHOR.because)
    }
  })

  it('with no author metadata: still carries a remedy', () => {
    // The second fault. `context.suggestion` is optional, so before the fix this
    // finding reached the reader with no `Fix:` line at all — and
    // `execute-rule.ts` deliberately refuses to backfill a `bypassFilters`
    // finding, so nothing downstream rescued it.
    const findings = emptyLeftLayer().filter((v) => v.bypassFilters === true)
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.suggestion, `${f.rule} has no remedy`).toBeTruthy()
      expect(f.suggestion).toContain('ghost')
    }
  })

  it('the remedy remediates: fixing the .layer() glob clears the finding', () => {
    // Rule 2's behavioural corollary, and the row that 0040 inverted. Before it,
    // widening the builder's glob did NOT clear this finding — the condition read
    // a caller-supplied array — and a control here asserted that, deliberately, so
    // that landing 0040 would break it. It did. This is its replacement.
    const before = emptyLeftLayer().filter((v) => v.bypassFilters === true)
    expect(before).toHaveLength(1)
    expect(before[0]?.suggestion).toContain('.layer("ghost"')

    const after = crossLayer(load())
      .layer('ghost', '**/src/routes/**') // the glob, corrected
      .layer('schemas', '**/src/schemas/**')
      .mapping(() => true)
      .forEachPair()
      .should(haveMatchingCounterpart())
      .violations()
    expect(after.filter((v) => v.bypassFilters === true)).toHaveLength(0)
  })

  it('the remedy names the .layer() call, not an array the caller cannot build', () => {
    // Promoted to its own `it()` on review: it used to sit at the end of the
    // block above, which died on an earlier assertion and never reached it. A
    // control that cannot execute is not a control.
    const findings = emptyLeftLayer().filter((v) => v.bypassFilters === true)
    expect(findings).toHaveLength(1)
    const suggestion = findings[0]?.suggestion ?? ''
    expect(suggestion).toContain('.layer("ghost", "**/src/nowhere-at-all/**")')
    expect(suggestion).not.toContain('Layer[] passed to this condition')
    expect(suggestion).toContain('Dropping the layer is not available here')
    expect(suggestion).toContain('cannot be suppressed')
  })

  it('a three-layer chain offers the removal clause, because there it is true', () => {
    // The other half of the computed remedy. Drop one of three and two remain,
    // which `.mapping()` accepts — so here the clause is real and is offered.
    const findings = emptyLeftLayerOfThree().filter((v) => v.bypassFilters === true)

    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]?.suggestion).toContain('Or drop the layer: 2 would remain')
  })

  it('a context with too FEW layers does not win — it would pass vacuously', () => {
    // Found by probing the precedence after v0.42.0 shipped, not by review.
    //
    // The first threshold was `context.layers.length > 0`, so a context carrying
    // ONE layer beat a usable two-layer argument — and the condition then
    // returned `[]` at its own `layers.length < 2` guard. A silent vacuous pass,
    // measured: context 1 + argument 2 → **0 findings**.
    //
    // Now `>= 2`. Safe for every builder path because the builder cannot produce
    // fewer than two — `.mapping()` throws below that — so this cannot restore
    // the defect bug 0040 fixed (the argument beating a real resolution).
    const usable: Layer[] = [
      { name: 'ghost', pattern: '**/nowhere/**', files: [] },
      { name: 'schemas', pattern: '**/schemas/**', files: [] },
    ]
    const single: Layer[] = [{ name: 'solo', pattern: '**/solo/**', files: [] }]

    const out = haveMatchingCounterpart(usable).evaluate([], { rule: 'r', layers: single })
    // TWO findings: this fixture's `usable` array has both layers empty, and
    // every layer is now checked — including the final one, which used to be
    // skipped (bug 0040's missing case). The fixture was sloppy and the old
    // behaviour hid it; the assertion is on the identities, not the count alone.
    expect(out.map((v) => v.element).sort()).toEqual(['ghost', 'schemas'])
  })

  it('CONTROL: a USABLE context still wins over the argument', () => {
    // The threshold must not have re-opened bug 0040. Two layers in the context
    // beat two in the argument, and the context's names are the ones reported.
    const fromContext: Layer[] = [
      { name: 'ctx-left', pattern: '**/a/**', files: [] },
      { name: 'ctx-right', pattern: '**/b/**', files: [] },
    ]
    const fromArgument: Layer[] = [
      { name: 'arg-left', pattern: '**/c/**', files: [] },
      { name: 'arg-right', pattern: '**/d/**', files: [] },
    ]
    const out = haveMatchingCounterpart(fromArgument).evaluate([], {
      rule: 'r',
      layers: fromContext,
    })
    expect(out[0]?.element).toBe('ctx-left')
  })

  it('the context wins over an explicit argument, and that is the silent change', () => {
    // Bug 0040's one behavioural change to an existing caller, pinned because it
    // is silent: someone who deliberately passed a NARROWER `Layer[]` now gets
    // the builder's instead. That is the fix — the hand-built copy was the defect
    // — but nothing else would notice if the precedence flipped back.
    const project = load()
    const schemas = project
      .getSourceFiles()
      .filter((f) => f.getFilePath().includes('/src/schemas/'))
    // An explicit array claiming BOTH layers are populated…
    const explicit = [
      { name: 'ghost', pattern: '**/src/nowhere-at-all/**', files: schemas },
      { name: 'schemas', pattern: '**/src/schemas/**', files: schemas },
    ]
    // …while the builder's own `ghost` glob resolves nothing.
    const findings = crossLayer(project)
      .layer('ghost', '**/src/nowhere-at-all/**')
      .layer('schemas', '**/src/schemas/**')
      .mapping(() => true)
      .forEachPair()
      .should(haveMatchingCounterpart(explicit))
      .violations()

    // The builder's truth wins: the layer is empty and it is reported.
    expect(findings.filter((v) => v.bypassFilters === true).map((v) => v.element)).toEqual([
      'ghost',
    ])
  })

  it('the rule description names the layers in declaration order — a baseline identity', () => {
    // Filed against my own judgement. A sabotage row reversing `layerNames`
    // (`cross-layer-builder.ts:214`) came back green and I discarded it as
    // cosmetic, on the grounds that the string is only a description.
    //
    // It is not cosmetic. `context.rule` becomes the violation's `rule`, and
    // `hashViolation` composes the baseline identity as
    // `sha256(rule + '::' + subject)` (`baseline.ts:174`). So the layer order in
    // this sentence is part of every cross-layer finding's baseline hash:
    // reversing it silently invalidates every baselined cross-layer entry, with
    // no message change a reader would notice.
    //
    // Nothing asserted it — `grep 'cross-layer \['` over `tests/` found no hits.
    const findings = emptyLeftLayer().filter((v) => v.bypassFilters === true)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.rule).toBe(
      'cross-layer [ghost, schemas] should have a matching counterpart in the paired layer',
    )
  })

  it('CONTROL: order is asserted, not merely membership', () => {
    // Without this, the row above passes on a reversed description as long as
    // both names appear. A three-layer chain makes the ordering observable.
    const findings = emptyLeftLayerOfThree().filter((v) => v.bypassFilters === true)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]?.rule).toContain('[ghost, schemas, sdk]')
    expect(findings[0]?.rule).not.toContain('[sdk, schemas, ghost]')
  })

  it('CONTROL: a real violation of the same rule still inherits all four', () => {
    // Without this, "strip the author's fields everywhere" passes the rows above
    // while breaking the feature `.rule({ suggestion })` exists for.
    const findings = bothLayersResolve(AUTHOR)
    expect(findings.length).toBeGreaterThan(0)

    for (const f of findings) {
      expect(f.bypassFilters).toBeFalsy()
      expect(f.suggestion).toBe(AUTHOR.suggestion)
      expect(f.docs).toBe(AUTHOR.docs)
      expect(f.because).toBe(AUTHOR.because)
      expect(f.ruleId).toBe(AUTHOR.id)
    }
  })

  it('the PRODUCER passes the author fields through, not just the pipeline', () => {
    // Sabotage row C6: deleting `suggestion: context.suggestion` / `docs:` from
    // the real-violation branch at `cross-layer.ts:121-122` left the whole suite
    // green, because `applyFilters` backfills both for a non-`bypassFilters`
    // violation. The CONTROL above therefore tested the pipeline, not this file —
    // in the file whose subject is producer-side discipline. Call the condition
    // directly so nothing can backfill.
    // Layers arrive through the CONTEXT now, which is the interface a builder
    // uses — so calling the condition directly still exercises the real path
    // rather than the argument 0040 deprecated.
    const project = load()
    const routes = project.getSourceFiles().filter((f) => f.getFilePath().includes('/src/routes/'))
    const schemas = project
      .getSourceFiles()
      .filter((f) => f.getFilePath().includes('/src/schemas/'))
    const pairs: LayerPair[] = []
    const direct = haveMatchingCounterpart().evaluate(pairs, {
      rule: 'r',
      ruleId: AUTHOR.id,
      because: AUTHOR.because,
      suggestion: AUTHOR.suggestion,
      docs: AUTHOR.docs,
      layers: [
        { name: 'routes', pattern: '**/src/routes/**', files: routes },
        { name: 'schemas', pattern: '**/src/schemas/**', files: schemas },
      ],
    })
    const real = direct.filter((v) => v.bypassFilters !== true)
    expect(real.length).toBeGreaterThan(0)
    for (const f of real) {
      expect(f.suggestion).toBe(AUTHOR.suggestion)
      expect(f.docs).toBe(AUTHOR.docs)
    }
  })
})

describe('a layer set too small to judge is reported, not passed (review M1)', () => {
  // All three conditions used to `return []` here — silently. That is the exact
  // false green this library exists to remove, inside the library.
  //
  // Reachable only by calling `evaluate()` directly, which is a **public** path:
  // `PairCondition` is an exported interface and all three conditions are exported.
  // Same reachability as the defect fixed in v0.43.1, which was also fixed.
  //
  // Review found it as a DIVERGENCE, not as a hole: with an empty `context.layers`
  // and a two-layer argument, `haveMatchingCounterpart` reported 2 findings and its
  // siblings reported 0. Chasing why the numbers differed found that all three were
  // wrong in the same direction on a neighbouring input.
  const ctx = (layers: Layer[]): PairConditionContext => ({
    rule: 'crossLayer [a -> b]',
    layers,
    ...AUTHOR,
  })
  // Real `SourceFile`s: `Layer.files` is `SourceFile[]`, and the conditions call
  // `getFilePath()` on them. A string double type-errors, and casting one would
  // breach ADR-005.
  const realFiles = (): SourceFile[] => load().getSourceFiles().slice(0, 2)
  const oneLayer: Layer[] = [{ name: 'only', pattern: '**/a/**', files: [] }]

  const conditions = [
    ['haveMatchingCounterpart', haveMatchingCounterpart()],
    [
      'haveConsistentExports',
      haveConsistentExports(
        () => [],
        () => [],
      ),
    ],
    ['satisfyPairCondition', satisfyPairCondition('a custom pair assertion', () => null)],
  ] as const

  it.each(conditions)('%s reports a finding rather than nothing', (_name, condition) => {
    const findings = condition.evaluate([], ctx(oneLayer))

    expect(findings).toHaveLength(1)
    const finding = findings[0]
    if (finding === undefined) throw new Error('expected a finding')
    expect(finding.bypassFilters).toBe(true)
    expect(finding.message).toContain('it needs two')
    // Its OWN remedy, never the author's (bug 0021/0042).
    expect(finding.suggestion).not.toBe(AUTHOR.suggestion)
    expect(finding.suggestion).toContain('at least two layers')
    expect(finding.docs).toBeUndefined()
  })

  it.each(conditions)('%s: APPLYING the remedy clears the finding', (_name, condition) => {
    // Rule 2's behavioural corollary. The remedy says to supply a `layers` holding
    // every layer the pairs were drawn from, so do that and assert it clears —
    // reading the sentence is not evidence that following it works.
    const files = realFiles()
    const left = files[0]
    const right = files[1]
    if (left === undefined || right === undefined) throw new Error('fixture has < 2 files')
    const two: Layer[] = [
      { name: 'left', pattern: '**/a/**', files: [left] },
      { name: 'right', pattern: '**/b/**', files: [right] },
    ]
    const after = condition.evaluate([], ctx(two))

    expect(after.filter((v) => v.message.includes('it needs two'))).toEqual([])
  })

  it('the finding is not reachable through the DSL, which is why it is not a user-facing break', () => {
    // `.mapping()` throws below two layers, so no builder path can produce this.
    // Asserted rather than asserted-in-prose: if the builder ever stops throwing,
    // this finding becomes reachable and someone must decide whether that is right.
    expect(() =>
      crossLayer(load())
        .layer('only', '**/src/schemas/**')
        .mapping(() => true),
    ).toThrow(RangeError)
  })
})
