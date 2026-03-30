import type { SourceFile } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'

/**
 * Module must NOT have a default export.
 *
 * @example
 * modules(p).that().resideInFolder('** /src/** ')
 *   .should().notHaveDefaultExport()
 *   .check()
 */
export function notHaveDefaultExport(): Condition<SourceFile> {
  return {
    description: 'not have a default export',
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        if (sf.getDefaultExportSymbol()) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} has a default export`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * Module must have a default export.
 *
 * @example
 * modules(p).that().resideInFolder('** /pages/** ')
 *   .should().haveDefaultExport()
 *   .check()
 */
export function haveDefaultExport(): Condition<SourceFile> {
  return {
    description: 'have a default export',
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        if (!sf.getDefaultExportSymbol()) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} does not have a default export`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * Module must have at most `max` named exports.
 *
 * Counts distinct export names (not declarations — a re-export counts as one).
 * Default exports are not counted.
 *
 * @example
 * modules(p).that().resideInFolder('** /domain/** ')
 *   .should().haveMaxExports(1)
 *   .check()
 */
export function haveMaxExports(max: number): Condition<SourceFile> {
  if (!Number.isInteger(max) || max < 0) {
    throw new Error(`haveMaxExports: max must be a non-negative integer, got ${String(max)}`)
  }
  return {
    description: `have at most ${String(max)} export(s)`,
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        const exportMap = sf.getExportedDeclarations()
        // Count named exports — exclude 'default' key
        let count = 0
        for (const key of exportMap.keys()) {
          if (key !== 'default') count++
        }
        if (count > max) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} has ${String(count)} named export(s), exceeding the limit of ${String(max)}`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}
