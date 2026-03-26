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
})
