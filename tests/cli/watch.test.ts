import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseCliArgs, run } from '../../src/cli/index.js'
import { project, resetProjectCache } from '../../src/core/project.js'
import path from 'node:path'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

describe('watch mode — CLI flag parsing', () => {
  it('parses --watch flag', () => {
    const result = parseCliArgs(['check', '--watch', 'rules.ts'])
    expect(result.values.watch).toBe(true)
  })

  it('parses -w shorthand', () => {
    const result = parseCliArgs(['check', '-w', 'rules.ts'])
    expect(result.values.watch).toBe(true)
  })

  it('defaults --watch to false', () => {
    const result = parseCliArgs(['check', 'rules.ts'])
    expect(result.values.watch).toBe(false)
  })
})

describe('watch mode — baseline --watch error', () => {
  beforeEach(() => {
    process.exitCode = undefined
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('errors when --watch is used with baseline command', async () => {
    await run(['baseline', '--watch', 'rules.ts'])
    expect(process.exitCode).toBe(1)
    expect(console.error).toHaveBeenCalledWith(
      'Error: --watch is only supported with the check command.',
    )
  })
})

describe('resetProjectCache', () => {
  beforeEach(() => {
    resetProjectCache()
  })

  it('returns a fresh instance after cache reset', () => {
    const p1 = project(tsconfigPath)
    resetProjectCache()
    const p2 = project(tsconfigPath)
    expect(p1).not.toBe(p2)
  })
})
