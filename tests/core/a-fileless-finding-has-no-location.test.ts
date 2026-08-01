/**
 * A finding with no source location does not invent one —
 * [bug 0047](../../bugs/fixed/0047-a-fileless-finding-renders-a-meaningless-location.md).
 *
 * A configuration finding reports that a **rule** enforces nothing, not that a
 * line of code is wrong, so it carries `file: ''` and a `line` that means
 * nothing. Two of the four renderers already knew that: the rich terminal format
 * omits the location, and `format-github.ts:58` special-cases it because
 * `::error file=,line=0` is not a valid annotation and GitHub silently drops it.
 *
 * Plain emitted a bare `(:1)` and JSON emitted `"file": "", "line": 1`. A human
 * skims past the first; the second is the agent contract, and a location that
 * looks real is one an agent may open or anchor an edit to.
 *
 * ## Why `configuration` is here too
 *
 * The JSON payload carried **no field at all** distinguishing a configuration
 * finding from a real violation — so nulling the location without adding one
 * would have removed the only (accidental, misleading) signal a consumer had.
 * The two changes are one change.
 */
import { describe, expect, it } from 'vitest'
import { formatViolations, formatViolationsPlain } from '../../src/core/format.js'
import { formatViolationsJson } from '../../src/core/format-json.js'
import type { ArchViolation } from '../../src/core/violation.js'
import type { ArchJsonReport } from '../../src/core/format-json.js'

const CONFIG: ArchViolation = {
  rule: 'arch/example',
  ruleId: 'arch/example',
  element: 'arch/example',
  file: '',
  line: 1,
  message: 'this rule enforces nothing',
  suggestion: 'widen the selector',
  bypassFilters: true,
}

const REAL: ArchViolation = {
  rule: 'arch/example',
  ruleId: 'arch/example',
  element: 'UserService.getTotal',
  file: '/project/src/service.ts',
  line: 42,
  message: 'bad call',
}

/**
 * Parse against the **exported** contract type, not a hand-rolled copy.
 *
 * The first draft declared its own `interface JsonPayload` and cast through
 * `unknown` with an ADR-005 exemption — against our own output, which is a
 * smell rather than an interop boundary. `ArchJsonReport` now exists precisely
 * so a consumer (including us) gets a compile error instead of a runtime one,
 * and the cast is gone: `structuredClone`-free narrowing via a type predicate.
 */
function parse(json: string): ArchJsonReport {
  const parsed: unknown = JSON.parse(json)
  if (!isReport(parsed)) throw new Error('payload does not match ArchJsonReport')
  return parsed
}

function isReport(value: unknown): value is ArchJsonReport {
  return typeof value === 'object' && value !== null && 'violations' in value
}

describe('a fileless finding renders no location (bug 0047)', () => {
  it('plain: no bare "(:1)"', () => {
    // `formatViolationsPlain`, NOT `formatViolations(v, 'plain')` — the second
    // parameter of that one is `reason`, so the first draft of this test passed
    // 'plain' as a reason and exercised the RICH formatter, which already
    // handled fileless findings. It passed while testing nothing. Found by
    // sabotage: reverting the plain-formatter fix left the suite green.
    const out = formatViolationsPlain([CONFIG])
    expect(out).toContain('this rule enforces nothing')
    expect(out).not.toContain('(:1)')
    expect(out).not.toContain('(:0)')
    // Nothing that looks like a location at all.
    expect(out).not.toMatch(/\(\s*:/)
  })

  it('plain CONTROL: a real violation still shows file:line', () => {
    // Without this, deleting the location unconditionally passes the row above.
    const out = formatViolationsPlain([REAL])
    expect(out).toContain('/project/src/service.ts:42')
  })

  it('json: file and line are null, not "" and 1', () => {
    const [v] = parse(formatViolationsJson([CONFIG])).violations
    expect(v?.file).toBeNull()
    expect(v?.line).toBeNull()
  })

  it('json CONTROL: a real violation keeps its location', () => {
    const [v] = parse(formatViolationsJson([REAL])).violations
    expect(v?.file).toBe('/project/src/service.ts')
    expect(v?.line).toBe(42)
  })

  it('the exported contract type matches what is actually emitted', () => {
    // `ArchJsonReport` is a claim about our own output, so it is checked against
    // the output rather than trusted. If a field is added to the emitter and not
    // to the type — or vice versa — this reds.
    const report = parse(formatViolationsJson([CONFIG, REAL]))
    const [v] = report.violations
    expect(Object.keys(v ?? {}).sort()).toEqual(
      [
        'because',
        'codeFrame',
        'docs',
        'element',
        'file',
        'kind',
        'line',
        'measured',
        'message',
        'rule',
        'ruleId',
        'severity',
        'suggestion',
      ].sort(),
    )
    expect(Object.keys(report).sort()).toEqual(
      ['commentSuppressed', 'summary', 'untestedAllowlists', 'violations'].sort(),
    )
  })

  it('json: the two kinds are distinguishable by a field, not by inference', () => {
    // The point of the pair. Before this, a consumer had to guess from an empty
    // `file` — which is exactly the misleading signal being removed.
    const { violations } = parse(formatViolationsJson([CONFIG, REAL]))
    expect(violations.map((v) => v.kind)).toEqual(['configuration', 'violation'])
  })

  it('the RICH formatter still omits it too — it always did', () => {
    // The control that says the plain fix did not regress the format that was
    // already correct, and the reason the mistake above was invisible.
    const out = formatViolations([CONFIG])
    expect(out).not.toMatch(/\(\s*:/)
  })

  it('VACUITY: the two fixtures really do differ in kind', () => {
    // Both rows above pass trivially if the fixtures are secretly the same shape.
    expect(CONFIG.bypassFilters).toBe(true)
    expect(REAL.bypassFilters).toBeUndefined()
    expect(CONFIG.file).toBe('')
    expect(REAL.file).not.toBe('')
  })
})
