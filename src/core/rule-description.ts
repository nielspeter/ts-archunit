/**
 * Structured description of a rule, returned by `.describe()`.
 * Used by the `explain` CLI subcommand to dump active rules as JSON.
 */
export interface RuleDescription {
  rule: string
  id?: string
  because?: string
  suggestion?: string
  docs?: string
  /** Imperative "Do NOT … / MUST …" sentence for agent system prompts. */
  imperative?: string
}
