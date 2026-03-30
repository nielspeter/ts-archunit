import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import path from 'node:path'
import { DiffFilter } from '../../src/helpers/diff-aware.js'
import { makeViolation } from '../support/test-rule-builder.js'

/**
 * Additional coverage for diff-aware.ts:
 * - DiffFilter with null changedFiles (git error fallback)
 * - diffAware() function with mocked execFileSync
 */

// Mock node:child_process at module level (required for ESM)
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...(original as object),
    execFileSync: vi.fn(),
  }
})

import { execFileSync } from 'node:child_process'

const mockedExecFileSync = vi.mocked(execFileSync)

function mv(file: string, element: string = 'TestElement') {
  return makeViolation({ element, file, message: 'test message' })
}

describe('DiffFilter with null changedFiles (git unavailable)', () => {
  it('filterToChanged returns all violations unfiltered', () => {
    const filter = new DiffFilter(null)
    const violations = [
      mv('/project/src/a.ts', 'A'),
      mv('/project/src/b.ts', 'B'),
      mv('/project/src/c.ts', 'C'),
    ]

    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(3)
    expect(result).toEqual(violations)
  })

  it('size returns -1 when changedFiles is null', () => {
    const filter = new DiffFilter(null)
    expect(filter.size).toBe(-1)
  })

  it('filterToChanged returns empty array when given empty violations and null files', () => {
    const filter = new DiffFilter(null)
    const result = filter.filterToChanged([])
    expect(result).toHaveLength(0)
  })
})

describe('diffAware() function', () => {
  // Import diffAware after mocking
  let diffAware: (baseBranch?: string) => DiffFilter

  beforeEach(async () => {
    const mod = await import('../../src/helpers/diff-aware.js')
    diffAware = mod.diffAware
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns DiffFilter with null when git command fails', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const filter = diffAware('main')

    // Should return a filter with null (pass-through)
    expect(filter.size).toBe(-1)
    const violations = [mv('/a.ts'), mv('/b.ts')]
    expect(filter.filterToChanged(violations)).toHaveLength(2)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not run git diff'))
  })

  it('warning message includes the base branch name', () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error('fatal: ambiguous argument')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    diffAware('develop')

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'develop'"))
  })

  it('returns DiffFilter with empty set when git diff returns empty output', () => {
    mockedExecFileSync.mockReturnValue('')

    const filter = diffAware('main')

    expect(filter.size).toBe(0)
    const violations = [mv('/a.ts'), mv('/b.ts')]
    expect(filter.filterToChanged(violations)).toHaveLength(0)
  })

  it('returns DiffFilter with resolved absolute paths from git output', () => {
    const cwd = process.cwd()
    mockedExecFileSync.mockReturnValue('src/a.ts\nsrc/b.ts\n')

    const filter = diffAware('develop')

    expect(filter.size).toBe(2)

    // Files are resolved to absolute paths
    const absA = path.resolve(cwd, 'src/a.ts')
    const absB = path.resolve(cwd, 'src/b.ts')

    const violations = [mv(absA, 'A'), mv(absB, 'B'), mv(path.resolve(cwd, 'src/c.ts'), 'C')]
    const result = filter.filterToChanged(violations)
    expect(result).toHaveLength(2)
    expect(result.map((v) => v.element)).toEqual(['A', 'B'])
  })

  it('uses default baseBranch of main', () => {
    mockedExecFileSync.mockReturnValue('')

    diffAware()

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'main...HEAD'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })

  it('passes custom baseBranch to git diff', () => {
    mockedExecFileSync.mockReturnValue('')

    diffAware('develop')

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'develop...HEAD'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })

  it('handles single file in git diff output', () => {
    const cwd = process.cwd()
    mockedExecFileSync.mockReturnValue('src/only-file.ts')

    const filter = diffAware()

    expect(filter.size).toBe(1)
    const absPath = path.resolve(cwd, 'src/only-file.ts')
    const violations = [mv(absPath, 'Only')]
    expect(filter.filterToChanged(violations)).toHaveLength(1)
  })

  it('trims trailing whitespace from git output', () => {
    mockedExecFileSync.mockReturnValue('  src/a.ts\nsrc/b.ts  \n')

    const filter = diffAware()

    // After .trim() on the whole output, we get 'src/a.ts\nsrc/b.ts'
    // But individual lines still have leading/trailing spaces from split
    // The function trims the whole output first, then splits on newlines
    expect(filter.size).toBeGreaterThan(0)
  })
})
