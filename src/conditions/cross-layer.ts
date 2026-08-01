import type { SourceFile } from 'ts-morph'
import type { PairCondition } from '../core/pair-condition.js'
import type { ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { LayerPair, Layer } from '../models/cross-layer.js'
import { setCorrespondence } from '../core/correspondence-core.js'
import { UNSUPPRESSABLE } from '../core/unsuppressable.js'

/**
 * Every element in the left layer must have at least one match in the right layer.
 *
 * Produces a violation for each left-layer file that has no matching pair.
 * "Match" is determined by the mapping function provided via `.mapping()`.
 *
 * This is an existence/coverage check, so it shares the set-difference +
 * non-vacuity core (`setCorrespondence`, F2) with `correspondence()` — the two
 * "every X has a matching Y" engines cannot drift, and neither can silently
 * green on an empty side: a left layer that matched **zero** files is a
 * mis-globbed layer that enforces nothing, so it now fails (ADR-008) rather
 * than passing vacuously.
 *
 * @param layers - The resolved layers, needed to identify unmatched left files
 */
export function haveMatchingCounterpart(layers: Layer[]): PairCondition {
  return {
    description: 'have a matching counterpart in the paired layer',
    evaluate(pairs: LayerPair[], context: ConditionContext): ArchViolation[] {
      if (layers.length < 2) return []

      const violations: ArchViolation[] = []

      // Check consecutive layer pairs
      for (let i = 0; i < layers.length - 1; i++) {
        const leftLayer = layers[i]
        const rightLayer = layers[i + 1]
        if (!leftLayer || !rightLayer) continue

        // Non-vacuity (ADR-008): a left layer that matched no files enforces
        // nothing. Report the mis-globbed layer instead of passing vacuously.
        if (leftLayer.files.length === 0) {
          violations.push({
            rule: context.rule,
            element: leftLayer.name,
            file: '',
            line: 1,
            message: `Layer "${leftLayer.name}" matched 0 files — a correspondence over an empty layer enforces nothing. Fix the layer glob.`,
            because: context.because,
            ruleId: context.ruleId,
            // Its own remedy, never the author's (bug 0042, a live recurrence of
            // bug 0021). This used to be `suggestion: context.suggestion` /
            // `docs: context.docs`, which failed two ways at once. With author
            // metadata it printed the author's fix for a real violation as this
            // finding's `Fix:` — measured, an empty-layer finding advising "Split
            // the cycle by extracting a shared module." With none, `suggestion` is
            // optional on `ConditionContext`, so the finding shipped with no remedy
            // at all: the only configuration finding of the thirteen that could.
            //
            // `execute-rule.ts`'s bug-0021 guard cannot help here. It withholds the
            // author's text from producers that leave the field unset; this one
            // assigned it, so there was nothing to withhold. Same escape
            // `correspondence-builder.ts` closed with a producer-side remedy.
            //
            // `ruleId` and `because` are **redundant with enrichment**, which
            // backfills both — removing either leaves the suite green, measured.
            // Kept for locality: a reader of this producer should see the whole
            // finding, and `terminal-builder.ts` documents the same discovery.
            // Neither claims a cause, which is why they are safe to carry where
            // `suggestion` and `docs` are not.
            //
            // The removal clause is COMPUTED, because no fixed text is true for
            // both chain lengths — and the first version of this remedy shipped
            // the false one. "Or remove the layer from the chain" is impossible
            // on a two-layer chain: `.mapping()` throws `RangeError` below two
            // layers (`cross-layer-builder.ts:111`) and this finding cannot fire
            // below two either (`:27`), so the advice was unreachable on exactly
            // the shape that produces it. Measured. That is bug 0017's shape, in
            // the change whose subject was bug 0017's shape — which is the best
            // argument in this file for rule 2's behavioural corollary: a remedy
            // is a claim, and reading well is not evidence.
            //
            // The remedy must name WHICH array to edit, and this is the second
            // wrong version of this sentence rather than the first. "Fix the glob
            // for layer X" reads as the `.layer()` call, and doing that does not
            // work: measured, widening the builder's glob to `**/src/**` left the
            // finding in place, because this condition reads the `Layer[]` the
            // caller passed and never sees the builder's resolution (bug 0040's
            // adjacent defect). An agent that follows the obvious reading edits
            // the wrong line, sees no change, and improvises — which is the
            // failure rule 2 exists to prevent, and it survived one round of
            // fixing this very sentence.
            //
            // Pinned by a control that widens the builder glob and asserts the
            // finding does NOT clear, so the caveat cannot quietly become false
            // when 0040 lands — it will fail, and whoever lands it rewrites this.
            suggestion:
              `Fix the glob for layer "${leftLayer.name}" (currently ` +
              `'${leftLayer.pattern}') in the Layer[] passed to this condition — it reads that ` +
              `array, not the builder's .layer() call, so editing .layer() alone will not clear ` +
              `this. It must match at least one file.` +
              (layers.length >= 3
                ? ` Or drop the layer: ${String(layers.length - 1)} would remain, still a valid chain.`
                : ` Dropping the layer is not available here — a chain needs two, and this one has` +
                  ` ${String(layers.length)}. Delete the rule instead if the layer should not exist.`) +
              ` Until then every pair through this layer is unchecked, so the rule reports` +
              ` nothing whether the code complies or not. ${UNSUPPRESSABLE}`,
            // Config-level meta-finding: no source file, so it must survive
            // diff-aware/baseline or the guard re-greens under standard CI.
            bypassFilters: true,
          })
          continue
        }

        // Collect all left files that appear in at least one pair
        const matchedLeftFiles = new Set<string>()
        for (const pair of pairs) {
          if (pair.leftLayer === leftLayer.name && pair.rightLayer === rightLayer.name) {
            matchedLeftFiles.add(pair.left.getFilePath())
          }
        }

        // Find unmatched left files via the shared set-difference core (F2).
        const { missing } = setCorrespondence(
          leftLayer.files.map((file) => file.getFilePath()),
          matchedLeftFiles,
        )
        const missingPaths = new Set(missing)
        for (const file of leftLayer.files) {
          if (!missingPaths.has(file.getFilePath())) continue
          violations.push({
            rule: context.rule,
            element: file.getBaseName(),
            file: file.getFilePath(),
            line: 1,
            message: `File "${file.getBaseName()}" in layer "${leftLayer.name}" has no matching counterpart in layer "${rightLayer.name}"`,
            because: context.because,
            ruleId: context.ruleId,
            suggestion: context.suggestion,
            docs: context.docs,
          })
        }
      }

      return violations
    },
  }
}

/**
 * The matched pair must have consistent exported symbol names.
 *
 * Takes two extractor functions that pull symbol names from each side.
 * Every symbol extracted from the left file must appear in the right file.
 */
export function haveConsistentExports(
  extractLeft: (file: SourceFile) => string[],
  extractRight: (file: SourceFile) => string[],
): PairCondition {
  return {
    description: 'have consistent exports between paired layers',
    evaluate(pairs: LayerPair[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []

      for (const pair of pairs) {
        const leftSymbols = extractLeft(pair.left)
        const rightSymbols = new Set(extractRight(pair.right))

        for (const symbol of leftSymbols) {
          if (!rightSymbols.has(symbol)) {
            violations.push({
              rule: context.rule,
              element: pair.left.getBaseName(),
              file: pair.left.getFilePath(),
              line: 1,
              message: `Symbol "${symbol}" in "${pair.left.getBaseName()}" (${pair.leftLayer}) has no counterpart in "${pair.right.getBaseName()}" (${pair.rightLayer})`,
              because: context.because,
              ruleId: context.ruleId,
              suggestion: context.suggestion,
              docs: context.docs,
            })
          }
        }
      }

      return violations
    },
  }
}

/**
 * Custom pair assertion — shorthand for inline PairCondition.
 *
 * The provided function is called for each pair. Return an `ArchViolation`
 * to signal failure, or `null` if the pair is consistent.
 */
export function satisfyPairCondition(
  description: string,
  fn: (pair: LayerPair) => ArchViolation | null,
): PairCondition {
  return {
    description,
    evaluate(pairs: LayerPair[], _context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const pair of pairs) {
        const result = fn(pair)
        if (result !== null) {
          violations.push(result)
        }
      }
      return violations
    },
  }
}
