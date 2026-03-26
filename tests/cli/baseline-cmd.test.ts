import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runBaseline } from '../../src/cli/commands/baseline.js'

// Mock load-rules to return controllable builders
vi.mock('../../src/cli/load-rules.js', () => ({
  loadRuleFiles: vi.fn(),
}))

import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { ArchRuleError } from '../../src/core/errors.js'

const mockLoadRuleFiles = vi.mocked(loadRuleFiles)

let tmpDir: string | undefined

function createTmpDir(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-archunit-cli-baseline-'))
  return tmpDir
}

afterEach(() => {
  vi.restoreAllMocks()
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true })
    tmpDir = undefined
  }
})

describe('runBaseline', () => {
  it('generates a baseline file', async () => {
    const dir = createTmpDir()
    const outputPath = path.join(dir, 'baseline.json')

    // Builder that throws an ArchRuleError with one violation
    const builder = {
      check: () => {
        throw new ArchRuleError([
          {
            rule: 'test rule',
            element: 'TestClass',
            file: '/src/test.ts',
            line: 10,
            message: 'test violation',
          },
        ])
      },
    }
    mockLoadRuleFiles.mockResolvedValue([builder])

    await runBaseline({ ruleFiles: ['rules.ts'], output: outputPath })

    expect(fs.existsSync(outputPath)).toBe(true)
    const content = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as {
      count: number
      violations: unknown[]
    }
    expect(content.count).toBe(1)
    expect(content.violations).toHaveLength(1)
  })

  it('reports violation count to stdout', async () => {
    const dir = createTmpDir()
    const outputPath = path.join(dir, 'baseline.json')
    const chunks: string[] = []
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    // No violations — builder passes
    mockLoadRuleFiles.mockResolvedValue([{ check: () => undefined }])

    await runBaseline({ ruleFiles: ['rules.ts'], output: outputPath })

    const output = chunks.join('')
    expect(output).toContain('0 violations')
    writeSpy.mockRestore()
  })
})
