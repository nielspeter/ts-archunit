import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runBaseline } from '../../src/cli/commands/baseline.js'
import type { ArchViolation } from '../../src/core/violation.js'

// Mock load-rules to return controllable builders
vi.mock('../../src/cli/load-rules.js', () => ({
  loadRuleFiles: vi.fn(),
}))

import { loadRuleFiles } from '../../src/cli/load-rules.js'

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

    // Builder that reports one violation via .violations()
    const builder = {
      violations: () => [
        {
          rule: 'test rule',
          element: 'TestClass',
          file: '/src/test.ts',
          line: 10,
          message: 'test violation',
        },
      ],
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
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [] }])

    await runBaseline({ ruleFiles: ['rules.ts'], output: outputPath })

    const output = chunks.join('')
    expect(output).toContain('0 entries')
    writeSpy.mockRestore()
  })

  /**
   * Plan 0071's second instrument. The 0.28.0 upgrade recipe is "refresh the
   * baseline, commit, then upgrade", and it is only safe if the adopter can see
   * what the refresh accepted. Before this, a refresh that accepted 37 findings
   * and one that accepted none printed the same shape of line.
   *
   * The **first-run** case is asserted separately because it is the one that
   * must NOT read as a delta: `(+41, −0)` against a baseline that never existed
   * invites "so it added 41" when the honest statement is "41 is all of them".
   */
  describe('the delta it accepted', () => {
    const violation = (element: string): ArchViolation => ({
      rule: 'test rule',
      element,
      file: '/tmp/x.ts',
      line: 1,
      message: `${element} is bad`,
    })

    /** Run `baseline` and return everything it wrote to stdout. */
    const run = async (outputPath: string, elements: string[]): Promise<string> => {
      const chunks: string[] = []
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        chunks.push(String(chunk))
        return true
      })
      mockLoadRuleFiles.mockResolvedValue([{ violations: () => elements.map(violation) }])
      await runBaseline({ ruleFiles: ['rules.ts'], output: outputPath })
      writeSpy.mockRestore()
      return chunks.join('')
    }

    it('says a first run created the file, and does not phrase it as a delta', async () => {
      const outputPath = path.join(createTmpDir(), 'baseline.json')

      const output = await run(outputPath, ['A', 'B', 'C'])

      expect(output).toContain('Baseline created: 3 entries accepted (no previous baseline)')
      // The discriminator: no +/− arithmetic against a file that did not exist.
      expect(output).not.toContain('→')
      expect(output).not.toMatch(/\+\d/)
    })

    /**
     * The printed count and the file must agree.
     *
     * `runBaseline` used to compute the total a second way — `violations.length -
     * refused.length` — beside the one `generateBaseline` already computes. Two
     * derivations of one number in two files drift, so the CLI now prints only
     * the delta's. This is the differently-derived check that replaces it
     * (ADR-008 rule 5): the count is read back out of the written file, not out
     * of the value that produced the sentence.
     */
    it('prints a count that matches the entries actually written', async () => {
      const outputPath = path.join(createTmpDir(), 'baseline.json')

      const output = await run(outputPath, ['A', 'B', 'C', 'D'])

      const written: unknown = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
      const entries =
        written !== null &&
        typeof written === 'object' &&
        'violations' in written &&
        Array.isArray(written.violations)
          ? written.violations.length
          : -1
      expect(entries).toBe(4)
      expect(output).toContain(`${String(entries)} entries`)
    })

    it('names both directions when entries are added and dropped', async () => {
      const outputPath = path.join(createTmpDir(), 'baseline.json')
      await run(outputPath, ['A', 'B'])

      // B is fixed, C and D are newly accepted.
      const output = await run(outputPath, ['A', 'C', 'D'])

      expect(output).toContain('Baseline updated: 2 → 3 entries (+2, −1)')
      // The added count is what the recipe turns on, so it is called out in words
      // rather than left as a symbol the reader has to interpret.
      expect(output).toContain('The +2 are findings this file now accepts that it did not before')
    })

    it('reports +0 −0 for a refresh that accepted nothing new', async () => {
      const outputPath = path.join(createTmpDir(), 'baseline.json')
      await run(outputPath, ['A', 'B'])

      const output = await run(outputPath, ['A', 'B'])

      expect(output).toContain('(+0, −0)')
      // No "the +N are findings…" clause when there is nothing to warn about —
      // otherwise the sentence that matters appears on every run and stops being read.
      expect(output).not.toContain('now accepts that it did not before')
    })

    it('says a full replacement is not a delta, and offers the identity format as the cause', async () => {
      const outputPath = path.join(createTmpDir(), 'baseline.json')
      await run(outputPath, ['A', 'B'])

      // Rewrite the prior file so no identity can match, as a pre-0.19 baseline
      // whose hashes encoded absolute paths would behave.
      const prior: unknown = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
      if (prior !== null && typeof prior === 'object' && 'violations' in prior) {
        const entries: readonly unknown[] = Array.isArray(prior.violations) ? prior.violations : []
        fs.writeFileSync(
          outputPath,
          JSON.stringify({
            ...prior,
            hashVersion: 1,
            violations: entries.map((e, i) =>
              e !== null && typeof e === 'object' ? { ...e, hash: `stale${String(i)}` } : e,
            ),
          }),
        )
      }

      const output = await run(outputPath, ['A', 'B'])

      expect(output).toContain('(+2, −2)')
      expect(output).toContain('No entry survived')
      expect(output).toContain('The identity format changed (v1 → v5)')
    })

    /**
     * The measurement decides, not the version. v2 is byte-identical to v1 for
     * any violation whose fields contain no path (see `HASH_VERSION`), so a v1
     * baseline usually keeps matching entirely — and a message asserting "none
     * of its identities could be compared" beside `(+0, −0)` would be false.
     * This is the guard on that: same content, older version stamp, no alarm.
     */
    it('does not cry replacement for an old version stamp whose identities still match', async () => {
      const outputPath = path.join(createTmpDir(), 'baseline.json')
      await run(outputPath, ['A', 'B'])

      const prior: unknown = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
      if (prior !== null && typeof prior === 'object') {
        fs.writeFileSync(outputPath, JSON.stringify({ ...prior, hashVersion: 1 }))
      }

      const output = await run(outputPath, ['A', 'B'])

      expect(output).toContain('(+0, −0)')
      expect(output).not.toContain('No entry survived')
      expect(output).not.toContain('identity format changed')
    })

    it('refuses to call a corrupt prior file a delta', async () => {
      const outputPath = path.join(createTmpDir(), 'baseline.json')
      await run(outputPath, ['A', 'B'])
      fs.writeFileSync(outputPath, 'this is not a baseline')

      const output = await run(outputPath, ['A', 'B'])

      expect(output).toContain('Baseline replaced: 2 entries written')
      expect(output).toContain('could not be read as a baseline')
      // Reporting it as a first run would be the false green: it would hide that
      // whatever the old file accepted is no longer accepted.
      expect(output).not.toContain('no previous baseline')
      expect(output).not.toMatch(/\+\d/)
    })
  })
})
