import type { ArchViolation } from '../core/violation.js'

/**
 * Exclusion comment parsed from source code.
 */
export interface ExclusionComment {
  /** Rule ID being excluded */
  ruleId: string
  /** Required reason for the exclusion */
  reason: string
  /** File path where the comment was found */
  file: string
  /** Line number of the comment */
  line: number
  /** Whether this is a block exclusion (start/end) */
  isBlock: boolean
  /** End line for block exclusions */
  endLine?: number
}

/**
 * Validation warning for exclusion comments.
 */
export interface ExclusionWarning {
  /** Warning message */
  message: string
  /** File path */
  file: string
  /** Line number */
  line: number
}

/**
 * Result of parsing exclusion comments from a source file.
 */
export interface ParseResult {
  /** Successfully parsed exclusion comments */
  exclusions: ExclusionComment[]
  /** Warnings about malformed comments */
  warnings: ExclusionWarning[]
}

// Single-line: // ts-archunit-exclude <rule-id>[, <rule-id>]: <reason>
// Single-line without reason: // ts-archunit-exclude <rule-id>
const SINGLE_LINE_RE = /\/\/\s*ts-archunit-exclude\s+(.+)/

// Block start: // ts-archunit-exclude-start <rule-id>[, <rule-id>]: <reason>
const BLOCK_START_RE = /\/\/\s*ts-archunit-exclude-start\s+(.+)/

// Block end: // ts-archunit-exclude-end
const BLOCK_END_RE = /\/\/\s*ts-archunit-exclude-end\b/

/**
 * Parse rule IDs and reason from the content after the directive keyword.
 *
 * Format: `rule-a, rule-b: reason text`
 * If no colon is present, all content is treated as rule IDs and reason is empty.
 */
function parseRuleIdsAndReason(content: string): { ruleIds: string[]; reason: string } {
  const colonIndex = content.indexOf(':')
  if (colonIndex < 0) {
    // No colon — all content is rule IDs, no reason
    const ruleIds = content
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return { ruleIds, reason: '' }
  }

  const idsPart = content.slice(0, colonIndex)
  const reason = content.slice(colonIndex + 1).trim()
  const ruleIds = idsPart
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  return { ruleIds, reason }
}

/**
 * Scan a source file for ts-archunit exclusion comments.
 *
 * Supported formats:
 *   // ts-archunit-exclude <rule-id>: <reason>
 *   // ts-archunit-exclude-start <rule-id>: <reason>
 *   // ts-archunit-exclude-end
 *   // ts-archunit-exclude <rule-a>, <rule-b>: <reason>
 */
export function parseExclusionComments(sourceText: string, filePath: string): ParseResult {
  const lines = sourceText.split('\n')
  const exclusions: ExclusionComment[] = []
  const warnings: ExclusionWarning[] = []

  // Track open block starts: map from ruleId to the ExclusionComment (incomplete)
  const openBlocks = new Map<string, ExclusionComment>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const lineNum = i + 1

    // Check block end first (before start/single so we don't match -start as single)
    const endMatch = BLOCK_END_RE.exec(line)
    if (endMatch) {
      if (openBlocks.size === 0) {
        warnings.push({
          message: `ts-archunit-exclude-end without matching start`,
          file: filePath,
          line: lineNum,
        })
      } else {
        // Close all open blocks at this end line
        for (const [, comment] of openBlocks) {
          comment.endLine = lineNum
          exclusions.push(comment)
        }
        openBlocks.clear()
      }
      continue
    }

    // Check block start
    const startMatch = BLOCK_START_RE.exec(line)
    if (startMatch) {
      const content = startMatch[1]
      if (!content) continue

      if (openBlocks.size > 0) {
        warnings.push({
          message: `Nested ts-archunit-exclude-start — close existing block first`,
          file: filePath,
          line: lineNum,
        })
        continue
      }

      const { ruleIds, reason } = parseRuleIdsAndReason(content)

      if (reason === '') {
        for (const ruleId of ruleIds) {
          warnings.push({
            message:
              `Undocumented exclusion at ${filePath}:${String(lineNum)} — ` +
              `// ts-archunit-exclude-start ${ruleId}\n` +
              `  Fix: Add a reason — // ts-archunit-exclude-start ${ruleId}: <why>`,
            file: filePath,
            line: lineNum,
          })
        }
      }

      for (const ruleId of ruleIds) {
        openBlocks.set(ruleId, {
          ruleId,
          reason,
          file: filePath,
          line: lineNum,
          isBlock: true,
        })
      }
      continue
    }

    // Check single-line exclude (must not match block directives)
    const singleMatch = SINGLE_LINE_RE.exec(line)
    if (singleMatch) {
      const content = singleMatch[1]
      if (!content) continue

      // Skip if this was a block start or end (already handled above, but guard)
      if (content.startsWith('-start') || content.startsWith('-end')) continue

      const { ruleIds, reason } = parseRuleIdsAndReason(content)

      if (reason === '') {
        for (const ruleId of ruleIds) {
          warnings.push({
            message:
              `Undocumented exclusion at ${filePath}:${String(lineNum)} — ` +
              `// ts-archunit-exclude ${ruleId}\n` +
              `  Fix: Add a reason — // ts-archunit-exclude ${ruleId}: <why>`,
            file: filePath,
            line: lineNum,
          })
        }
      }

      for (const ruleId of ruleIds) {
        exclusions.push({
          ruleId,
          reason,
          file: filePath,
          line: lineNum,
          isBlock: false,
        })
      }
    }
  }

  // Any unclosed blocks are errors
  for (const [, comment] of openBlocks) {
    warnings.push({
      message: `ts-archunit-exclude-start without matching end for rule '${comment.ruleId}'`,
      file: filePath,
      line: comment.line,
    })
  }

  return { exclusions, warnings }
}

/**
 * Check if a violation is covered by an exclusion comment.
 *
 * For single-line comments: the violation must be in the same file and
 * on the line immediately after the comment.
 *
 * For block comments: the violation must be in the same file and
 * within the line range (start line, end line) inclusive.
 */
export function isExcludedByComment(
  violation: ArchViolation,
  comments: ExclusionComment[],
): boolean {
  const ruleId = violation.ruleId
  if (!ruleId) return false

  for (const comment of comments) {
    if (comment.ruleId !== ruleId) continue
    if (comment.file !== violation.file) continue

    if (comment.isBlock) {
      // Block exclusion: violation line must be within the block range
      if (
        comment.endLine !== undefined &&
        violation.line >= comment.line &&
        violation.line <= comment.endLine
      ) {
        return true
      }
    } else {
      // Single-line exclusion: violation must be on the next line after the comment
      if (violation.line === comment.line + 1) {
        return true
      }
    }
  }

  return false
}
