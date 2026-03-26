import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseCliArgs, run } from '../../src/cli/index.js'
import { project, resetProjectCache } from '../../src/core/project.js'
import { RunScheduler, TS_FILE_RE } from '../../src/cli/watch.js'
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

describe('RunScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces rapid calls — 5 triggers in 50ms result in 1 run', async () => {
    const callback = vi.fn(() => Promise.resolve())
    const scheduler = new RunScheduler(callback, 250)

    // 5 rapid triggers 10ms apart
    scheduler.schedule('file1.ts')
    await vi.advanceTimersByTimeAsync(10)
    scheduler.schedule('file2.ts')
    await vi.advanceTimersByTimeAsync(10)
    scheduler.schedule('file3.ts')
    await vi.advanceTimersByTimeAsync(10)
    scheduler.schedule('file4.ts')
    await vi.advanceTimersByTimeAsync(10)
    scheduler.schedule('file5.ts')

    // Not yet — debounce window hasn't elapsed
    expect(callback).not.toHaveBeenCalled()

    // Advance past debounce
    await vi.advanceTimersByTimeAsync(250)

    expect(callback).toHaveBeenCalledTimes(1)
    // Last trigger wins
    expect(callback).toHaveBeenCalledWith('file5.ts')
  })

  it('pendingRerun triggers re-run after active run completes', async () => {
    let resolveRun: (() => void) | undefined
    const callback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve
        }),
    )
    const scheduler = new RunScheduler(callback, 50)

    // First trigger — starts a run
    scheduler.schedule('first.ts')
    await vi.advanceTimersByTimeAsync(50)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(scheduler.isRunning).toBe(true)

    // Second trigger arrives during the run — should be queued
    scheduler.schedule('second.ts')
    await vi.advanceTimersByTimeAsync(50)
    expect(scheduler.pendingRerun).toBe(true)

    // Complete the first run — should auto-trigger the queued run
    resolveRun!()
    await vi.advanceTimersByTimeAsync(0) // flush microtasks

    expect(callback).toHaveBeenCalledTimes(2)
    expect(scheduler.runCount).toBe(2)
  })

  it('swallows ArchRuleError from callback', async () => {
    const { ArchRuleError } = await import('../../src/core/errors.js')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const callback = vi.fn(() =>
      Promise.reject(
        new ArchRuleError(
          [{ rule: 'test', element: 'X', file: '/x.ts', line: 1, message: 'fail' }],
          'test',
        ),
      ),
    )
    const scheduler = new RunScheduler(callback, 50)

    scheduler.schedule('file.ts')
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(0) // flush microtasks

    // Should NOT print error for ArchRuleError
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('prints non-ArchRuleError errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const callback = vi.fn(() => Promise.reject(new TypeError('unexpected')))
    const scheduler = new RunScheduler(callback, 50)

    scheduler.schedule('file.ts')
    await vi.advanceTimersByTimeAsync(50)
    await vi.advanceTimersByTimeAsync(0) // flush microtasks

    expect(errorSpy).toHaveBeenCalledWith('unexpected')
  })
})

describe('TS_FILE_RE — file filter', () => {
  it('matches .ts files', () => {
    expect(TS_FILE_RE.test('foo.ts')).toBe(true)
  })

  it('matches .tsx files', () => {
    expect(TS_FILE_RE.test('component.tsx')).toBe(true)
  })

  it('matches .mts files', () => {
    expect(TS_FILE_RE.test('module.mts')).toBe(true)
  })

  it('matches .cts files', () => {
    expect(TS_FILE_RE.test('config.cts')).toBe(true)
  })

  it('rejects .json files', () => {
    expect(TS_FILE_RE.test('package.json')).toBe(false)
  })

  it('rejects .md files', () => {
    expect(TS_FILE_RE.test('README.md')).toBe(false)
  })

  it('rejects .js files', () => {
    expect(TS_FILE_RE.test('script.js')).toBe(false)
  })
})
