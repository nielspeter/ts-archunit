/**
 * A rule file that stops evaluating partway must say so — bug 0029.
 *
 * Since v0.23.0 `.warn()` throws for a configuration finding (plan 0069 R3a). In a
 * **self-executing** rule file, the shape `init` scaffolds, a throw at module scope
 * aborts the module: every rule declared after it is never evaluated, the CLI folds
 * the thrown finding into the run, and the output looks entirely ordinary. R3a
 * specified the other half — *"the CLI reports the truncation rather than absorbing
 * it"* — and shipped without it.
 *
 * Measured on v0.28.0, the same two rules in each shape:
 *
 * | rule file shape                 | findings reported |
 * | ------------------------------- | ----------------- |
 * | `export default [rule1, rule2]` | **5** — the configuration finding and all four violations |
 * | self-executing                  | **1** — the four violations silently absent |
 *
 * ## Why this file does not mock `loadRuleFiles`
 *
 * `tests/cli/check.test.ts` does, which is exactly why nothing caught this: with the
 * loader mocked, no test ever evaluates a real module whose scope throws partway
 * through. So these run `runCheck` against **real fixture rule files on disk**. That
 * is the whole point of the file and it is why it is slower than its neighbours.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { runCheck } from '../../src/cli/commands/check.js'
import type { ArchViolation } from '../../src/core/violation.js'

const fixture = (name: string): string =>
  path.join(import.meta.dirname, '../fixtures/rule-files', name)

/**
 * `fresh: true` on every run in this file, and it is load-bearing.
 *
 * A rule file's module is cached after its first import, so a second `runCheck` on the
 * same path does not re-execute its module scope — no terminal fires, and
 * `executeWarn`'s write never happens. Measured: the double-print assertion below saw
 * two stderr writes when its test ran first in the process and **one** when it ran
 * third, so it silently stopped testing anything depending on position in the file.
 * `fresh` uses cache-busting imports, which is what makes these order-independent.
 */
const baseArgs = { changed: false, base: 'main', format: 'terminal' as const, fresh: true }

let stderr: string[] = []
let stdout: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  stderr = []
  stdout = []
})

function capture(): void {
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
}

/** The `violations` array of a `--format json` run. */
function jsonViolations(raw: string): ArchViolation[] {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || !('violations' in parsed)) {
    throw new Error(`no violations in report: ${raw.slice(0, 200)}`)
  }
  if (!Array.isArray(parsed.violations)) throw new Error('violations is not an array')
  // `readonly unknown[]`, not the narrowed `any[]`: after `Array.isArray` the elements
  // are `any`, and ADR-005 bars both `any` and the `as` that would re-narrow them.
  // Assigning to this type is allowed and hands each element back as `unknown` — the
  // same idiom `withBaseline` uses on the same shape.
  const list: readonly unknown[] = parsed.violations
  const out: ArchViolation[] = []
  for (const v of list) {
    if (v !== null && typeof v === 'object' && 'message' in v && typeof v.message === 'string') {
      const file = 'file' in v && typeof v.file === 'string' ? v.file : ''
      const element = 'element' in v && typeof v.element === 'string' ? v.element : ''
      const rule = 'rule' in v && typeof v.rule === 'string' ? v.rule : ''
      const line = 'line' in v && typeof v.line === 'number' ? v.line : 0
      out.push({ rule, element, file, line, message: v.message })
    }
  }
  return out
}

describe('a self-executing rule file that throws partway', () => {
  it('reports the truncation, and names the file it happened in', async () => {
    capture()

    const code = await runCheck({ ...baseArgs, ruleFiles: [fixture('truncating.rules.ts')] })

    // `runCheck` returns the error-severity COUNT, not a 0/1 code — two here, both
    // configuration findings, which `severityFor` forces to error.
    expect(code).toBe(2)
    const report = stderr.join('')
    expect(report).toContain('stopped evaluating at the finding above')
    // Attributed to the rule file, not to a source file it was checking.
    expect(report).toContain('truncating.rules.ts')
  })

  /**
   * **The lost violations stay lost, and that is the honest state.**
   *
   * The module never finished, so nothing can recover `rule2`'s findings in this run.
   * Asserting that they appear would be asserting a fix nobody built. What must be
   * true is that the report *says* something is missing — so this asserts the absence
   * AND the notice together, because either alone is satisfied by the bug.
   */
  it('does not invent the lost findings, and does not stay silent about them', async () => {
    capture()

    await runCheck({
      ...baseArgs,
      format: 'json',
      ruleFiles: [fixture('truncating.rules.ts')],
    })

    const found = jsonViolations(stdout.join(''))
    // `rule2` found four `parse*` functions when it ran in the control below. Here it
    // never ran, so none of them can be present.
    expect(found.filter((v) => v.element.startsWith('parse'))).toEqual([])
    // …and the report says so, rather than reading as a clean two-finding run.
    expect(found.some((v) => v.message.includes('stopped evaluating'))).toBe(true)
  })

  it('reports each finding exactly once', async () => {
    capture()

    // Its OWN fixture, because this is the one assertion that depends on the module
    // executing: a cached re-import never reaches `executeWarn`, so the extra write
    // cannot happen and the test passes for the wrong reason. Measured — it saw two
    // writes running first in this file and one running third.
    await runCheck({ ...baseArgs, ruleFiles: [fixture('truncating-print-once.rules.ts')] })

    // `executeWarn` used to write every violation and THEN throw the configuration
    // findings, so whoever caught the error and reported `error.violations` printed
    // them a second time — two `Architecture Violation [1 of 1]` blocks with
    // identical content, while `--format json` said 1.
    const report = stderr.join('')
    // R3b (plan 0074) supersedes this: the selector is STATICALLY dead, so the glob gate reports it before the runtime empty-selection check ever runs. Strictly stronger — "can never match" implies "matched nothing" — and reporting both would be one fact twice, which is bug 0031's shape.
    expect(report.match(/can never match anything in this project/g)).toHaveLength(1)
    expect(report.match(/stopped evaluating at the finding above/g)).toHaveLength(1)
  })

  it('agrees between the terminal and json surfaces', async () => {
    capture()
    await runCheck({ ...baseArgs, ruleFiles: [fixture('truncating.rules.ts')] })
    const terminalHeaders = (stderr.join('').match(/Architecture Violation \[/g) ?? []).length

    stderr = []
    stdout = []
    await runCheck({ ...baseArgs, format: 'json', ruleFiles: [fixture('truncating.rules.ts')] })
    const jsonCount = jsonViolations(stdout.join('')).length

    // The double print was visible only because these two disagreed: 2 blocks against
    // `total: 1`. Comparing them is what makes a future divergence fail rather than
    // needing someone to count blocks by eye.
    expect(terminalHeaders).toBe(jsonCount)
    expect(jsonCount).toBe(2)
  })
})

describe('the array-export shape is not truncated, and must not be told it was', () => {
  /**
   * The discriminator. An array export builds every rule before any of them runs, so
   * no terminal fires at module scope and nothing can be lost.
   *
   * Without this, a "fix" that emitted the truncation notice for *every* rule file
   * would satisfy every assertion above.
   */
  it('evaluates both rules and reports no truncation', async () => {
    capture()

    await runCheck({
      ...baseArgs,
      format: 'json',
      ruleFiles: [fixture('array-export.rules.ts')],
    })

    const found = jsonViolations(stdout.join(''))
    // The configuration finding plus all four `parse*` violations.
    expect(found).toHaveLength(5)
    expect(found.filter((v) => v.element.startsWith('parse'))).toHaveLength(4)
    // And nothing claiming the file stopped early, because it did not.
    expect(found.some((v) => v.message.includes('stopped evaluating'))).toBe(false)
  })

  it('is the same two rules, so the contrast is the shape and nothing else', async () => {
    capture()
    await runCheck({
      ...baseArgs,
      format: 'json',
      ruleFiles: [fixture('array-export.rules.ts')],
    })
    const control = jsonViolations(stdout.join(''))

    stderr = []
    stdout = []
    await runCheck({
      ...baseArgs,
      format: 'json',
      ruleFiles: [fixture('truncating.rules.ts')],
    })
    const truncated = jsonViolations(stdout.join(''))

    // Both files carry the identical configuration finding, which is what proves the
    // two fixtures really are the same rules in two shapes. If they drifted, the
    // comparison above would be measuring two different things.
    const selectorFinding = (found: ArchViolation[]): string | undefined =>
      found.find((v) => v.message.includes('can never match anything in this project'))?.message
    expect(selectorFinding(control)).toBeDefined()
    expect(selectorFinding(truncated)).toBe(selectorFinding(control))

    // Four findings exist in one shape and not the other. That difference IS the bug.
    expect(control.length - truncated.length).toBe(3)
  })
})
