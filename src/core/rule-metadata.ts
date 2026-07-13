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
}
