import type { ArchViolation } from '../core/violation.js'
import { UNSUPPRESSABLE } from '../core/unsuppressable.js'
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
  /** Plan 0089's carrier — hoisted to `TerminalBuilder` by plan 0097, so every preset rule has it. */
  expectEmpty(): this
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
  config: PresetBaseOptions | undefined,
  constructed?: string[],
): RuleBuilderLike[] {
  const effective = config?.overrides?.[meta.id] ?? defaultSeverity
  if (effective === 'off') return []
  // Record what was actually BUILT. `RuleBuilderLike` exposes no metadata, and
  // the known-id list cannot answer this: these presets construct rules
  // conditionally, so "known" and "constructed" differ by exactly the ids a
  // declaration must not silently bind to.
  constructed?.push(meta.id)
  const stamped = { ...meta, declarationSpelling: presetDeclarationSpelling(meta.id) }
  return [declareEmptyIfListed(builder.rule(stamped).asSeverity(effective), meta.id, config)]
}

/**
 * Apply plan 0089's declaration carrier to one constructed rule.
 *
 * Exported because the presets build rules three different ways — through
 * `collectRule`, through a local `push` helper, and through an inline loop — and
 * a carrier that reached only one of them would be the shape ADR-009's Context
 * table is about: a mechanism that covers the families someone remembered.
 */
export function declareEmptyIfListed<T extends PresetRule>(
  builder: T,
  id: string,
  config: PresetBaseOptions | undefined,
): T {
  return config?.expectEmpty?.includes(id) === true ? builder.expectEmpty() : builder
}

/**
 * The spelling a PRESET user must type to declare this rule empty — plan 0099.
 *
 * This is the single site that knows both facts the remedy needs: the rule's id,
 * and that the caller is a preset which accepts `expectEmpty`. Core knows only
 * the id, and used to guess from its `preset/` prefix — a naming convention, not
 * a capability, and false for a hand-written rule or a third-party preset that
 * never accepted the option.
 *
 * Applied to every preset rule, not only declared ones: the advice is printed on
 * a rule that examined nothing, which is exactly the rule that has NOT been
 * declared yet.
 */
export function presetDeclarationSpelling(id: string): string {
  return `expectEmpty: ['${id}'] in this preset's options`
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

/**
 * Options every preset accepts.
 *
 * `TRuleId` is that preset's own rule ids as a literal union, so a misspelled
 * override key is a **compile error** rather than a silent no-op
 * ([bug 0038](../../bugs/fixed/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md)).
 * Measured before this: `'…/no-silent-cach': 'error'` left the rule at `warn`
 * and the build green — the escalation the author asked for simply did not
 * happen, and the only trace was a line on stderr.
 *
 * Catching it in the editor is strictly better than catching it at run time:
 * zero CI cycles, and it fires while the author is still looking at the key.
 * The runtime finding exists as well, for the paths a type cannot reach — a
 * JavaScript consumer, a dynamically-built overrides object, a config read from
 * disk.
 *
 * Defaults to `string`, so anything outside this package that extends
 * `PresetBaseOptions` keeps compiling.
 */
/**
 * An unknown override key, as a failing configuration finding —
 * [bug 0038](../../bugs/fixed/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md).
 *
 * `validateOverrides` writes a line to stderr and returns `void`. That is not a
 * signal: measured, `'…/no-silent-cach': 'error'` left the rule at `warn`, the
 * build passed, and the printed warning never reached the exit code. A rule the
 * author asked to escalate silently did not.
 *
 * ## Why a sibling rather than changing `validateOverrides`
 *
 * That function is re-exported from `src/presets/index.ts` and documented with a
 * `void` signature. Changing it to return rules is a **published API break** for
 * a fault this bug concedes is low-frequency, and the user-visible outcome is
 * identical either way — so it stays as it is and this sits beside it. ADR-008
 * rule 6 says guard the guard, not break the API.
 *
 * `PresetBaseOptions` now types the key as a literal union, so most typos never
 * reach here at all. This covers what a type cannot: JavaScript consumers, a
 * dynamically-built overrides object, and `agent-guardrails`' template-literal
 * ids, where the API segment is open by construction.
 */
export function overrideFindings(
  overrides: Partial<Record<string, RuleSeverity>> | undefined,
  knownIds: readonly string[],
): RuleBuilderLike[] {
  if (!overrides) return []
  const known = new Set(knownIds)
  const unknown = Object.keys(overrides).filter((key) => !known.has(key))
  if (unknown.length === 0) return []

  const violations: ArchViolation[] = unknown.map((key) => ({
    rule: `preset override '${key}'`,
    ruleId: `preset/override/${key}`,
    element: key,
    file: '',
    line: 0,
    message:
      `Override key '${key}' matches no rule in this preset, so it does nothing — ` +
      `the severity you set was never applied.`,
    because:
      'an override that names no rule silently leaves that rule at its default, ' +
      'which is a configured escalation that did not happen',
    // Its own remedy, never the author's, and it names the alternatives because
    // the commonest cause is a near-miss the reader cannot spot by staring.
    suggestion:
      `Correct the key, or remove it. This preset's rules are: ${knownIds.join(', ')}. ` +
      UNSUPPRESSABLE,
    bypassFilters: true,
  }))
  return [{ violations: () => violations }]
}

/**
 * Findings for `expectEmpty` ids that bind to no constructed rule — plan 0089.
 *
 * The sibling of {@link overrideFindings}, and it fails for a sharper reason.
 * An unknown override key leaves a rule at its default: an escalation that did
 * not happen. An unknown `expectEmpty` id turns an **expiring assertion into
 * nothing** — the author declared a state, the declaration bound to no rule, and
 * once plan 0099's floor lands they are told to declare what they already
 * declared, misspelled. That is bug 0017's shape, and ADR-008 rule 1 forbids
 * answering it with a warning nobody reads.
 *
 * The unbound id is reported against the **constructed** set, not the declared
 * one, so a rule switched `'off'` and still named here reports too — which is
 * correct: `'off'` deleted the rule, so the declaration about it is dead.
 */
export function declaredEmptyFindings(
  expectEmpty: readonly string[] | undefined,
  constructedIds: readonly string[],
): RuleBuilderLike[] {
  if (!expectEmpty || expectEmpty.length === 0) return []
  const built = new Set(constructedIds)
  const unbound = [...new Set(expectEmpty)].filter((id) => !built.has(id))
  if (unbound.length === 0) return []

  // De-duplicated, because `boundaries` and `layered` push the same id once per
  // boundary / layer / pair. Un-deduplicated this degenerates exactly where the
  // reader needs it most: measured at 5 boundaries + 1 shared glob +
  // `isolateTests`, the list ran to 31 entries naming 4 unique ids, with
  // `test-isolation` repeated 20 consecutive times and the answer buried inside
  // it. `overrideFindings` never had this problem only because it is handed
  // `RULE_IDS`, which is unique by construction.
  const uniqueConstructed = [...new Set(constructedIds)]

  // When the preset built NOTHING, "correct the id" is a false remedy — the id
  // is usually right and the cause is upstream (a discovery glob that matched
  // no folders, or every rule overridden `off`). An agent that obeys it deletes
  // a correct declaration, and plan 0099's floor then demands the declaration
  // back: bug 0017's loop, which ADR-008 rule 2 forbids us to reintroduce.
  const suggestion =
    uniqueConstructed.length === 0
      ? `This preset constructed NO rules, so the cause is upstream of this id — check the ` +
        `discovery glob that finds this preset's subjects, and whether every rule was set to 'off'. ` +
        `Fix that first: the declaration is probably correct and will bind once rules exist. ` +
        UNSUPPRESSABLE
      : `Correct the id, or remove it. This preset constructed: ${uniqueConstructed.join(', ')}. ` +
        `Note that a rule set to 'off' is not constructed, so a declaration naming it is dead. ` +
        UNSUPPRESSABLE

  const violations: ArchViolation[] = unbound.map((id) => ({
    rule: `preset expectEmpty '${id}'`,
    ruleId: `preset/expect-empty/${id}`,
    element: id,
    file: '',
    line: 0,
    message:
      `expectEmpty names '${id}', which this preset did not construct, so the ` +
      `declaration applies to nothing.`,
    because:
      'a declaration that binds to no rule is not a weaker assertion, it is no assertion — ' +
      'and it reads in the config as though the empty state has been accounted for',
    suggestion,
    bypassFilters: true,
  }))
  return [{ violations: () => violations }]
}

/**
 * Guard a preset's *construction* step (plan 0100): every rule this preset can
 * build sits behind its own optional flag, and the required field is only the
 * selector — so satisfying the type completely can still enable nothing.
 * Measured: `agentGuardrails({ src })` and `dataLayerIsolation({ repositories })`
 * both construct zero rules, on every corpus, and report nothing — the loop a
 * user holds runs zero times and every gate is green.
 *
 * `attempted` is the id list the caller's OPTIONS asked for, computed BEFORE
 * `overrides` is consulted — the same distinction plan 0099's floor draws
 * between zero-subjects and declared-empty:
 *
 * - `attempted.length === 0` — no rule was ever enabled. A mistake: fire.
 * - `attempted.length > 0` and nothing was constructed — every enabled rule
 *   was explicitly turned off (`overrides: { id: 'off' }`), which
 *   {@link UNSUPPRESSABLE}'s own text already treats as a permanent, legitimate
 *   decision, not a suppression. Silent.
 *
 * Fires only when `otherFindings` — every other config-finding builder this
 * preset already produced (unknown override keys, unbound `expectEmpty`, a
 * discovery guard) — is also empty, so a preset with a more specific cause
 * reports that cause once, not this one stacked on top of it. Same ordering
 * the zero-examined producer already states: report last, and only when
 * nothing else already explained the emptiness.
 *
 * Returns the same `{ violations }`-only shape as {@link assertDiscovered} and
 * {@link overrideFindings} — sufficient for both real consumers of a preset's
 * `RuleBuilderLike[]` (`checkAll()`, `src/cli/load-rules.ts`), which call only
 * `.violations()` on every array element, never `.check()`/`.warn()` on one
 * item in isolation.
 */
export function assertEnabled(
  attempted: readonly string[],
  otherFindings: readonly RuleBuilderLike[],
  finding: { id: string; presetName: string; optionsHint: string },
): RuleBuilderLike[] {
  if (attempted.length > 0 || otherFindings.length > 0) return []
  const violation: ArchViolation = {
    rule: finding.id,
    ruleId: finding.id,
    element: finding.id,
    file: '',
    line: 0,
    message:
      `${finding.presetName}(...) satisfied every required option and constructed 0 rules — every ` +
      `rule it can build sits behind an optional flag, and none was set, so this call enforces ` +
      `nothing while every gate reports it as healthy.`,
    because:
      'a preset that constructs no rules has nothing for the fail-closed floor to reach — a ' +
      'function returning [] never calls collectViolations(), so no per-rule guard sees it',
    suggestion: `Set at least one of: ${finding.optionsHint}. ` + UNSUPPRESSABLE,
    bypassFilters: true,
  }
  return [{ violations: () => [violation] }]
}

export interface PresetBaseOptions<TRuleId extends string = string> {
  overrides?: Partial<Record<TRuleId, RuleSeverity>>

  /**
   * Rules of this preset whose empty state is **declared** — plan 0089.
   *
   * A preset user holds no builder, so they cannot reach `.expectEmpty()`. Once
   * plan 0099's floor fails a check that examined nothing, their only other
   * remedy is `overrides: { id: 'off' }` — which is permanent, never expires,
   * and deletes the rule rather than declaring a fact about it. That is
   * [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 1's
   * trained-suppression dynamic, produced by our own gate; ADR-009 part 3 makes
   * a carrier binding for exactly this reason.
   *
   * Typed on the preset's own id union, like `overrides`, so a rename is a
   * compile error rather than a silent no-op. **An id here that binds to no
   * constructed rule is a failing configuration finding**, never a warning — see
   * {@link declaredEmptyFindings}.
   *
   * ## One id can name several constructed rules
   *
   * `boundaries` and `layered` construct some ids many times — `no-cross-boundary`
   * once per boundary, `restricted-packages` once per package, `test-isolation`
   * once per boundary pair. Declaring such an id applies the assertion to **every**
   * instance, so it holds only while all of them examine nothing, and the day one
   * fills you get a false-declaration finding for that instance. The rule's real
   * violations are still reported alongside it — `RuleBuilder.evaluate` used to
   * discard them, which is how a genuine `imports "lodash"` finding went missing
   * behind a declaration.
   *
   * `readonly` so a caller's `as const` list is accepted.
   */
  expectEmpty?: readonly TRuleId[]
}

/**
 * Validate override keys against known rule IDs.
 * Warns for unrecognized keys (likely typos).
 */
export function validateOverrides(
  overrides: Partial<Record<string, RuleSeverity>> | undefined,
  knownIds: readonly string[],
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
export function atPath<T extends Located>(glob: string, option?: string): Predicate<T> {
  const combined = or(resideInFile<T>(glob), resideInFolder<T>(glob))
  // The option name, when the caller knows it, so a configuration finding names
  // `shared: "…"` rather than the two calls `or()` expanded into (plan 0074).
  return option === undefined ? combined : { ...combined, originLabel: `${option}: "${glob}"` }
}
