import fs from 'node:fs'
import type { ArchViolation } from './violation.js'
import { severityFor } from './violation.js'
import type { CheckOptions, OutputFormat } from './check-options.js'
import type { RuleMetadata } from './rule-metadata.js'
import { ArchRuleError } from './errors.js'
import { formatViolations } from './format.js'
import { formatViolationsJson } from './format-json.js'
import { formatViolationsGitHub } from './format-github.js'
import { parseExclusionComments, isExcludedByComment } from './exclusion-comments.js'

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
 * Apply exclusion patterns, inline exclusion comments, baseline,
 * and diff filtering to a set of violations, then execute the
 * terminal action (throw or warn).
 *
 * Extracted to eliminate terminal-method duplication across builders.
 */
export function applyFilters(
  violations: ArchViolation[],
  ctx: ExecuteRuleContext,
): ArchViolation[] {
  let result = violations

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
        console.warn(
          `[ts-archunit] Exclusion '${String(pattern)}' in rule '${ruleId}' matched a ` +
            `configuration finding, which cannot be excluded — that finding reports the ` +
            `rule enforces nothing. Fix the rule's selector instead.`,
        )
      } else if (!matchedPatterns.has(index) && !silentIndices.has(index)) {
        console.warn(
          `[ts-archunit] Unused exclusion '${String(pattern)}' in rule '${ruleId}'. ` +
            `It matched zero violations — it may be stale after a rename.`,
        )
      }
    })
  }

  // Scan source files for inline exclusion comments (when rule has an ID)
  if (ctx.metadata?.id && result.length > 0) {
    const filePaths = new Set(result.map((v) => v.file))
    const allComments = [...filePaths].flatMap((filePath) => {
      try {
        const sourceText = fs.readFileSync(filePath, 'utf-8')
        const parseResult = parseExclusionComments(sourceText, filePath)
        for (const warning of parseResult.warnings) {
          console.warn(`[ts-archunit] ${warning.message}`)
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
      // The moment one carries a real path — and `doctor` reporting glob
      // origins is exactly that temptation — an `// arch-ignore` would
      // silently suppress the finding that says the rule enforces nothing.
      result = result.filter(
        (v) => v.bypassFilters === true || !isExcludedByComment(v, allComments),
      )
    }
  }

  // Enrich each violation with rule-level metadata so a rule author's
  // `.rule({ id, because, suggestion, docs })` (or `.because()`) reaches
  // per-violation output — e.g. the agent's `check --format json` payload —
  // when the condition did not set its own. Per-violation values take precedence.
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
      // `ruleId` and `because` stay. Neither asserts a remedy: the id says WHICH
      // rule enforces nothing, which is the first thing the reader needs, and
      // `because` states why the rule exists, which is context rather than a
      // claim about this finding's cause. A producer that wants a remedy sets its
      // own — `metaViolation` sets `docs: GLOB_DOCS`, which is about the fault.
      suggestion: v.bypassFilters ? v.suggestion : (v.suggestion ?? meta?.suggestion),
      docs: v.bypassFilters ? v.docs : (v.docs ?? meta?.docs),
    }))
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
): void {
  if (format === 'json') {
    process.stdout.write(formatViolationsJson(violations, reason) + '\n')
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
    process.stderr.write(formatViolations(violations, reason) + '\n')
  }
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
    filtered = options.diff.filterToChanged(filtered)
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
    filtered = options.diff.filterToChanged(filtered)
  }

  if (filtered.length > 0) {
    const stamped = stampSeverity(filtered, 'warn')
    if (options?.format === 'json') {
      console.warn(formatViolationsJson(stamped, ctx.reason))
    } else if (options?.format === 'github') {
      process.stdout.write(formatViolationsGitHub(stamped, 'warning') + '\n')
    } else {
      console.warn(formatViolations(stamped, ctx.reason))
    }

    // Logged first, then thrown: the ordinary violations still reach the
    // reader on the surface they chose, and only the configuration findings
    // reach the error.
    const configFindings = stamped.filter((v) => v.bypassFilters === true)
    if (configFindings.length > 0) throw new ArchRuleError(configFindings, ctx.reason)
  }
}
