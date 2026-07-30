/**
 * Diff-aware mode has to say what it hid.
 *
 * Plan 0071's first instrument. `--changed` filters **reporting**, not
 * evaluation, so a run with every finding suppressed is byte-for-byte a clean
 * run: exit 0, no output, `total: 0`. The reader chose the flag once, in CI
 * config, and every run afterwards reads as green.
 *
 * **The absent case is the one that matters**, so it is asserted first and
 * separately: a test that only checks the notice appears alongside surviving
 * findings would pass on a build that suppressed everything in silence.
 *
 * The filter is a plain object rather than a real `diffAware()` here. Two
 * reasons: a real one shells out to git, so the changed set is whatever the
 * working tree happens to be; and `CheckOptions.diff` is a **structural**
 * interface, so a caller-supplied object is a real supported input and the
 * suppression count must not depend on the filter accounting for itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { project, functions } from '../../src/index.js'
import { runCheck } from '../../src/cli/commands/check.js'
import { checkAll } from '../../src/core/check-all.js'
import {
  activeNotice,
  suppressionNotice,
  resetDiffDisclosureForTests,
} from '../../src/core/diff-disclosure.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { DiffFilterLike } from '../../src/core/check-options.js'
import type * as DiffAwareModule from '../../src/helpers/diff-aware.js'
import { ArchRuleError } from '../../src/core/errors.js'

vi.mock('../../src/cli/load-rules.js', () => ({ loadRuleFiles: vi.fn() }))
vi.mock('../../src/helpers/diff-aware.js', async (importOriginal) => ({
  // Partial mock: `DiffFilter` itself must stay real, because these tests filter
  // through the shipped implementation rather than a stand-in for it.
  ...(await importOriginal<typeof DiffAwareModule>()),
  diffAware: vi.fn(),
}))

import { loadRuleFiles } from '../../src/cli/load-rules.js'
import { diffAware } from '../../src/helpers/diff-aware.js'
import { DiffFilter } from '../../src/helpers/diff-aware.js'

const mockLoadRuleFiles = vi.mocked(loadRuleFiles)
const mockDiffAware = vi.mocked(diffAware)

/**
 * The `summary` block of a `--format json` report, narrowed without `as`
 * (ADR-005). `expect.stringContaining` inside `toMatchObject` types as `any`,
 * which the lint rules reject and which would also mask a shape change here.
 */
function jsonSummary(raw: string): {
  total: number
  errors: number
  reason: string | null
} {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || !('summary' in parsed)) {
    throw new Error(`no summary in report: ${raw.slice(0, 200)}`)
  }
  const summary: unknown = parsed.summary
  if (summary === null || typeof summary !== 'object') throw new Error('summary is not an object')
  // Literal keys, not a dynamic-key helper: `'k' in obj` narrows the property
  // for a literal and not for a union, so the helper form needs an index
  // signature or an `as` — and ADR-005 bars the second.
  const total = 'total' in summary && typeof summary.total === 'number' ? summary.total : Number.NaN
  const errors =
    'errors' in summary && typeof summary.errors === 'number' ? summary.errors : Number.NaN
  const reason = 'reason' in summary && typeof summary.reason === 'string' ? summary.reason : null
  return { total, errors, reason }
}

function v(file: string): ArchViolation {
  return { rule: 'test', element: 'Foo', file, line: 1, message: `violation in ${file}` }
}

/**
 * A **real** `DiffFilter` over a fixed changed-file set.
 *
 * `diffAware()` is typed to return the class, so the mock must too — and using
 * the real one means these tests exercise the shipped `filterToChanged`
 * (including its `bypassFilters` carve-out) rather than a reimplementation of it
 * that could drift. The set is fixed instead of shelling out to git.
 */
function filterFor(keep: string[]): DiffFilter {
  return new DiffFilter(new Set(keep), 'main')
}

/**
 * A caller-supplied filter, i.e. any object satisfying the structural
 * `DiffFilterLike`. Used where the parameter type allows it, because a consumer
 * passing their own object is supported and the suppression count must not
 * depend on the filter accounting for itself.
 */
function plainFilter(keep: string[], changedFileCount = keep.length): DiffFilterLike {
  return {
    filterToChanged: (violations) => violations.filter((x) => keep.includes(x.file)),
    size: changedFileCount,
    baseBranch: 'main',
  }
}

const baseArgs = {
  ruleFiles: ['rules.ts'],
  changed: true,
  base: 'main',
  format: 'terminal' as const,
}

let stderr: string[] = []
let stdout: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  // `restoreAllMocks` restores spies but keeps a module mock's call history, so
  // an earlier test's `diffAware()` call would satisfy the not-called assertion.
  mockDiffAware.mockReset()
  mockLoadRuleFiles.mockReset()
  stderr = []
  stdout = []
  resetDiffDisclosureForTests()
})

function captureStreams(): void {
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
}

describe('the CLI discloses what --changed suppressed', () => {
  it('says so when it suppressed EVERYTHING, which is the run that looks clean', async () => {
    captureStreams()
    mockLoadRuleFiles.mockResolvedValue([
      { violations: () => [v('/a.ts'), v('/b.ts'), v('/c.ts')] },
    ])
    // Nothing the rule found is in a changed file.
    mockDiffAware.mockReturnValue(filterFor(['/x.ts', '/y.ts']))

    const code = await runCheck(baseArgs)

    // The false green this exists to break: no findings, exit 0.
    expect(code).toBe(0)
    const err = stderr.join('')
    expect(err).toContain('suppressed 3 findings')
    expect(err).toContain('2 changed files')
    expect(err).toContain("diffed against 'main'")
  })

  it('says so when only some were suppressed, and still reports the survivors', async () => {
    captureStreams()
    mockLoadRuleFiles.mockResolvedValue([
      { violations: () => [v('/a.ts'), v('/b.ts'), v('/c.ts')] },
    ])
    mockDiffAware.mockReturnValue(filterFor(['/a.ts']))

    const code = await runCheck(baseArgs)

    expect(code).toBe(1)
    const err = stderr.join('')
    expect(err).toContain('suppressed 2 findings')
    expect(err).toContain('1 changed file')
    // Singular, because a message that says "1 changed files" reads as generated
    // and trains the reader to skim it.
    expect(err).not.toContain('1 changed files')

    // Once, and not as a violation's justification.
    //
    // `writeReport`'s `reason` parameter is rendered per violation as the "Why:"
    // line (`format.ts`: `v.because ?? reason`), so passing a RUN-level notice
    // there both duplicates it and attributes it to a finding it has nothing to
    // do with. That is what the first draft of this did, and the count is why it
    // was found: asserting `toContain` alone is satisfied by any number of
    // copies, including one attached to the wrong thing.
    expect(err.match(/Diff-aware mode suppressed/g)).toHaveLength(1)
    expect(err).not.toMatch(/Why:.*Diff-aware/)
  })

  it('stays quiet when it suppressed nothing, so the notice keeps meaning something', async () => {
    captureStreams()
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [v('/a.ts')] }])
    mockDiffAware.mockReturnValue(filterFor(['/a.ts']))

    await runCheck(baseArgs)

    expect(stderr.join('')).not.toContain('Diff-aware mode')
  })

  it('stays quiet when git was unavailable, because then nothing was hidden', async () => {
    captureStreams()
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [v('/a.ts')] }])
    // A real `diffAware` returns a pass-everything filter with size -1 when git
    // fails. The sentinel must never reach a user's screen as "-1 changed files".
    // A real `diffAware` returns this when git fails: a null changed-set, which
    // passes everything through and reports size -1.
    mockDiffAware.mockReturnValue(new DiffFilter(null, 'main'))

    await runCheck(baseArgs)

    const err = stderr.join('')
    expect(err).not.toContain('Diff-aware mode')
    expect(err).not.toContain('-1')
  })

  it('does not disclose when --changed was not asked for', async () => {
    captureStreams()
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [v('/a.ts')] }])

    await runCheck({ ...baseArgs, changed: false })

    expect(stderr.join('')).not.toContain('Diff-aware mode')
    expect(mockDiffAware).not.toHaveBeenCalled()
  })
})

describe('--format json carries the disclosure on stdout', () => {
  /**
   * stderr and stdout are different streams. An agent that pipes stdout to a
   * parser — the documented `--format json` workflow — would otherwise read
   * `total: 0` and stop, with the sentence explaining why on a stream it never
   * looked at.
   */
  it('sets summary.reason when findings were suppressed', async () => {
    captureStreams()
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [v('/a.ts'), v('/b.ts')] }])
    mockDiffAware.mockReturnValue(filterFor(['/x.ts', '/y.ts', '/z.ts']))

    await runCheck({ ...baseArgs, format: 'json' })

    const summary = jsonSummary(stdout.join(''))
    expect(summary.total).toBe(0)
    expect(summary.errors).toBe(0)
    expect(summary.reason).toContain('suppressed 2 findings')
  })

  it('leaves summary.reason null when nothing was suppressed', async () => {
    captureStreams()
    mockLoadRuleFiles.mockResolvedValue([{ violations: () => [v('/a.ts')] }])
    mockDiffAware.mockReturnValue(filterFor(['/a.ts']))

    await runCheck({ ...baseArgs, format: 'json' })

    expect(jsonSummary(stdout.join('')).reason).toBeNull()
  })
})

describe('checkAll discloses too, because it also filters once', () => {
  it('names the count for the whole array', () => {
    captureStreams()
    const rules = [
      { violations: () => [v('/a.ts')] },
      { violations: () => [v('/b.ts'), v('/c.ts')] },
    ]

    // /a.ts survives, so checkAll throws — and the notice is written BEFORE the
    // throw, which is the property: a failing run must not lose the disclosure.
    expect(() => checkAll(rules, { diff: plainFilter(['/a.ts'], 1) })).toThrow(ArchRuleError)

    expect(stderr.join('')).toContain('suppressed 2 findings')
  })
})

describe('the per-rule terminals state the configuration once', () => {
  /**
   * `.check({ diff })` filters once **per rule**, so no call site there knows the
   * run total. A diff-aware suite with 79 rules must not print 79 lines on the
   * channel v0.26.0 made unconditionally visible — and a per-rule count
   * presented as a run total would be a wrong number, which is worse than no
   * number. So that path states the configuration instead.
   */
  /**
   * The wiring, not just the function. Sabotage found this hole: replacing
   * `writeStderr(notice)` in `execute-rule.ts` with a no-op left every test
   * green, because the `activeNotice` tests below call the function directly and
   * never go through a terminal. A guarded helper with an unguarded call site is
   * an unguarded feature.
   *
   * Uses `.check({ diff })` on a real builder over a real fixture, so the path
   * under test is the one a consumer's test file takes.
   */
  it('reaches stderr from a real .check({ diff }) — the per-rule call site', () => {
    captureStreams()
    const p = project(path.join(import.meta.dirname, '../fixtures/poc/tsconfig.json'))

    // Every finding is in the fixture, and the changed set names none of them,
    // so all are suppressed and the rule passes — the false-green shape again.
    expect(() =>
      functions(p)
        .that()
        .haveNameMatching(/^parse/)
        .should()
        .notExist()
        .check({ diff: new DiffFilter(new Set(['/nothing-here.ts']), 'main') }),
    ).not.toThrow()

    expect(stderr.join('')).toContain('Diff-aware mode is active')
  })

  it('speaks on the first suppression and never again', () => {
    expect(activeNotice(3, 2, 'main')).toContain('Diff-aware mode is active')
    expect(activeNotice(3, 2, 'main')).toBeUndefined()
    expect(activeNotice(99, 2, 'main')).toBeUndefined()
  })

  it('says nothing at all until something is actually suppressed', () => {
    expect(activeNotice(0, 2, 'main')).toBeUndefined()
    // …and the first real suppression still gets the line.
    expect(activeNotice(1, 2, 'main')).toContain('Diff-aware mode is active')
  })

  it('does not claim a total it cannot know', () => {
    const notice = activeNotice(3, 2, 'main')
    // The suppressed count is deliberately absent: it is this rule's count, not
    // the run's. Asserting its absence is what stops someone "improving" the
    // message into a wrong number.
    expect(notice).not.toContain('3')
    expect(notice).toContain('however many there are')
  })
})

describe('suppressionNotice', () => {
  it('is undefined when nothing was suppressed, so a caller cannot print a blank line', () => {
    expect(suppressionNotice(0, 5, 'main')).toBeUndefined()
    expect(suppressionNotice(-1, 5, 'main')).toBeUndefined()
  })

  it('drops the file count rather than guessing when the filter does not expose one', () => {
    const notice = suppressionNotice(2, undefined, 'main')
    expect(notice).toContain('outside the changed files')
    expect(notice).toContain('suppressed 2 findings')
  })

  it('drops the branch clause rather than naming a branch it was not given', () => {
    const notice = suppressionNotice(2, 1)
    expect(notice).toContain('suppressed 2 findings')
    expect(notice).not.toContain('diffed against')
  })

  it('says the findings are still real, not that they passed', () => {
    // The whole point. "0 findings" plus "everything is fine" is the false green;
    // "0 findings" plus "3 were not checked" is a report.
    const notice = suppressionNotice(3, 1, 'main')
    expect(notice).toContain('still present')
    expect(notice).toContain('did not check them')
  })
})
