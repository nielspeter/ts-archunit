import type { ArchViolation } from '../core/violation.js'
import type { Predicate } from '../core/predicate.js'
import type { Located } from '../predicates/identity.js'
import { resideInFile, resideInFolder } from '../predicates/identity.js'
import { or } from '../core/combinators.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import { writeStderr } from '../core/stderr.js'

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
 *
 * Takes the rule's full metadata, not just its id. It used to take an id and
 * attach `{ id }` alone, which meant every rule in `strictBoundaries`,
 * `layeredArchitecture` and `dataLayerIsolation` — 37 of them in
 * `strictBoundaries` alone — failed with no `because` and no `suggestion`.
 * ADR-008 rule 2 requires every failure to carry its sanctioned fix, and a
 * preset is the one place a user cannot supply it themselves: they did not
 * write the rule.
 */
export function collectRule(
  builder: PresetRule,
  meta: RuleMetadata & { id: string },
  defaultSeverity: RuleSeverity,
  overrides: Record<string, RuleSeverity> | undefined,
): RuleBuilderLike[] {
  const effective = overrides?.[meta.id] ?? defaultSeverity
  if (effective === 'off') return []
  return [builder.rule(meta).asSeverity(effective)]
}

/**
 * Guard a preset's *discovery* step (ADR-008 / plan 0067): if a glob discovered
 * no subjects, return a failing rule carrying a config-level meta-finding rather
 * than silently generating no rules — the false green a boundaries/layers preset
 * must never produce. The finding bypasses diff/baseline so it survives the
 * standard CI mode.
 */
export function assertDiscovered(
  discovered: readonly unknown[],
  finding: { id: string; glob: string; remedy: string },
): RuleBuilderLike[] {
  if (discovered.length > 0) return []
  const violation: ArchViolation = {
    rule: finding.id,
    ruleId: finding.id,
    element: finding.id,
    file: '',
    line: 0,
    message: `Discovery matched 0 subjects for glob '${finding.glob}'. ${finding.remedy}`,
    because:
      'a preset that discovers nothing generates no rules, so the whole preset silently certifies nothing',
    suggestion: finding.remedy,
    severity: 'error',
    bypassFilters: true,
  }
  return [{ violations: () => [violation] }]
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
      writeStderr(
        `[ts-archunit] Override key '${key}' does not match any rule in this preset. ` +
          `Available rules: ${knownIds.join(', ')}`,
      )
    }
  }
}

/**
 * Match a user-supplied glob against the file path **or** its parent directory.
 *
 * Preset options name a location — `repositories`, `shared`, a layer glob — and
 * both spellings are natural: `'**\/repositories/**'` and
 * `'**\/repositories/repo.ts'`. `resideInFolder` reads only the parent
 * directory, so a preset that used it directly silently enforced **nothing**
 * for a file glob: measured, `dataLayerIsolation({ repositories:
 * '**\/repositories/bad-repo.ts' })` generated its two rules and reported 0
 * violations on a fixture named `bad-repo` (bug 0018).
 *
 * The fix is to make the natural spelling work rather than to fail on it — the
 * principle bug 0014 settled on, and 0067-C reached independently. `or()` is
 * the right combinator for the glob model too: the declaration is dead only
 * when **both** readings are, which is what `doctor` will report on it.
 *
 * Internal to presets on purpose. A user writing their own rule chooses
 * `resideInFile` or `resideInFolder` knowing which they mean; a preset option
 * has to accept whichever its caller wrote.
 */
export function atPath<T extends Located>(glob: string): Predicate<T> {
  return or(resideInFile<T>(glob), resideInFolder<T>(glob))
}
