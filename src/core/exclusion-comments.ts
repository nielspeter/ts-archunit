import path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
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
  /**
   * What kind of fault this is, so a caller can act on it differently.
   *
   * `'undocumented'` — the directive is well-formed and **applied**; it just
   * states no reason. Since v0.38.0 this fails the build ([bug 0039](../../bugs/fixed/0039-an-undocumented-exclusion-comment-suppresses-and-only-warns.md)),
   * because a suppression nobody justified is the marker ADR-008 rule 3's
   * corollary warns about.
   *
   * `'malformed'` — the directive is broken syntax and was **not** applied. Two
   * of the three malformed shapes therefore leave the original violation firing,
   * so the build is already red and a stderr line is the right weight.
   */
  kind: 'undocumented' | 'malformed'
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

// A directive must BEGIN its comment. The regexes are anchored at `^` and the
// caller slices each line from its first `//`, so they see the comment and
// nothing before it — which keeps the documented TRAILING form working
// (`const a = 1 // <directive>`), where the comment starts mid-line. Anchoring
// to the start of the LINE instead was the first attempt and broke exactly
// that; the guard's trailing rows caught it.
//
// It used to match anywhere in the line, which made any comment *mentioning*
// the syntax a live directive. This file's own grammar documentation was one:
// a line reading "Single-line without reason: <the directive>" declared a
// real, reason-less exclusion against whatever rule was being evaluated, and
// this repo's preset fan-out test caught it the moment comments started being
// read correctly. Every user documenting the feature in a code comment would
// have hit the same thing.
//
// A trailing directive still works — `const a = 1 // <directive>` — because
// there the comment itself begins with it.
const SINGLE_LINE_RE = /^\/\/\s*ts-archunit-exclude\s+(.+)/

// Block start: // ts-archunit-exclude-start <rule-id>[, <rule-id>]: <reason>
const BLOCK_START_RE = /^\/\/\s*ts-archunit-exclude-start\s+(.+)/

// Block end: // ts-archunit-exclude-end
const BLOCK_END_RE = /^\/\/\s*ts-archunit-exclude-end\b/

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
  frames: ExclusionComment[][],
  exclusions: ExclusionComment[],
  warnings: ExclusionWarning[],
  filePath: string,
  lineNum: number,
): void {
  const innermost = frames.pop()
  if (innermost === undefined) {
    warnings.push({
      message: `ts-archunit-exclude-end without matching start`,
      file: filePath,
      line: lineNum,
      kind: 'malformed',
    })
    return
  }

  // Close the innermost frame only. This used to close **every** open block,
  // which is how a nested region silently ended its parent early (bug 0039):
  // the inner `-end` closed the outer, and everything after it was unexcluded
  // while looking excluded in the source.
  for (const comment of innermost) {
    comment.endLine = lineNum
    exclusions.push(comment)
  }
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
      kind: 'undocumented',
    })
  }
}

/** Handle a block-start directive line. */
function handleBlockStart(
  content: string,
  frames: ExclusionComment[][],
  warnings: ExclusionWarning[],
  filePath: string,
  lineNum: number,
): void {
  const { ruleIds, reason } = parseRuleIdsAndReason(content)

  if (reason === '') {
    warnUndocumented(warnings, ruleIds, 'ts-archunit-exclude-start', filePath, lineNum)
  }

  // Nesting a DIFFERENT rule is legitimate and used to be refused outright —
  // exempting `arch/no-cycles` across a module and `arch/no-any` across one
  // function inside it is an ordinary thing to want. The old code warned and
  // dropped the inner directive, then let the inner `-end` close the outer
  // block, so both exemptions were wrong: the inner never applied and the outer
  // stopped early. Frames make both work.
  //
  // Re-opening a rule that is ALREADY open is different — it is redundant, and
  // the likeliest cause is a missing `-end`. Warned, but still pushed: refusing
  // it is what produced the early-close bug.
  const alreadyOpen = new Set(frames.flat().map((c) => c.ruleId))
  for (const ruleId of ruleIds) {
    if (alreadyOpen.has(ruleId)) {
      warnings.push({
        message:
          `ts-archunit-exclude-start for '${ruleId}' is already open — ` +
          `the enclosing block covers this region. Fix: remove this directive, ` +
          `or close the enclosing block first if the nesting was unintended.`,
        file: filePath,
        line: lineNum,
        kind: 'malformed',
      })
    }
  }

  frames.push(
    ruleIds.map((ruleId) => ({
      ruleId,
      reason,
      file: filePath,
      line: lineNum,
      isBlock: true,
    })),
  )
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
/**
 * Every string-like literal, blanked — [bug 0043](../../bugs/fixed/0043-an-exclusion-directive-inside-a-string-literal-suppresses.md).
 *
 * The scan below is line-based, and a line-based scan cannot tell a directive
 * from the same characters inside a string. Measured before this existed: all
 * three of `"…"`, `'…'` and `` `…` `` containing the directive text produced a
 * **live exclusion** that silenced a real finding — silently, because a
 * directive carrying a reason never triggers the undocumented-exclusion warning.
 *
 * **Newlines are preserved**, and that is the load-bearing part: the scan below
 * is line-based and reports `line` on every exclusion, so a mask that dropped a
 * newline would misreport every directive after it.
 *
 * Characters are replaced with spaces rather than removed, which keeps
 * intra-line offsets stable too — but nothing downstream consumes a column, so
 * that half is defence in depth rather than a guarded property. Measured:
 * collapsing the blanks to `''`, and masking one character short, both leave the
 * suite green. Recorded rather than dressed up — a sabotage row that survives
 * for a real reason is a different thing from a missing guard.
 *
 * ## Why a parse, and not a scan
 *
 * The first attempt used `ts.createScanner`, which is the real lexer and fixed
 * the three plain cases. It left two: `` `${x} // …` `` and JSX text. A bare
 * scanner has no parser context, so it cannot know when to re-scan a template
 * middle or JSX children, and both were classified as code — meaning the `//`
 * inside them became a comment. Measured, not predicted.
 *
 * So: parse, and blank the literals. Everything remaining is code, where `//`
 * genuinely does start a comment.
 *
 * A **ts-morph** project rather than the raw compiler API, per
 * [ADR-002](../../adr/002-ts-morph-ast-engine.md), reusing one in-memory project
 * across calls so the cost is a parse rather than a project construction. The
 * whole scan is gated on a rule having already produced a violation in the file,
 * so nothing is parsed for a clean run.
 *
 * A `TemplateExpression` is blanked **whole**, including its `${…}`
 * substitutions. A comment is legal inside a substitution, so this can miss a
 * real directive there — it errs toward *not* suppressing, which is the safe
 * direction for a mechanism whose failure mode is a silent green.
 */
const LITERAL_KINDS = [
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateExpression,
  SyntaxKind.RegularExpressionLiteral,
  SyntaxKind.JsxText,
] as const

let scratch: Project | undefined

function withoutLiterals(sourceText: string, filePath: string): string {
  scratch ??= new Project({ useInMemoryFileSystem: true })
  // `.tsx` so JSX parses; a `.ts` parse reads `<div>` as a type assertion and
  // the JsxText case silently stops being covered.
  const sourceFile = scratch.createSourceFile(`/scan/${path.basename(filePath)}.tsx`, sourceText, {
    overwrite: true,
  })

  const out = sourceText.split('')
  for (const kind of LITERAL_KINDS) {
    for (const node of sourceFile.getDescendantsOfKind(kind)) {
      for (let i = node.getStart(); i < node.getEnd(); i++) {
        if (out[i] !== undefined && out[i] !== '\n') out[i] = ' '
      }
    }
  }
  const withoutLiteralText = out.join('')

  // Block comments too, and this is not tidying — it is the difference between
  // documenting the feature and invoking it.
  //
  // The grammar is `//`-only and always has been (a `/* … */` directive produced
  // no exclusion before this fix and still produces none). But a JSDoc block
  // that *mentions* the directive in prose puts the characters on a line, and
  // the line scan below cannot tell prose from a directive.
  //
  // Found the hard way: this very file's docstring explains the bug, contains
  // the directive text, and the moment comments started being read correctly it
  // declared a live exclusion against `preset/boundaries/no-cross-boundary` —
  // caught by this repo's own preset fan-out test. Any user writing a code
  // comment about the feature would hit the same thing.
  //
  // Safe to do with a regex here, and only here: every string, template and
  // regex literal has already been blanked, so a surviving `/*` is a real
  // block-comment start.
  return withoutLiteralText.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

export function parseExclusionComments(sourceText: string, filePath: string): ParseResult {
  // A directive inside a string is not a directive (bug 0043).
  const lines = withoutLiterals(sourceText, filePath).split('\n')
  const exclusions: ExclusionComment[] = []
  const warnings: ExclusionWarning[] = []
  // A STACK of frames, one per `-start` line, each holding that line's rule ids.
  // One `-end` closes one frame. A single-level block behaves exactly as before;
  // nesting now works instead of silently mangling both regions.
  const frames: ExclusionComment[][] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const lineNum = i + 1

    // Slice from the comment start. Literals are already blanked, so the first
    // `//` on the line is a real comment opener — and anything before it is
    // code, which cannot contain a directive.
    const commentStart = line.indexOf('//')
    if (commentStart === -1) continue
    const comment = line.slice(commentStart)

    // Check block end first (before start/single so we don't match -start as single)
    if (BLOCK_END_RE.test(comment)) {
      handleBlockEnd(frames, exclusions, warnings, filePath, lineNum)
      continue
    }

    // Check block start
    const startMatch = BLOCK_START_RE.exec(comment)
    if (startMatch?.[1]) {
      handleBlockStart(startMatch[1], frames, warnings, filePath, lineNum)
      continue
    }

    // Check single-line exclude (must not match block directives)
    const singleMatch = SINGLE_LINE_RE.exec(comment)
    if (singleMatch?.[1]) {
      handleSingleLine(singleMatch[1], exclusions, warnings, filePath, lineNum)
    }
  }

  // Any unclosed frame is an error, and pushes no exclusion — so an unterminated
  // block fails closed: the violation it meant to cover still fires.
  for (const comment of frames.flat()) {
    warnings.push({
      message: `ts-archunit-exclude-start without matching end for rule '${comment.ruleId}'`,
      file: filePath,
      line: comment.line,
      kind: 'malformed',
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
