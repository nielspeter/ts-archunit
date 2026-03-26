/**
 * Options for code frame generation.
 */
export interface CodeFrameOptions {
  /** Number of context lines before and after the target line. Default: 3 */
  contextLines?: number
}

/**
 * Generate a code frame showing source context around a target line.
 *
 * @param sourceText - Full source file text
 * @param targetLine - 1-based line number to highlight
 * @param options - Context line count
 * @returns Formatted code frame string, or empty string if targetLine is out of range
 */
export function generateCodeFrame(
  sourceText: string,
  targetLine: number,
  options?: CodeFrameOptions,
): string {
  const contextLines = options?.contextLines ?? 3
  if (sourceText === '') {
    return ''
  }

  const lines = sourceText.split('\n')

  if (targetLine < 1 || targetLine > lines.length) {
    return ''
  }

  const start = Math.max(0, targetLine - 1 - contextLines)
  const end = Math.min(lines.length, targetLine + contextLines)

  // Determine gutter width from the largest line number in the range
  const gutterWidth = String(end).length

  const frameLines: string[] = []
  for (let i = start; i < end; i++) {
    const lineNum = i + 1
    const isTarget = lineNum === targetLine
    const marker = isTarget ? '>' : ' '
    const paddedNum = String(lineNum).padStart(gutterWidth)
    frameLines.push(`  ${marker} ${paddedNum} | ${lines[i]}`)
  }

  return frameLines.join('\n')
}
