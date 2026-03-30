import type { ArchViolation } from '../core/violation.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import { ArchRuleError } from '../core/errors.js'
import { formatViolations } from '../core/format.js'

export type RuleSeverity = 'error' | 'warn' | 'off'

export interface PresetBaseOptions {
  overrides?: Record<string, RuleSeverity>
}

/**
 * Anything with `.rule()` and `.violations()` — works with both
 * RuleBuilder<T> and TerminalBuilder hierarchies.
 */
interface Dispatchable {
  rule(m: RuleMetadata): { violations(): ArchViolation[] }
  violations(): ArchViolation[]
}

/**
 * Dispatch a single rule within a preset.
 *
 * - 'off': skip entirely
 * - 'warn': log violations to stderr, do not collect for aggregated throw
 * - 'error': collect violations for aggregated throw
 */
export function dispatchRule(
  builder: Dispatchable,
  ruleId: string,
  defaultSeverity: RuleSeverity,
  overrides: Record<string, RuleSeverity> | undefined,
): ArchViolation[] {
  const effective = overrides?.[ruleId] ?? defaultSeverity
  if (effective === 'off') return []

  const violations = builder.rule({ id: ruleId }).violations()

  if (effective === 'warn') {
    if (violations.length > 0) {
      console.warn(formatViolations(violations))
    }
    return []
  }

  return violations
}

/**
 * Validate override keys against known rule IDs.
 * Warns for unrecognized keys (likely typos).
 */
export function validateOverrides(
  overrides: Record<string, RuleSeverity> | undefined,
  knownIds: string[],
): void {
  if (!overrides) return
  const knownSet = new Set(knownIds)
  for (const key of Object.keys(overrides)) {
    if (!knownSet.has(key)) {
      console.warn(
        `[ts-archunit] Override key '${key}' does not match any rule in this preset. ` +
          `Available rules: ${knownIds.join(', ')}`,
      )
    }
  }
}

/**
 * Throw a single ArchRuleError with all aggregated violations, if any.
 */
export function throwIfViolations(violations: ArchViolation[]): void {
  if (violations.length > 0) {
    process.stderr.write(formatViolations(violations) + '\n')
    throw new ArchRuleError(violations)
  }
}
