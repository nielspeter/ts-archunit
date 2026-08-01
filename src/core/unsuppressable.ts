/**
 * The one sentence that tells a reader a configuration finding has no escape
 * hatch — [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 3.
 *
 * Stated on the finding rather than inside each remedy so the per-shape advice
 * stays one sentence each and this stays one sentence in one place. Measured
 * before it existed: a reader given only the remedy tries `.asSeverity('warn')`,
 * `.excluding()`, the baseline and `--changed` — four CI cycles — because
 * nothing told them those were refused.
 *
 * ## Why it lives here rather than inline
 *
 * It was written twice, inline, at two sites in `terminal-builder.ts`, and
 * prettier had already split the second copy across lines. Two copies of a
 * sentence that enumerates a list is the shape that goes stale: the code grew a
 * sixth refusing surface and both copies still named five.
 *
 * ## The list is a claim, so it is guarded
 *
 * `tests/core/unsuppressable-sentence.test.ts` derives the refusing mechanisms
 * **behaviourally** — one probe each — and compares that set against the names
 * parsed out of this string. Disagreement fails in both directions: naming a
 * mechanism that does not refuse (bug 0017's shape) and refusing by a mechanism
 * this does not name. The second is what actually happened.
 *
 * The sixth surface is the inline `// ts-archunit-exclude` comment, refused in
 * `execute-rule.ts` by the `v.bypassFilters === true ||` clause. It was omitted
 * while it was hard to reach; [bug 0041](../../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md)
 * made inline comments work for every condition family, so an agent reading a
 * five-item list and inferring exhaustiveness now reaches for the one mechanism
 * the sentence forgot to mention.
 */
export const UNSUPPRESSABLE =
  "This finding cannot be suppressed: not by .warn(), .asSeverity('warn'), " +
  '.excluding(), a `// ts-archunit-exclude` comment, a baseline, or diff-aware mode.'

/** The mechanism names the sentence claims to refuse, for the parity guard. */
export const UNSUPPRESSABLE_MECHANISMS = [
  '.warn()',
  ".asSeverity('warn')",
  '.excluding()',
  '// ts-archunit-exclude',
  'baseline',
  'diff-aware',
] as const
