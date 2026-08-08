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
  '.excluding(), a `// ts-archunit-exclude` comment, a baseline, or diff-aware mode. ' +
  // The seventh thing an agent tries, and the one you least want it to learn.
  // Measured: `recommended(p)` over a mis-scoped project reports four findings,
  // each carrying the sentence above; adding `overrides: { id: 'off' }` reports
  // three. One config line removed a finding that had just told the reader, in a
  // sentence guarded by a parity test, that it could not be removed.
  //
  // Naming it here rather than leaving it discoverable by elimination: an agent
  // that hits six walls and then finds `'off'` documented in `docs/presets.md`
  // will stamp it, which is ADR-008 rule 1's trained-suppression dynamic produced
  // by our own gate. It is NOT added to `UNSUPPRESSABLE_MECHANISMS`, because that
  // list is the set the parity guard proves DO refuse — and this one does not.
  "A preset's overrides: { id: 'off' } does remove it, by deleting the rule " +
  'entirely — that is not a suppression, it is a permanent decision that never expires.'

/**
 * The declaration half, appended ONLY by the zero-examined producer.
 *
 * It used to live in {@link UNSUPPRESSABLE}, which every configuration finding
 * carries — so it was stapled to findings a declaration cannot settle. Measured:
 * on the assertion-gate finding ("this detector has no pattern") and on a dead
 * selector glob, adding `.expectEmpty()` changes nothing, because both are
 * decided before any declaration is consulted. The reader declares, re-runs, and
 * gets the identical failure with the identical advice — ADR-008 rule 2's loop,
 * introduced by the sentence written to close one.
 *
 * On the dead-glob kind it was worse than a no-op: there `overrides: { id: 'off' }`
 * IS the working exit and declaring is not, so the message steered the reader off
 * the only door that opens.
 *
 * Zero-examined is the one kind a declaration actually settles.
 */
export const DECLARE_INSTEAD =
  'If the rule genuinely has nothing to check, declare that instead — a declaration ' +
  'is an assertion that expires, where deleting the rule is not.'

/** The mechanism names the sentence claims to refuse, for the parity guard. */
export const UNSUPPRESSABLE_MECHANISMS = [
  '.warn()',
  ".asSeverity('warn')",
  '.excluding()',
  '// ts-archunit-exclude',
  'baseline',
  'diff-aware',
] as const
