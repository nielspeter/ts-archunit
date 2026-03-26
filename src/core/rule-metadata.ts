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
}
