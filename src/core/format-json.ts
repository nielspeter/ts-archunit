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
/**
 * The `check --format json` document, as a type.
 *
 * Exported because it is a **contract**, and an unexported contract is one a
 * consumer can only discover by breaking. Without it a TypeScript consumer gets
 * a runtime failure where they could have had a red build — and our own tests
 * had to hand-roll the shape and cast through `unknown`, which is the kind of
 * ADR-005 exemption that should not be needed against our own output.
 *
 * Changing these types is changing the agent contract. Treat a field removal or
 * a narrowed union as breaking.
 */
export interface ArchJsonViolation {
  readonly rule: string
  readonly ruleId: string | null
  readonly severity: 'error' | 'warn'
  readonly element: string
  /**
   * The source file, or `null` when the finding has no location.
   *
   * For `kind: 'configuration'` this is the **rule file** that declared the
   * rule — not the code under test — because the CLI attributes findings to
   * their origin before rendering. It is `null` only for findings produced
   * after that step. Never use it to detect a configuration finding; use `kind`.
   */
  readonly file: string | null
  /** `null` when there is no location; `1` on an attributed file means the file, not a position. */
  readonly line: number | null
  /**
   * What kind of finding this is, and therefore what to do about it.
   *
   * `'violation'` — the code is wrong. `'configuration'` — the **rule**
   * enforces nothing, so editing the code cannot clear it.
   *
   * A consumer should treat an **unrecognised** value as `'violation'`: that
   * keeps widening this union non-breaking, and configuration findings today
   * already span four distinct remedies (a rule that matched nothing, a rule
   * file that could not be evaluated, rules after a failure that never ran, and
   * a stale baseline) which may earn their own names later.
   */
  readonly kind: 'violation' | 'configuration'
  readonly message: string
  readonly because: string | null
  readonly suggestion: string | null
  readonly docs: string | null
  readonly codeFrame: string | null
  readonly measured: number | null
}

/** One finding removed by an inline `// ts-archunit-exclude` comment. */
export interface ArchJsonSuppression {
  readonly ruleId: string
  readonly file: string
}

/** An allowlist rule that had subjects but tested no edges. */
export interface ArchJsonUntestedAllowlist {
  readonly rule: string
  readonly subjects: number
  readonly edges: number
}

/** The whole document emitted by `check --format json`. */
export interface ArchJsonReport {
  readonly summary: {
    readonly total: number
    readonly errors: number
    readonly warnings: number
    readonly reason: string | null
  }
  readonly untestedAllowlists: readonly ArchJsonUntestedAllowlist[]
  readonly commentSuppressed: readonly ArchJsonSuppression[]
  readonly violations: readonly ArchJsonViolation[]
}

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
      // What kind of finding this is, which drives what the reader should DO:
      // `'violation'` — the code is wrong, edit the named file;
      // `'configuration'` — the RULE enforces nothing, so editing the code
      // cannot clear it. This distinction was absent from the payload entirely,
      // so an agent could not tell them apart by any field.
      //
      // A string rather than a boolean, decided deliberately. There are twelve
      // configuration-finding producers with materially different causes — an
      // empty selector, a dead glob, a rule with no condition, a preset that
      // discovered nothing — and someone will want to distinguish them. A
      // boolean leaves nowhere to put that; adding a second overlapping field
      // later is worse than one field with room in it. This is the agent
      // contract, so the cost of the wrong shape is permanent.
      //
      // Not named after `bypassFilters`: the consumer cares what the finding
      // IS, not which of our filters it happens to survive.
      kind: v.bypassFilters === true ? 'configuration' : 'violation',
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
