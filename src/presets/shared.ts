import type { ArchViolation } from '../core/violation.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'

export type RuleSeverity = 'error' | 'warn' | 'off'

/**
 * A builder a preset can configure and hand back: `.rule()` / `.asSeverity()`
 * chain (return `this`), `.violations()` runs it. Satisfied by both the
 * `RuleBuilder` and `TerminalBuilder` hierarchies.
 */
interface PresetRule {
  rule(m: RuleMetadata): this
  asSeverity(level: 'error' | 'warn'): this
  violations(): ArchViolation[]
}

/**
 * Resolve a preset rule's effective severity and return it as a configured,
 * UN-executed builder for the caller to spread into a rule array. `'off'` →
 * empty array (spread-friendly). The returning-form replacement for the old
 * self-executing `dispatchRule`.
 */
export function collectRule(
  builder: PresetRule,
  ruleId: string,
  defaultSeverity: RuleSeverity,
  overrides: Record<string, RuleSeverity> | undefined,
): RuleBuilderLike[] {
  const effective = overrides?.[ruleId] ?? defaultSeverity
  if (effective === 'off') return []
  return [builder.rule({ id: ruleId }).asSeverity(effective)]
}

export interface PresetBaseOptions {
  overrides?: Record<string, RuleSeverity>
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
