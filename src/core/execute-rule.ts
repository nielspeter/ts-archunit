import fs from 'node:fs'
import type { ArchViolation } from './violation.js'
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
    result = result.filter((v) => {
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
      if (!matchedPatterns.has(index) && !silentIndices.has(index)) {
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
      result = result.filter((v) => !isExcludedByComment(v, allComments))
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
      suggestion: v.suggestion ?? meta?.suggestion,
      docs: v.docs ?? meta?.docs,
    }))
  }

  return result
}

/** Stamp any un-stamped violation with a default severity (per-violation wins). */
function stampSeverity(violations: ArchViolation[], severity: 'error' | 'warn'): ArchViolation[] {
  return violations.map((v) => ({ ...v, severity: v.severity ?? severity }))
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
 * Advisory — writes to stderr (json/terminal) and never throws.
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
  }
}
