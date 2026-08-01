import type { SourceFile } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { identifyMatches } from './match-identity.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import {
  searchModuleBody,
  type ModuleBodyOptions,
  reportedLine,
} from '../helpers/body-traversal.js'

// ─── Module body conditions ────────────────────────────────────────

/**
 * Module must contain at least one node matching the matcher.
 *
 * Default: searches the entire file. With `{ scopeToModule: true }`,
 * only searches top-level statements (skips class/function bodies).
 */
export function moduleContain(
  matcher: ExpressionMatcher,
  options?: ModuleBodyOptions,
): Condition<SourceFile> {
  return {
    description: `contain ${matcher.description}`,
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        const result = searchModuleBody(sf, matcher, options)
        if (!result.found) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} does not contain ${matcher.description}`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * Module must NOT contain any node matching the matcher.
 *
 * Produces one violation per matching node found.
 * Default: searches the entire file. With `{ scopeToModule: true }`,
 * only searches top-level statements (skips class/function bodies).
 */
export function moduleNotContain(
  matcher: ExpressionMatcher,
  options?: ModuleBodyOptions,
): Condition<SourceFile> {
  return {
    description: `not contain ${matcher.description}`,
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        const result = searchModuleBody(sf, matcher, options)
        const identities = identifyMatches(
          'module-body',
          sf.getFilePath(),
          result.matchingNodes,
          matcher.description,
        )
        result.matchingNodes.forEach((node, index) => {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: reportedLine(node, result.triviaPositions[index]),
            message: `${sf.getBaseName()} contains ${matcher.description} at line ${String(reportedLine(node, result.triviaPositions[index]))}`,
            identity: identities[index],
            because: context.because,
          })
        })
      }
      return violations
    },
  }
}

/**
 * Module must use the 'good' pattern instead of the 'bad' pattern.
 *
 * Combines notContain(bad) and contain(good) into a single condition
 * with better violation messages.
 */
export function moduleUseInsteadOf(
  bad: ExpressionMatcher,
  good: ExpressionMatcher,
  options?: ModuleBodyOptions,
): Condition<SourceFile> {
  return {
    description: `use ${good.description} instead of ${bad.description}`,
    evaluate(elements: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of elements) {
        const badResult = searchModuleBody(sf, bad, options)
        const goodResult = searchModuleBody(sf, good, options)

        const identities = identifyMatches(
          'module-body',
          sf.getFilePath(),
          badResult.matchingNodes,
          bad.description,
        )
        badResult.matchingNodes.forEach((node, index) => {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: reportedLine(node, badResult.triviaPositions[index]),
            message: `${sf.getBaseName()} contains ${bad.description} at line ${String(reportedLine(node, badResult.triviaPositions[index]))} — use ${good.description} instead`,
            identity: identities[index],
            because: context.because,
          })
        })

        if (!goodResult.found) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} does not contain ${good.description}`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}
