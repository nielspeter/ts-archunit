import type { SourceFile } from 'ts-morph'
import type { PairCondition } from '../core/pair-condition.js'
import type { ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { LayerPair, Layer } from '../models/cross-layer.js'

/**
 * Every element in the left layer must have at least one match in the right layer.
 *
 * Produces a violation for each left-layer file that has no matching pair.
 * "Match" is determined by the mapping function provided via `.mapping()`.
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

        // Collect all left files that appear in at least one pair
        const matchedLeftFiles = new Set<string>()
        for (const pair of pairs) {
          if (pair.leftLayer === leftLayer.name && pair.rightLayer === rightLayer.name) {
            matchedLeftFiles.add(pair.left.getFilePath())
          }
        }

        // Find unmatched left files
        for (const file of leftLayer.files) {
          if (!matchedLeftFiles.has(file.getFilePath())) {
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
