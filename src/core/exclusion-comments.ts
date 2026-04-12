import type { ArchViolation } from './violation.js'

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

/** Handle a block-end directive line. */
function handleBlockEnd(
  openBlocks: Map<string, ExclusionComment>,
  exclusions: ExclusionComment[],
  warnings: ExclusionWarning[],
  filePath: string,
  lineNum: number,
): void {
  if (openBlocks.size === 0) {
    warnings.push({
      message: `ts-archunit-exclude-end without matching start`,
      file: filePath,
      line: lineNum,
    })
    return
  }

  for (const [, comment] of openBlocks) {
    comment.endLine = lineNum
    exclusions.push(comment)
  }
  openBlocks.clear()
}

/** Emit undocumented-exclusion warnings for each rule ID when no reason is given. */
function warnUndocumented(
  warnings: ExclusionWarning[],
  ruleIds: string[],
  directive: string,
  filePath: string,
  lineNum: number,
): void {
  for (const ruleId of ruleIds) {
    warnings.push({
      message:
        `Undocumented exclusion at ${filePath}:${String(lineNum)} — ` +
        `// ${directive} ${ruleId}\n` +
        `  Fix: Add a reason — // ${directive} ${ruleId}: <why>`,
      file: filePath,
      line: lineNum,
    })
  }
}

/** Handle a block-start directive line. */
function handleBlockStart(
  content: string,
  openBlocks: Map<string, ExclusionComment>,
  warnings: ExclusionWarning[],
  filePath: string,
  lineNum: number,
): void {
  if (openBlocks.size > 0) {
    warnings.push({
      message: `Nested ts-archunit-exclude-start — close existing block first`,
      file: filePath,
      line: lineNum,
    })
    return
  }

  const { ruleIds, reason } = parseRuleIdsAndReason(content)

  if (reason === '') {
    warnUndocumented(warnings, ruleIds, 'ts-archunit-exclude-start', filePath, lineNum)
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
}

/** Handle a single-line exclude directive. */
function handleSingleLine(
  content: string,
  exclusions: ExclusionComment[],
  warnings: ExclusionWarning[],
  filePath: string,
  lineNum: number,
): void {
  // Skip if this was a block start or end (already handled above, but guard)
  if (content.startsWith('-start') || content.startsWith('-end')) return

  const { ruleIds, reason } = parseRuleIdsAndReason(content)

  if (reason === '') {
    warnUndocumented(warnings, ruleIds, 'ts-archunit-exclude', filePath, lineNum)
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
  const openBlocks = new Map<string, ExclusionComment>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const lineNum = i + 1

    // Check block end first (before start/single so we don't match -start as single)
    if (BLOCK_END_RE.test(line)) {
      handleBlockEnd(openBlocks, exclusions, warnings, filePath, lineNum)
      continue
    }

    // Check block start
    const startMatch = BLOCK_START_RE.exec(line)
    if (startMatch?.[1]) {
      handleBlockStart(startMatch[1], openBlocks, warnings, filePath, lineNum)
      continue
    }

    // Check single-line exclude (must not match block directives)
    const singleMatch = SINGLE_LINE_RE.exec(line)
    if (singleMatch?.[1]) {
      handleSingleLine(singleMatch[1], exclusions, warnings, filePath, lineNum)
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
/** Check if a single comment covers the given violation. */
function commentCoversViolation(comment: ExclusionComment, violationLine: number): boolean {
  if (comment.isBlock) {
    return (
      comment.endLine !== undefined &&
      violationLine >= comment.line &&
      violationLine <= comment.endLine
    )
  }
  return violationLine === comment.line + 1
}

export function isExcludedByComment(
  violation: ArchViolation,
  comments: ExclusionComment[],
): boolean {
  const ruleId = violation.ruleId
  if (!ruleId) return false

  return comments.some(
    (comment) =>
      comment.ruleId === ruleId &&
      comment.file === violation.file &&
      commentCoversViolation(comment, violation.line),
  )
}
