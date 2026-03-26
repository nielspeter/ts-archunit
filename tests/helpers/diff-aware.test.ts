import { describe, it, expect } from 'vitest'
import type { ArchViolation } from '../../src/core/violation.js'
import { DiffFilter } from '../../src/helpers/diff-aware.js'

// --- Helpers ---

function makeViolation(file: string, element: string = 'TestElement'): ArchViolation {
  return {
    rule: 'test rule',
    element,
    file,
    line: 1,
    message: 'test message',
  }
}

describe('DiffFilter', () => {
  it('filterToChanged returns only violations in changed files', () => {
    const changedFiles = new Set(['/project/src/a.ts', '/project/src/b.ts'])
    const filter = new DiffFilter(changedFiles)

    const violations = [
      makeViolation('/project/src/a.ts', 'A'),
      makeViolation('/project/src/b.ts', 'B'),
      makeViolation('/project/src/c.ts', 'C'),
      makeViolation('/project/src/a.ts', 'A2'),
      makeViolation('/project/src/d.ts', 'D'),
    ]

    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(3)
    expect(result.map((v) => v.element)).toEqual(['A', 'B', 'A2'])
  })

  it('filterToChanged returns empty for no changes', () => {
    const filter = new DiffFilter(new Set())
    const violations = [makeViolation('/project/src/a.ts'), makeViolation('/project/src/b.ts')]

    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(0)
  })

  it('size reflects number of changed files', () => {
    const filter = new DiffFilter(new Set(['/project/src/a.ts', '/project/src/b.ts']))
    expect(filter.size).toBe(2)
  })
})
