import fs from 'node:fs'
import type { ArchViolation } from './violation.js'
import { severityFor, disambiguateIdentities } from './violation.js'
import type { CheckOptions, OutputFormat } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import { ArchRuleError } from './errors.js'
import { formatViolations } from './format.js'
import { formatViolationsJson } from './format-json.js'
import { activeNotice } from './diff-disclosure.js'
import { formatViolationsGitHub } from './format-github.js'
import { parseExclusionComments, isExcludedByComment } from './exclusion-comments.js'
import type { ExclusionWarning } from './exclusion-comments.js'
import { UNSUPPRESSABLE } from './unsuppressable.js'
import { recordCommentSuppression } from './comment-suppression.js'
import { writeStderr } from './stderr.js'
import type { EdgeCoverage } from './edge-coverage.js'

/**
 * Context for executing a rule's terminal methods.
 * Shared across all builder types (RuleBuilder, SliceRuleBuilder,
 * SchemaRuleBuilder, ResolverRuleBuilder, PairFinalBuilder, SmellBuilder).
 */
export interface ExecuteRuleContext {
  reason?: string
  metadata?: RuleMetadata
  exclusions?: (string | RegExp)[]
  silentIndices?: Set<number>
}

/**
 * Complete each violation's identity, then apply `.excluding()` patterns and
 * inline exclusion comments.
 *
 * Extracted to eliminate terminal-method duplication across builders.
 *
 * **Not** baseline or diff filtering, despite what this said for several
 * releases — those run in `executeCheck` / `executeWarn`, after this returns.
 *
 * ## The invariant, for whoever adds the next filter
 *
 * **Enrichment runs first, so every filter sees a complete violation.** That is
 * the whole reason for the ordering, and it is easy to undo by accident because
 * enrichment looks like output formatting rather than identity. It is not: the
 * comment filter matches on `ruleId`, and when enrichment ran last that filter
 * saw `undefined` for every condition that did not stamp the field itself
 * (bug 0041) — a documented feature that silently did nothing.
 *
 * Enrichment is pure, idempotent, and writes a **disjoint field set** from
 * everything the filters read: it touches `ruleId`, `because`, `suggestion` and
 * `docs`; `.excluding()` matches on `element`/`file`/`message`, and the
 * `bypassFilters` refusal path reads a flag enrichment never writes. So
 * "identity is complete before anything reads it" is a simpler invariant to hold
 * than "each filter must know which fields exist yet". Add a filter that reads
 * one of those four fields and it will work; add a mutation of them below a
 * filter and you have reintroduced 0041.
 */
export function applyFilters(
  violations: ArchViolation[],
  ctx: ExecuteRuleContext,
): ArchViolation[] {
  // Identity uniqueness, BEFORE the enrichment below and before every filter — see
  // `disambiguateIdentities`. Two reasons for this position specifically:
  //
  // 1. This function's own contract is that identity is complete before anything reads it,
  //    and the baseline reads it after. A producer that emits two findings with one identity
  //    hands the baseline one entry for two findings, and accepting either accepts both —
  //    which is bugs 0028, 0063, 0064 and 0065, one per family that got reviewed.
  // 2. Ahead of the filters rather than after them, so a finding's identity is a property of
  //    what the RULE found, not of what a `--changed` or `.excluding()` run happened to keep.
  //    Suffixing after filtering would give the same finding different identities in CI and
  //    on a laptop, which is the defect `identity` exists to prevent.
  //
  // Enrichment does not touch `element`, `message` or `identity`, so the order between this
  // and the block below is free; it runs first to keep "identity is settled" the outermost
  // statement about this function.
  let result = disambiguateIdentities(violations)

  // Enrich FIRST, because a filter cannot match on a field that is not set yet.
  //
  // [Bug 0041](../../bugs/fixed/0041-an-exclusion-comment-is-a-no-op-for-most-conditions.md):
  // this block used to run LAST, after the inline-comment filter below. That
  // filter's first statement is `if (!violation.ruleId) return false`
  // (`exclusion-comments.ts:262`), so an exclusion comment matched only
  // violations whose *producing condition* stamped `ruleId` itself. For every
  // condition that left it to this enrichment — the dependency, exports, slice,
  // reverse-dependency and module-body families, which is most of them — the
  // comment was inert: no suppression, no error, no warning. Measured, with a
  // documented comment and a rule carrying an id, `modules().notImportFrom()`
  // returned the violation unsuppressed, and it carried the matching `ruleId`,
  // stamped here a few lines too late.
  //
  // Ordering, not lookup, is the fix: giving `isExcludedByComment` a second
  // source for the id would leave two places that decide what a rule is called.
  //
  // Safe ahead of `.excluding()` as well, which matches on `element`/`file`/
  // `message` — none of which this touches. It costs a map over violations that
  // may later be filtered out; correctness beats that.
  const meta = ctx.metadata
  if (ctx.reason || meta?.id || meta?.because || meta?.suggestion || meta?.docs) {
    result = result.map((v) => ({
      ...v,
      ruleId: v.ruleId ?? meta?.id,
      because: v.because ?? ctx.reason ?? meta?.because,
      // A `bypassFilters` finding reports that the rule enforces NOTHING, so the
      // author's `suggestion` cannot be its remedy: that text describes how to fix
      // a real violation of the rule, and the formatter renders `suggestion` under
      // `Fix:` — the field an agent obeys. Pairing a configuration message with an
      // unrelated `Fix:` is a false remedy by juxtaposition (bug 0021), and it is
      // ADR-008 rule 2: a failure may not assert a cause it cannot verify.
      //
      // `SliceRuleBuilder.metaViolation` argued exactly this in a comment and
      // omitted both fields — and was overridden here, one layer up, so the
      // omission had no effect in any shipped version. Measured: a finding reading
      // "resolved no slices" printed "Split the cycle by extracting a shared
      // module." as its Fix:.
      //
      // This guard reaches only producers that LEAVE the fields unset. A producer
      // that assigns `context.suggestion` itself defeats it — bug 0042, where
      // `cross-layer.ts` did exactly that and shipped the author's remedy on an
      // empty-layer finding. Such a producer owns the discipline itself.
      //
      // `ruleId` and `because` stay. Neither asserts a remedy: the id says WHICH
      // rule enforces nothing, which is the first thing the reader needs, and
      // `because` states why the rule exists, which is context rather than a
      // claim about this finding's cause. A producer that wants a remedy sets its
      // own — `metaViolation` sets `docs: GLOB_DOCS`, which is about the fault.
      suggestion: v.bypassFilters ? v.suggestion : (v.suggestion ?? meta?.suggestion),
      docs: v.bypassFilters ? v.docs : (v.docs ?? meta?.docs),
    }))
  }

  // Apply .excluding() chain exclusions
  const exclusions = ctx.exclusions ?? []
  if (exclusions.length > 0) {
    const matchedPatterns = new Set<number>()
    /** Patterns that matched a meta-finding, which cannot be excluded. */
    const refusedPatterns = new Set<number>()
    result = result.filter((v) => {
      // Config-level meta-findings (empty selector / empty discovery) are never
      // excludable: they report that the rule checks NOTHING, so silencing one
      // silences the guard itself. Baseline and diff-aware already honor this
      // flag; `.excluding()` must too, or a rule that enforces nothing can be
      // made green — the exact false-green ADR-008 exists to prevent. This
      // matters more now that meta-messages quote the user's own globs/paths,
      // which an unrelated path exclusion can incidentally match.
      if (v.bypassFilters) {
        // Record a pattern that WOULD have matched, so the "unused exclusion" warning
        // below doesn't tell the caller their exclusion is stale after a rename. It
        // isn't stale — it is refused, which is a different instruction.
        const wouldMatch = exclusions.findIndex((pattern) =>
          typeof pattern === 'string'
            ? [v.element, v.file, v.message].includes(pattern)
            : [v.element, v.file, v.message].some((target) => pattern.test(target)),
        )
        if (wouldMatch >= 0) refusedPatterns.add(wouldMatch)
        return true
      }

      // Match against element, file, or message — so that custom conditions
      // using createViolation() can be excluded by file path or message content,
      // not just by element name (which may be a generic AST node kind).
      const targets = [v.element, v.file, v.message]
      const matchIndex = exclusions.findIndex((pattern) =>
        typeof pattern === 'string'
          ? targets.some((t) => t === pattern)
          : targets.some((t) => pattern.test(t)),
      )
      if (matchIndex >= 0) {
        matchedPatterns.add(matchIndex)
        return false
      }
      return true
    })

    const ruleId = ctx.metadata?.id ?? 'unnamed'
    const silentIndices = ctx.silentIndices ?? new Set()
    exclusions.forEach((pattern, index) => {
      if (refusedPatterns.has(index)) {
        writeStderr(
          `[ts-archunit] Exclusion '${String(pattern)}' in rule '${ruleId}' matched a ` +
            `configuration finding, which cannot be excluded — that finding reports the ` +
            `rule enforces nothing. Fix the fault it names instead.`,
        )
      } else if (!matchedPatterns.has(index) && !silentIndices.has(index)) {
        writeStderr(
          `[ts-archunit] Unused exclusion '${String(pattern)}' in rule '${ruleId}'. ` +
            `It matched zero violations — it may be stale after a rename.`,
        )
      }
    })
  }

  // Scan source files for inline exclusion comments (when rule has an ID)
  if (ctx.metadata?.id && result.length > 0) {
    const undocumented: ExclusionWarning[] = []
    const filePaths = new Set(result.map((v) => v.file))
    const allComments = [...filePaths].flatMap((filePath) => {
      try {
        const sourceText = fs.readFileSync(filePath, 'utf-8')
        const parseResult = parseExclusionComments(sourceText, filePath)
        for (const warning of parseResult.warnings) {
          // An undocumented exclusion is well-formed and APPLIES, so a stderr
          // line is the wrong weight: it silences a real finding and the build
          // goes green (bug 0039). It becomes a configuration finding below.
          // The malformed shapes are different — two of the three decline to
          // create the exclusion at all, so the original violation still fires
          // and the build is already red. A line on stderr is right for those.
          if (warning.kind === 'undocumented') {
            undocumented.push(warning)
            continue
          }
          writeStderr(`[ts-archunit] ${warning.message}`)
        }
        return parseResult.exclusions
      } catch {
        return []
      }
    })

    if (allComments.length > 0) {
      // `v.bypassFilters` explicitly, not by accident. These findings are
      // immune today only because they carry `file: ''`, so `readFileSync('')`
      // throws into the catch above and `comment.file === ''` can never hold.
      // The moment one carries a real path this clause becomes the only
      // protection — and bug 0026 is that moment: configuration findings now
      // carry the rule file they came from, so this file IS read and its
      // `// ts-archunit-exclude` comments ARE parsed. Without the first clause
      // a comment in a rule file would silence the finding that says the rule
      // enforces nothing. Pinned by tests/helpers/exclusion-comments.ts.
      result = result.filter((v) => {
        if (v.bypassFilters === true) return true
        if (!isExcludedByComment(v, allComments)) return true
        // Disclose it. Silently dropping is what made this the only filter in
        // the pipeline a reader could not see — see `comment-suppression.ts`.
        recordCommentSuppression(v.ruleId ?? ctx.metadata?.id ?? '(unnamed rule)', v.file)
        return false
      })
    }

    // The exemption stands; what fails is the missing justification. That is
    // deliberate and it is what makes the remedy remediable: add a reason and
    // this finding clears while the exclusion keeps working. Refusing to apply
    // the exclusion instead would make the remedy "add a reason" produce a
    // DIFFERENT failure — the violation itself — which is a remedy that does
    // not remediate (ADR-008 rule 2).
    //
    // Unsuppressable, because a suppression mechanism that can suppress the
    // complaint about itself is not a mechanism.
    for (const warning of undocumented) {
      result.push({
        rule: ctx.metadata.id,
        ruleId: ctx.metadata.id,
        element: `${ctx.metadata.id}@${warning.file}:${String(warning.line)}`,
        file: warning.file,
        line: warning.line,
        message:
          `This exclusion states no reason, so nothing records why the rule is ` +
          `waived here — and it is silently suppressing a real finding.`,
        suggestion:
          `Add a reason: // ts-archunit-exclude ${ctx.metadata.id}: <why>. ` +
          `A reason is prose and nothing verifies it, so this raises the cost of a ` +
          `suppression rather than preventing one — the audience is the reviewer ` +
          `reading the diff. If the exemption is not justifiable, delete it and fix ` +
          `the finding instead. ${UNSUPPRESSABLE}`,
        // No explicit `severity`. `bypassFilters` already forces `error` through
        // `severityFor`, which every consumer path runs — `violations()`
        // (`terminal-builder.ts:229`), `executeCheck` and `executeWarn`. Setting
        // it here was dead: a sabotage row that flipped it to `warn` left the
        // suite green, because the flag overrode it downstream. A line that
        // reads load-bearing and is not is worse than no line.
        bypassFilters: true,
      })
    }
  }

  return result
}

/**
 * Stamp any un-stamped violation with a default severity (per-violation wins),
 * except a configuration meta-finding, which is always `error`.
 *
 * This is the site that mattered most and read as the safest: `?? severity`
 * looks conservative, but five of the six `bypassFilters` producers set no
 * severity at all, so on the `executeWarn` path every one of them resolved to
 * `warn` — a finding saying "this rule enforces nothing", reported as advice.
 */
function stampSeverity(violations: ArchViolation[], severity: 'error' | 'warn'): ArchViolation[] {
  return violations.map((v) => ({ ...v, severity: severityFor(v, v.severity ?? severity) }))
}

/**
 * Write a severity-aware, single-document report for the given format.
 *
 * Shared by the CLI runner and the throwing `check` terminal so the three
 * format branches live in one place:
 * - `json` ALWAYS emits one valid document (even with zero violations) so
 *   consumers/agents can parse a clean run.
 * - `github` partitions by severity so warnings render as `::warning`, not
 *   `::error`.
 * - terminal (default) writes the rich format to stderr.
 *
 * Terminal/github emit nothing when there are no violations.
 */
export function writeReport(
  violations: ArchViolation[],
  format?: OutputFormat,
  reason?: string,
  /** Allowlist rules that tested no edges, for the JSON document (bug 0015). */
  untested: readonly EdgeCoverage[] = [],
): void {
  if (format === 'json') {
    process.stdout.write(formatViolationsJson(violations, reason, untested) + '\n')
    return
  }
  if (violations.length === 0) return
  if (format === 'github') {
    const errors = violations.filter((v) => (v.severity ?? 'error') === 'error')
    const warnings = violations.filter((v) => v.severity === 'warn')
    const parts: string[] = []
    if (errors.length > 0) parts.push(formatViolationsGitHub(errors, 'error'))
    if (warnings.length > 0) parts.push(formatViolationsGitHub(warnings, 'warning'))
    process.stdout.write(parts.join('\n') + '\n')
  } else {
    writeStderr(formatViolations(violations, reason))
  }
}

/**
 * Whether a caller aggregates and reports every finding itself.
 *
 * The CLI does: it collects across all rule files and calls `writeReport` once, so a
 * per-rule terminal that also writes produces the finding twice — measured on the real
 * CLI as two `Architecture Violation [1 of 1]` blocks with identical content while
 * `--format json` said 1 (bug 0029).
 *
 * **Only the findings the aggregator can actually recover may be suppressed**, which
 * means only the ones that travel on the thrown `ArchRuleError`. A `.warn()` whose
 * violations are ordinary does not throw, and the CLI never calls `.violations()` on a
 * self-executing rule file — so those exist nowhere else and must always be written or
 * they are lost outright.
 *
 * Default false, because the in-test path has no aggregator: nothing catches the error
 * and re-renders it, so `ArchRuleError.message` — a one-line summary by design — would
 * be all a reader gets, losing the finding's message, its remedy and the sentence
 * saying it cannot be suppressed.
 */
let callerAggregatesReports = false

/**
 * Declare that the caller will report every finding itself. **CLI only.**
 *
 * Not an option on `CheckOptions`: a self-executing rule file passes no options, and
 * this is a property of who is driving the run rather than of any one rule.
 */
export function setCallerAggregatesReports(on: boolean): void {
  callerAggregatesReports = on
}

/**
 * Execute the terminal "check" action: apply options, format, throw on violations.
 */
export function executeCheck(
  violations: ArchViolation[],
  ctx: ExecuteRuleContext,
  options?: CheckOptions,
): void {
  let filtered = applyFilters(violations, ctx)

  if (options?.baseline) {
    filtered = options.baseline.filterNew(filtered)
  }
  if (options?.diff) {
    // Per rule, so no run total exists here — state the configuration once per
    // process instead of printing one line per rule (plan 0071,
    // `core/diff-disclosure.ts`).
    const before = filtered.length
    filtered = options.diff.filterToChanged(filtered)
    const notice = activeNotice(
      before - filtered.length,
      options.diff.size,
      options.diff.baseBranch,
    )
    if (notice !== undefined) writeStderr(notice)
  }

  if (filtered.length > 0) {
    const stamped = stampSeverity(filtered, 'error')
    writeReport(stamped, options?.format, ctx.reason)
    throw new ArchRuleError(stamped, ctx.reason)
  }
}

/**
 * Execute the terminal "warn" action: apply options, format, log to stderr.
 *
 * Advisory for ordinary violations, which are logged exactly as before and
 * never throw. **A `bypassFilters` configuration finding throws**, carrying
 * only those findings.
 *
 * `.warn()` says "this rule's violations are advisory". A finding that the
 * rule enforces nothing is not a violation of the rule — it reports that the
 * rule cannot fire — and there is nothing advisory about that. Leaving the
 * hole open would make `.warn()` the documented escape hatch for exactly the
 * class of finding this release exists to surface, on exactly the
 * gradual-adoption audience the docs point at it.
 *
 * The payload matters as much as the throw: an error carrying 200 warn-level
 * violations plus one meta-finding would make "these findings are true" false
 * for 200 of 201 entries. `.violations()` remains the non-throwing
 * programmatic surface.
 */
export function executeWarn(
  violations: ArchViolation[],
  ctx: ExecuteRuleContext,
  options?: CheckOptions,
): void {
  let filtered = applyFilters(violations, ctx)

  if (options?.baseline) {
    filtered = options.baseline.filterNew(filtered)
  }
  if (options?.diff) {
    // Per rule, so no run total exists here — state the configuration once per
    // process instead of printing one line per rule (plan 0071,
    // `core/diff-disclosure.ts`).
    const before = filtered.length
    filtered = options.diff.filterToChanged(filtered)
    const notice = activeNotice(
      before - filtered.length,
      options.diff.size,
      options.diff.baseBranch,
    )
    if (notice !== undefined) writeStderr(notice)
  }

  if (filtered.length > 0) {
    const stamped = stampSeverity(filtered, 'warn')
    const configFindings = stamped.filter((v) => v.bypassFilters === true)

    // Write only what the throw will NOT carry.
    //
    // This used to write `stamped` in full and then throw the configuration
    // findings, so those were reported twice: once here and once by whoever
    // caught the error and reported `error.violations`. Measured on the CLI —
    // two `Architecture Violation [1 of 1]` blocks with identical content, while
    // `--format json` said 1 (bug 0029).
    //
    // Splitting rather than skipping the write entirely, because the ordinary
    // warn-level violations are NOT on the error — it deliberately carries only
    // the configuration findings, so that "these findings are true" stays true
    // for every entry. Dropping the write would lose them.
    // The configuration findings ride on the throw, so an aggregator re-reports them
    // and writing here would duplicate. Everything else exists only here.
    const advisory = callerAggregatesReports
      ? stamped.filter((v) => v.bypassFilters !== true)
      : stamped
    if (advisory.length > 0) {
      if (options?.format === 'json') {
        writeStderr(formatViolationsJson(advisory, ctx.reason))
      } else if (options?.format === 'github') {
        process.stdout.write(formatViolationsGitHub(advisory, 'warning') + '\n')
      } else {
        writeStderr(formatViolations(advisory, ctx.reason))
      }
    }

    if (configFindings.length > 0) throw new ArchRuleError(configFindings, ctx.reason)
  }
}
