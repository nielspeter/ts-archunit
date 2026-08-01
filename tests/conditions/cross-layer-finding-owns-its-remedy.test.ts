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
import { haveMatchingCounterpart } from '../../src/conditions/cross-layer.js'
import type { Layer, LayerPair } from '../../src/models/cross-layer.js'
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
 * `haveMatchingCounterpart` takes the resolved layers as an argument rather than
 * reading them from the builder — a defect in its own right, filed as the
 * "adjacent defect" section of
 * [bug 0040](../../bugs/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md).
 * Here it is convenient: it lets the fixture state the empty layer directly.
 *
 * Passing `[]` would NOT work — the condition opens with
 * `if (layers.length < 2) return []`, so an empty array switches it off and every
 * assertion below would pass over nothing. That is the vacuous measurement bug
 * 0040 was originally filed on.
 */
function layers(project: ArchProject, ghostIsEmpty: boolean): Layer[] {
  const files = project.getSourceFiles().filter((f) => f.getFilePath().includes('/src/schemas/'))
  const left = project.getSourceFiles().filter((f) => f.getFilePath().includes('/src/routes/'))
  return [
    { name: 'ghost', pattern: '**/src/routes/**', files: ghostIsEmpty ? [] : left },
    { name: 'schemas', pattern: '**/src/schemas/**', files },
  ]
}

/** A rule whose left layer resolves nothing — the configuration finding. */
function emptyLeftLayer(meta?: RuleMetadata): ArchViolation[] {
  const project = load()
  const builder = crossLayer(project)
    .layer('ghost', '**/src/routes/**')
    .layer('schemas', '**/src/schemas/**')
    .mapping(() => true)
    .forEachPair()
    .should(haveMatchingCounterpart(layers(project, true)))
  return (meta ? builder.rule(meta) : builder).violations()
}

/** Both layers resolve and nothing pairs — so every finding is a real violation. */
function bothLayersResolve(meta: RuleMetadata): ArchViolation[] {
  const project = load()
  return crossLayer(project)
    .layer('ghost', '**/src/routes/**')
    .layer('schemas', '**/src/schemas/**')
    .mapping(() => false)
    .forEachPair()
    .should(haveMatchingCounterpart(layers(project, false)))
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

  it('the remedy remediates the clause it states, and states no clause it cannot', () => {
    // Rule 2's behavioural corollary, on the text this fix exists to correct.
    // The FIRST version of this remedy said "or remove the layer from the chain",
    // which throws `RangeError` on a two-layer chain — the only shape that can
    // produce the finding. Bug 0017 by juxtaposition, in the fix for bug 0017.
    const two = emptyLeftLayer().filter((v) => v.bypassFilters === true)
    expect(two.length).toBeGreaterThan(0)
    for (const f of two) {
      expect(f.suggestion).toContain('Dropping the layer is not available here')
      // Names the array to edit, not just "the glob" — see the control below.
      expect(f.suggestion).toContain('Layer[] passed to this condition')
      expect(f.suggestion).not.toContain('Or drop the layer')
      // It names the glob, so "fix the glob" says WHICH glob.
      expect(f.suggestion).toContain('**/src/routes/**')
      // Rule 3: it says there is no escape hatch.
      expect(f.suggestion).toContain('cannot be suppressed')
    }

    // CONTROL — the caveat is load-bearing, so it is pinned. Widening the
    // BUILDER's glob, the obvious reading of "fix the glob", does NOT clear the
    // finding: this condition reads the caller's Layer[] and never sees the
    // builder's resolution. Measured. When bug 0040 makes the builder pass its
    // own layers, this row fails and forces the remedy text to be rewritten.
    const project = load()
    const schemas = project
      .getSourceFiles()
      .filter((f) => f.getFilePath().includes('/src/schemas/'))
    const builderWidened = crossLayer(project)
      .layer('ghost', '**/src/**')
      .layer('schemas', '**/src/schemas/**')
      .mapping(() => true)
      .forEachPair()
      .should(
        haveMatchingCounterpart([
          { name: 'ghost', pattern: '**/src/**', files: [] },
          { name: 'schemas', pattern: '**/src/schemas/**', files: schemas },
        ]),
      )
      .violations()
    expect(builderWidened.filter((v) => v.bypassFilters === true)).toHaveLength(1)

    // Applying the clause the remedy actually names clears it — measured, not read.
    const widened = crossLayer(load())
      .layer('ghost', '**/src/routes/**')
      .layer('schemas', '**/src/schemas/**')
      .mapping(() => true)
      .forEachPair()
      .should(haveMatchingCounterpart(layers(load(), false)))
      .violations()
    expect(widened.filter((v) => v.bypassFilters === true)).toHaveLength(0)
  })

  it('a three-layer chain offers the removal clause, because there it is true', () => {
    // The other half of the computed remedy. Drop one of three and two remain,
    // which `.mapping()` accepts — so here the clause is real and is offered.
    const project = load()
    const three = [
      ...layers(project, true),
      { name: 'sdk', pattern: '**/src/sdk/**', files: [] as never[] },
    ]
    const findings = crossLayer(project)
      .layer('ghost', '**/src/routes/**')
      .layer('schemas', '**/src/schemas/**')
      .layer('sdk', '**/src/sdk/**')
      .mapping(() => true)
      .forEachPair()
      .should(haveMatchingCounterpart(three))
      .violations()
      .filter((v) => v.bypassFilters === true)

    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0]?.suggestion).toContain('Or drop the layer: 2 would remain')
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
    const project = load()
    const ls = layers(project, false)
    const pairs: LayerPair[] = []
    const direct = haveMatchingCounterpart(ls).evaluate(pairs, {
      rule: 'r',
      ruleId: AUTHOR.id,
      because: AUTHOR.because,
      suggestion: AUTHOR.suggestion,
      docs: AUTHOR.docs,
    })
    const real = direct.filter((v) => v.bypassFilters !== true)
    expect(real.length).toBeGreaterThan(0)
    for (const f of real) {
      expect(f.suggestion).toBe(AUTHOR.suggestion)
      expect(f.docs).toBe(AUTHOR.docs)
    }
  })
})
