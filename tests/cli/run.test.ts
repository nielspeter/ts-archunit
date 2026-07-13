import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { run } from '../../src/cli/index.js'

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('run', () => {
  it('prints help with --help flag', async () => {
    const chunks: string[] = []
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    await run(['--help'])
    const output = chunks.join('')
    expect(output).toContain('ts-archunit')
    expect(output).toContain('Usage')
    writeSpy.mockRestore()
  })

  it('prints version with --version flag', async () => {
    const chunks: string[] = []
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    await run(['--version'])
    const output = chunks.join('')
    expect(output).toContain(pkg.version)
    writeSpy.mockRestore()
  })

  it('sets exitCode=1 for unknown command', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['unknown-command'])
    expect(process.exitCode).toBe(1)
  })

  it('sets exitCode=1 when no command given', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run([])
    expect(process.exitCode).toBe(1)
  })

  it('sets exitCode=1 when check has no rule files', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['check'])
    expect(process.exitCode).toBe(1)
  })

  it('sets exitCode=1 when baseline has no rule files', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['baseline'])
    expect(process.exitCode).toBe(1)
  })

  it('lists the init subcommand and its flags in --help', async () => {
    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    await run(['--help'])
    const output = chunks.join('')
    expect(output).toContain('ts-archunit init')
    expect(output).toContain('--preset')
  })

  it('sets exitCode=1 when init gets an invalid --preset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['init', '--preset', 'nope', '--tsconfig', 'definitely-missing.json'])
    expect(process.exitCode).toBe(1)
  })

  it('rejects a --format value not valid for check (e.g. agent)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['check', 'rules.ts', '--format', 'agent'])
    expect(process.exitCode).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("not valid for 'check'"))
  })

  it('rejects a --format value not valid for explain (e.g. github)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['explain', 'rules.ts', '--format', 'github'])
    expect(process.exitCode).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("not valid for 'explain'"))
  })
})
