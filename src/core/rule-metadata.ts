/**
 * Rich metadata for an architecture rule.
 *
 * Provides educational context beyond the violation message:
 * why the rule exists, how to fix violations, where to learn more.
 */
export interface RuleMetadata {
  /** Unique rule identifier, e.g. 'repo/typed-errors' */
  id?: string

  /** Why this rule exists — the risk or impact */
  because?: string

  /** How to fix — actionable suggestion with code example */
  suggestion?: string

  /** Link to documentation — ADR, wiki, style guide */
  docs?: string

  /**
   * Imperative one-liner for AI-agent system prompts, e.g.
   * "Do NOT throw new Error() in repositories". Surfaced by
   * `explain --format agent`. When unset, a heuristic is derived from the
   * rule's predicate/condition description.
   */
  imperative?: string

  /**
   * How the AUTHOR of this rule spells "I declare this empty" — plan 0099.
   *
   * Set by whoever constructs the rule, because only they know. A preset sets
   * `expectEmpty: ['<id>']` because that is what its user can type; a builder
   * author leaves it unset and gets `.expectEmpty()`.
   *
   * Core used to derive this from the rule id starting with `preset/`, which it
   * cannot verify: that is false for a hand-written `.rule({ id: 'preset/...' })`,
   * for a third-party preset that never extended `PresetBaseOptions`, and for a
   * preset that forwards `overrides` but not `expectEmpty`. A prefix is a naming
   * convention, not a capability, and the remedy has to name a call the reader
   * can actually make ([ADR-008](../../adr/008-agent-first-failure-surfaces.md)
   * rule 2).
   */
  declarationSpelling?: string
}
