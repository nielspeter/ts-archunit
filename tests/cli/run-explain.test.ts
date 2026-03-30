import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseCliArgs, run } from '../../src/cli/index.js'

/**
 * Tests for the `explain` command path in cli/index.ts.
 * Covers parseCliArgs with explain arguments and the --markdown flag,
 * and the `run()` function's explain branch.
 */

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('parseCliArgs — explain arguments', () => {
  it('parses explain command with rule files', () => {
    const result = parseCliArgs(['explain', 'rules.ts'])
    expect(result.positionals[0]).toBe('explain')
    expect(result.positionals[1]).toBe('rules.ts')
  })

  it('parses explain with multiple rule files', () => {
    const result = parseCliArgs(['explain', 'a.ts', 'b.ts', 'c.ts'])
    expect(result.positionals).toEqual(['explain', 'a.ts', 'b.ts', 'c.ts'])
  })

  it('parses --markdown flag', () => {
    const result = parseCliArgs(['explain', '--markdown', 'rules.ts'])
    expect(result.values.markdown).toBe(true)
  })

  it('defaults --markdown to false', () => {
    const result = parseCliArgs(['explain', 'rules.ts'])
    expect(result.values.markdown).toBe(false)
  })

  it('parses explain with --markdown and --config', () => {
    const result = parseCliArgs(['explain', '--markdown', '--config', 'archunit.config.ts'])
    expect(result.values.markdown).toBe(true)
    expect(result.values.config).toBe('archunit.config.ts')
  })
})

describe('run() — explain command path', () => {
  it('sets exitCode=1 when explain has no rule files', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['explain'])
    expect(process.exitCode).toBe(1)
  })

  it('error message mentions rule files when explain has none', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['explain'])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No rule files specified'))
  })

  it('sets exitCode=1 for --watch with explain (only supported for check)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['explain', '--watch', 'rules.ts'])
    expect(process.exitCode).toBe(1)
  })
})
