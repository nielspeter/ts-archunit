import { describe, it, expect } from 'vitest'
import { generateCodeFrame } from '../../src/core/code-frame.js'

const sampleSource = [
  'import { foo } from "bar"',
  '',
  'export class MyService {',
  '  private count = 0',
  '',
  '  getTotal(): number {',
  '    const raw = this.fetchRaw()',
  '    return parseInt(raw, 10)',
  '  }',
  '',
  '  fetchRaw(): string {',
  '    return "42"',
  '  }',
  '}',
].join('\n')

describe('generateCodeFrame', () => {
  it('generates a code frame with default 3-line context', () => {
    const frame = generateCodeFrame(sampleSource, 8)
    const lines = frame.split('\n')
    // 3 lines before + target + 3 lines after = 7
    expect(lines).toHaveLength(7)
    expect(frame).toContain('parseInt')
  })

  it('marks the target line with >', () => {
    const frame = generateCodeFrame(sampleSource, 8)
    const lines = frame.split('\n')
    const targetLine = lines.find((l) => l.includes('parseInt'))
    expect(targetLine).toBeDefined()
    expect(targetLine).toMatch(/^\s*>/)
    // Non-target lines should not have >
    const nonTargetLines = lines.filter((l) => !l.includes('parseInt'))
    for (const line of nonTargetLines) {
      expect(line).toMatch(/^\s{3}/)
    }
  })

  it('right-aligns line numbers in the gutter', () => {
    const frame = generateCodeFrame(sampleSource, 8)
    const lines = frame.split('\n')
    // Line numbers 5-11 — all should have width 2
    for (const line of lines) {
      // Format: "  > NN | " or "    NN | "
      expect(line).toMatch(/^\s{2}[> ]\s+\d+\s\|/)
    }
  })

  it('clamps context at file start (target near line 1)', () => {
    const frame = generateCodeFrame(sampleSource, 1)
    const lines = frame.split('\n')
    // Line 1 with 3 lines after = 4 lines total (no lines before)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/>\s+1\s\|/)
  })

  it('clamps context at file end (target near last line)', () => {
    const totalLines = sampleSource.split('\n').length
    const frame = generateCodeFrame(sampleSource, totalLines)
    const lines = frame.split('\n')
    // 3 lines before + target = 4 lines (no lines after)
    expect(lines).toHaveLength(4)
    expect(lines[lines.length - 1]).toMatch(/>\s+\d+\s\|/)
  })

  it('respects custom contextLines option', () => {
    const frame = generateCodeFrame(sampleSource, 8, { contextLines: 1 })
    const lines = frame.split('\n')
    // 1 before + target + 1 after = 3
    expect(lines).toHaveLength(3)
  })

  it('returns empty string for out-of-range line (0)', () => {
    expect(generateCodeFrame(sampleSource, 0)).toBe('')
  })

  it('returns empty string for out-of-range line (beyond length)', () => {
    const totalLines = sampleSource.split('\n').length
    expect(generateCodeFrame(sampleSource, totalLines + 1)).toBe('')
  })

  it('handles single-line file', () => {
    const frame = generateCodeFrame('const x = 1', 1)
    expect(frame).toContain('const x = 1')
    expect(frame).toMatch(/>\s+1\s\|/)
    expect(frame.split('\n')).toHaveLength(1)
  })

  it('handles empty source text', () => {
    expect(generateCodeFrame('', 1)).toBe('')
  })
})
