import { describe, it, expect } from 'vitest'
import type { ArchViolation } from '../../src/core/violation.js'
import { DiffFilter } from '../../src/helpers/diff-aware.js'

function makeViolation(file: string, element: string = 'TestElement'): ArchViolation {
  return {
    rule: 'test rule',
    element,
    file,
    line: 1,
    message: 'test message',
  }
}

describe('DiffFilter.filterToChanged (extended)', () => {
  it('returns all violations when all files are in changed set', () => {
    const changedFiles = new Set(['/a.ts', '/b.ts'])
    const filter = new DiffFilter(changedFiles)
    const violations = [makeViolation('/a.ts'), makeViolation('/b.ts')]
    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(2)
  })

  it('returns empty when no violations match changed files', () => {
    const changedFiles = new Set(['/x.ts'])
    const filter = new DiffFilter(changedFiles)
    const violations = [makeViolation('/a.ts'), makeViolation('/b.ts')]
    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(0)
  })

  it('handles mixed matches and non-matches', () => {
    const changedFiles = new Set(['/a.ts', '/c.ts'])
    const filter = new DiffFilter(changedFiles)
    const violations = [
      makeViolation('/a.ts', 'A'),
      makeViolation('/b.ts', 'B'),
      makeViolation('/c.ts', 'C'),
      makeViolation('/d.ts', 'D'),
    ]
    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(2)
    expect(result.map((v) => v.element)).toEqual(['A', 'C'])
  })

  it('works with empty violations array', () => {
    const changedFiles = new Set(['/a.ts'])
    const filter = new DiffFilter(changedFiles)
    const result = filter.filterToChanged([])
    expect(result).toHaveLength(0)
  })

  it('handles duplicate files in violations', () => {
    const changedFiles = new Set(['/a.ts'])
    const filter = new DiffFilter(changedFiles)
    const violations = [
      makeViolation('/a.ts', 'A1'),
      makeViolation('/a.ts', 'A2'),
      makeViolation('/b.ts', 'B'),
    ]
    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(2)
    expect(result.map((v) => v.element)).toEqual(['A1', 'A2'])
  })

  it('preserves violation metadata', () => {
    const changedFiles = new Set(['/a.ts'])
    const filter = new DiffFilter(changedFiles)
    const violation: ArchViolation = {
      rule: 'my rule',
      element: 'Elem',
      file: '/a.ts',
      line: 42,
      message: 'test msg',
      because: 'some reason',
    }
    const result = filter.filterToChanged([violation])
    expect(result[0]).toBe(violation)
    expect(result[0]!.because).toBe('some reason')
  })

  it('size is 0 for empty changed set', () => {
    const filter = new DiffFilter(new Set())
    expect(filter.size).toBe(0)
  })

  it('size counts unique files', () => {
    const filter = new DiffFilter(new Set(['/a.ts', '/b.ts', '/c.ts']))
    expect(filter.size).toBe(3)
  })
})
