import type { Node, SourceFile } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import { getElementName, type ArchViolation } from '../core/violation.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import { searchModuleBody, type ModuleBodyOptions } from '../helpers/body-traversal.js'

/**
 * Assign each matched node a baseline identity that is not a coordinate.
 *
 * These conditions emit one violation per matching node, and the rendered
 * message distinguishes them by line number. That cannot be the identity: add
 * two lines at the top of a file with matches at lines 2 and 4, and the entry
 * recorded for line 4 now matches the violation that used to be at line 2 — the
 * baseline accepts the **wrong** finding, rather than merely missing one.
 *
 * The line cannot simply be dropped either, because within one file two matches
 * of the same matcher are otherwise identical, and a shared identity means
 * accepting one accepts both. So: bucket by the enclosing declaration, then
 * number the matches inside each bucket.
 *
 * Measured over 596 matched nodes in a real 808-file project, this is 1:1 —
 * and strictly better than the line, which merges two `process.env` accesses
 * that share a line. Renumbering is the residual cost: adding or removing a
 * match shifts the ordinals of later matches *in the same declaration*, which
 * is a change to that declaration. Today, editing any line above shifts every
 * finding in the file.
 */
function identifyMatches(
  sf: SourceFile,
  nodes: readonly Node[],
  matcherDescription: string,
): string[] {
  const ordinals = new Map<string, number>()
  return nodes.map((node) => {
    const scope = `${getElementName(node)}::${matcherDescription}`
    const ordinal = (ordinals.get(scope) ?? 0) + 1
    ordinals.set(scope, ordinal)
    return `module-body::${sf.getFilePath()}::${scope}#${String(ordinal)}`
  })
}

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
        const identities = identifyMatches(sf, result.matchingNodes, matcher.description)
        result.matchingNodes.forEach((node, index) => {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: node.getStartLineNumber(),
            message: `${sf.getBaseName()} contains ${matcher.description} at line ${String(node.getStartLineNumber())}`,
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

        const identities = identifyMatches(sf, badResult.matchingNodes, bad.description)
        badResult.matchingNodes.forEach((node, index) => {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: node.getStartLineNumber(),
            message: `${sf.getBaseName()} contains ${bad.description} at line ${String(node.getStartLineNumber())} — use ${good.description} instead`,
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
