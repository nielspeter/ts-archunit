/**
 * How much evidence an allowlist condition actually had — bug 0015.
 *
 * The `only*` family constrains **edges**, not subjects. Each iterates a
 * subject's imports (or importers) and reports one violation per edge outside
 * the allowlist, so a subject with **zero edges has nothing to violate and
 * passes**, however broken the allowlist. Measured: one file with no imports,
 * `onlyImportFrom('**\/nowhere/**')` → 1 subject selected, 0 violations.
 *
 * The shape it fails on is the target case, not an edge case: in a layered
 * architecture the innermost layer is the one an allowlist protects and is
 * characteristically the layer with the fewest outbound imports.
 *
 * ## Why this reports rather than fails
 *
 * [Bug 0015](../../bugs/fixed/0015-allowlist-conditions-pass-vacuously-on-edgeless-subjects.md)
 * refuted failing, per-subject and per-rule, on measurement:
 *
 * - **Per-subject has no statable remedy.** 14 of this repo's `src/` files have
 *   zero static imports and 10 are pure leaf modules. `tarjan.ts` is a
 *   dependency-free algorithm — the ideal innermost-layer citizen — and would
 *   fail at error severity. The remedies available are: add an import (harmful),
 *   exclude a working rule, narrow the selector, or delete the rule. None
 *   improves anything, because **for the `only*` family zero edges is maximal
 *   compliance**, not absent evidence. That fails ADR-008 rule 2.
 * - **Per-rule multiplies.** Six boundaries and one dependency-free shared file
 *   make `strictBoundaries` emit 13 rules, **12** with subjects and zero edges.
 * - **`ignoreTypeImports` inverts it.** Counting edges after the filter means a
 *   layer whose only dependency is `import type` counts zero and fires on the
 *   best possible outcome — under the option the docs recommend for layers.
 *
 * So the remedy is genuinely optional and the reader must judge it, which under
 * ADR-008 rule 1 is a disclosure, not a failure. This module is the disclosure.
 *
 * ## Why module state rather than a field on `ConditionContext`
 *
 * `ConditionContext` is a **public exported type** backing the documented
 * `defineCondition()`, and bug 0015 records that extending `Condition<T>` for
 * this was one reason the failing design could not ship. `diff-disclosure.ts`
 * established the pattern for a run-scoped notice that conditions produce and
 * the CLI consumes; this follows it, including the test reset.
 */

/**
 * Why a rule tested no edges. The three are not interchangeable, and saying the
 * wrong one is an ADR-008 rule 2 defect — a stated cause that is wrong for the
 * input.
 *
 * The first version of this module printed "correct for a genuinely
 * dependency-free module" for all three. Measured, that is false for two of
 * them: a subject whose imports were filtered by `ignoreTypeImports` **has**
 * dependencies, and a reader who opens the folder finds them and concludes the
 * tool is broken; and a rule whose allowlist matched no import is pointing at
 * the interesting case — the glob may be a typo — which that sentence hides.
 */
export type UntestedReason =
  /** The subjects have no edges of any kind. Usually correct, and the layered case. */
  | 'no-edges'
  /** Edges existed, and every one was filtered out before the check saw it. */
  | 'all-filtered'
  /** Edges existed, and none of them matched the allowlist glob. */
  | 'none-matched'

/** One rule's evidence: how many subjects it saw and how many edges it tested. */
export interface EdgeCoverage {
  readonly rule: string
  readonly subjects: number
  readonly edges: number
  readonly reason: UntestedReason
}

const coverage = new Map<string, EdgeCoverage>()

/**
 * Record what a condition had to work with.
 *
 * Keyed on the rule description, and **accumulated** rather than overwritten:
 * one rule can evaluate its condition more than once (a `.check()` after a
 * `.violations()`, or the same description in two files), and taking the last
 * write would report the smaller run.
 */
export function recordEdgeCoverage(
  rule: string,
  subjects: number,
  edges: number,
  reason: UntestedReason = 'no-edges',
): void {
  const prior = coverage.get(rule)
  // The MINIMUM edge count, not the maximum. Two evaluations of the same rule
  // description — the same preset over two projects, or the same chain written
  // twice — merge on this key, and taking the max let a run that tested edges
  // erase a run that tested none. Measured: the vacuous run vanished from the
  // report. For a disclosure OF vacuity the conservative direction is to keep
  // the smaller evidence; over-disclosing costs a footnote, under-disclosing is
  // the silent pass this module exists to surface.
  coverage.set(rule, {
    rule,
    subjects: Math.max(prior?.subjects ?? 0, subjects),
    edges: prior === undefined ? edges : Math.min(prior.edges, edges),
    reason: prior !== undefined && prior.edges <= edges ? prior.reason : reason,
  })
}

/**
 * Rules that had subjects and tested no edges — the vacuous passes.
 *
 * A rule with **no subjects** is deliberately excluded: that is an empty
 * selector, which is `.expectNonEmpty()`'s business and plan 0067's, and
 * reporting it here would give one fault two owners.
 */
export function untestedRules(): readonly EdgeCoverage[] {
  return [...coverage.values()].filter((c) => c.subjects > 0 && c.edges === 0)
}

/**
 * The disclosure, or `undefined` when every allowlist was exercised.
 *
 * Names the rules rather than counting them (ADR-008 rule 4): "3 rules tested
 * nothing" sends the reader to grep, and the whole point is that they must
 * judge whether an edge-free population is correct here.
 */
export function edgeCoverageNotice(): string | undefined {
  const untested = untestedRules()
  if (untested.length === 0) return undefined

  const because: Record<UntestedReason, string> = {
    'no-edges':
      'those subjects have no imports at all, which is correct for a dependency-free module and ' +
      'means the rule certified nothing otherwise',
    'all-filtered':
      'those subjects DO have imports — every one was excluded by `ignoreTypeImports` before the ' +
      'check saw it, so the allowlist was never consulted',
    'none-matched':
      'those subjects have imports, and none matched the allowlist glob — so either nothing is ' +
      'in scope by design, or the glob is wrong',
  }
  const lines = untested.map(
    (c) =>
      `  - ${c.rule}\n    ${String(c.subjects)} subject${c.subjects === 1 ? '' : 's'}, 0 edges tested — ${because[c.reason]}.`,
  )
  const count = untested.length
  return (
    `[ts-archunit] ${String(count)} allowlist rule${count === 1 ? '' : 's'} passed without ` +
    `testing a single edge:\n${lines.join('\n')}\n` +
    `  An allowlist constrains edges, so a subject with none cannot violate it. Only you can ` +
    `tell an intended shape from a rule that certified nothing.`
  )
}

/** Drop the tally. The CLI resets per run; tests reset per case. */
export function resetEdgeCoverage(): void {
  coverage.clear()
}
