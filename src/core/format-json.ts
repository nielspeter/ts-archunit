import type { ArchViolation } from './violation.js'
import type { EdgeCoverage } from './edge-coverage.js'
import { commentSuppressions } from './comment-suppression.js'

/**
 * Format violations as a JSON string.
 *
 * Useful for CI pipelines, custom dashboards, or piping to other tools.
 *
 * @example
 * const violations = collectViolations(rule1, rule2)
 * console.log(formatViolationsJson(violations))
 */
export function formatViolationsJson(
  violations: ArchViolation[],
  reason?: string,
  /**
   * Allowlist rules that tested no edges (bug 0015).
   *
   * **Passed in, not read from module state.** The first cut called
   * `untestedRules()` here, which made a documented pure formatter impure: a
   * per-rule JSON document in a vitest suite named rules from every earlier
   * rule in the process, because nothing resets between them. Same input,
   * different output depending on history.
   */
  untested: readonly EdgeCoverage[] = [],
): string {
  const errors = violations.filter((v) => (v.severity ?? 'error') === 'error').length
  const output = {
    summary: {
      total: violations.length,
      errors,
      warnings: violations.length - errors,
      reason: reason ?? null,
    },
    // Bug 0015: an allowlist constrains edges, so a subject with none passes
    // whatever the allowlist says. Reported rather than failed — for the `only*`
    // family zero edges is maximal compliance, and only the reader can tell a
    // dependency-free module from a rule that certified nothing. Always present
    // (an empty array, not omitted) so a consumer can distinguish "none" from
    // "this version does not report it".
    untestedAllowlists: untested.map((c) => ({
      rule: c.rule,
      subjects: c.subjects,
      edges: c.edges,
    })),
    // What inline `// ts-archunit-exclude` comments removed from this report.
    // Structural rather than prose, for the same reason `untestedAllowlists` is:
    // the agent reading this document needs identities it can act on, not a
    // sentence to grep. Always present — an empty array, not omitted — so a
    // consumer can tell "nothing was suppressed" from "this version does not
    // report it".
    //
    // Every other filter in the pipeline discloses itself; this one did not,
    // which after bug 0041 made it the widest silent filter we ship.
    commentSuppressed: commentSuppressions().map((c) => ({
      ruleId: c.ruleId,
      file: c.file,
    })),
    violations: violations.map((v) => ({
      rule: v.rule,
      ruleId: v.ruleId ?? null,
      severity: v.severity ?? 'error',
      element: v.element,
      // `null`, not `''`/`1`, when there is no source location. A configuration
      // finding reports that a RULE enforces nothing; it has no line, and saying
      // `"file": "", "line": 1` states one that looks real (bug 0047). A human
      // skims past it; an agent may open it or anchor an edit to it.
      //
      // `null` rather than omission, and consistent with the rest of this
      // document — `ruleId`, `because`, `suggestion`, `docs` and `measured` all
      // null when absent, so a consumer already handles the idiom here.
      file: v.file === '' ? null : v.file,
      line: v.file === '' ? null : v.line,
      // Whether this is a configuration finding: the rule enforces nothing, as
      // against a real violation of a rule that works. The distinction drives
      // what a reader should DO — fix the rule, not the code — and it was not
      // in this payload at all, so an agent parsing JSON could not tell them
      // apart by any field. Named `configuration` rather than `bypassFilters`
      // because the consumer cares what the finding IS, not which filters it
      // survives; the flag's name is an implementation detail of our pipeline.
      configuration: v.bypassFilters === true,
      message: v.message,
      because: v.because ?? null,
      suggestion: v.suggestion ?? null,
      docs: v.docs ?? null,
      codeFrame: v.codeFrame ?? null,
      // Bug 0012's measurement, on the wire. Without it the ratchet is
      // machine-readable only inside the baseline file, and a dashboard wanting
      // the number has to regex it back out of the message — which is the
      // fragility bug 0012 was filed about.
      measured: v.measured ?? null,
    })),
  }
  return JSON.stringify(output, null, 2)
}
