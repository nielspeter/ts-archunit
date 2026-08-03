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

/**
 * A rule that can describe itself.
 *
 * `RuleBuilderLike` declares only `violations()` — deliberately, so a caller can
 * pass a plain object — while every builder in `src/` implements `describeRule()`.
 * So reading a rule's id or remedy needs a narrowing, and that narrowing existed
 * in **three** places with two different implementations: `cli/commands/explain.ts`
 * and two test files.
 *
 * One owner, because a duplicated predicate is not a style problem here:
 * [bug 0044](../../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md)
 * was a measurement error caused by exactly that, and the fix was to delete the
 * duplicate rather than to test both copies.
 *
 * `DiagnosableRule` and `orphanExclusions` are NOT copies of this: they declare
 * `describeRule?` as an optional structural member of their own input type, which
 * is a different mechanism and correct where it is used.
 */
export interface Describable {
  describeRule: () => RuleDescription
}

/**
 * Does this value describe itself?
 *
 * Cast-free, and that is the point: the version in `explain.ts` read
 * `(value as Record<string, unknown>)['describeRule']`, an ADR-005 breach in
 * shipped source with no `eslint-disable` and no interop boundary to justify it.
 * It was also unnecessary — once `value` is narrowed to `object`, `'describeRule'
 * in value` narrows enough for the property access to compile, which is what the
 * two test copies already did.
 */
export function isDescribable(value: unknown): value is Describable {
  if (typeof value !== 'object' || value === null) return false
  if (!('describeRule' in value)) return false
  return typeof value.describeRule === 'function'
}
