import { describe, it, expect } from 'vitest'
import type { ArchViolation } from '../../src/core/violation.js'
import { dedupeConfigFindings } from '../../src/core/dedupe-config-findings.js'
import { project, checkAll } from '../../src/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import { strictBoundaries } from '../../src/presets/boundaries.js'

/** A configuration finding, with only the fields the dedupe key reads. */
function config(over: Partial<ArchViolation> = {}): ArchViolation {
  return {
    rule: 'preset/x/y',
    ruleId: 'preset/x/y',
    element: '**/nope/**',
    file: '',
    line: 0,
    message: 'cannot enforce anything',
    bypassFilters: true,
    ...over,
  }
}

/** An ordinary violation — a real element at a real position. */
function ordinary(over: Partial<ArchViolation> = {}): ArchViolation {
  return {
    rule: 'preset/x/y',
    ruleId: 'preset/x/y',
    element: 'UserRepo',
    file: 'src/user.ts',
    line: 12,
    message: 'UserRepo should extend BaseRepository',
    ...over,
  }
}

/**
 * One option, one finding — plan 0074, deciding 0069's appendix item 4.
 *
 * A preset generates rules combinatorially, so one wrong character in one
 * option produces a finding per generated rule. Every one is true — bug 0018 is
 * precisely a preset silently enforcing nothing, so exempting them is wrong —
 * but a report shaped like that makes a one-line fix look like a disaster, and
 * this project's own rule is identities, never totals.
 */
describe('a preset fan-out collapses to the option (plan 0074)', () => {
  it('collapses identical findings and says how many rules they stood for', () => {
    const findings = dedupeConfigFindings([config(), config(), config()])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('generated 3 rules')
  })

  it('keeps two DIFFERENT globs apart, because they are two edits', () => {
    // 0069's appendix is explicit about this one: two `shared` entries that both
    // match nothing are two findings. Collapsing them would hide an edit.
    const findings = dedupeConfigFindings([
      config({ element: '**/nope-a/**' }),
      config({ element: '**/nope-b/**' }),
    ])
    expect(findings.map((f) => f.element)).toEqual(['**/nope-a/**', '**/nope-b/**'])
  })

  it('keeps two rule ids apart, because they are different faults', () => {
    const findings = dedupeConfigFindings([
      config({ ruleId: 'preset/boundaries/shared-discovery' }),
      config({ ruleId: 'preset/boundaries/shared-isolation' }),
    ])
    // The two rule IDS, which is the whole claim — both findings carry the
    // same element and the same message, so a count of 2 says nothing about
    // whether they were kept apart.
    expect(findings.map((v) => v.ruleId).sort()).toEqual([
      'preset/boundaries/shared-discovery',
      'preset/boundaries/shared-isolation',
    ])
  })

  it('keeps two rule FILES apart, because they are two places to edit', () => {
    const findings = dedupeConfigFindings([
      config({ file: 'arch/a.rules.ts' }),
      config({ file: 'arch/b.rules.ts' }),
    ])
    expect(findings.map((f) => f.file)).toEqual(['arch/a.rules.ts', 'arch/b.rules.ts'])
  })

  it('never collapses ordinary violations, however alike', () => {
    // Each names a distinct element at a distinct position, and every one is a
    // separate edit. Collapsing them is the snapshot ADR-008 rule 4 bars, and it
    // would hide real work.
    const many = [ordinary(), ordinary(), ordinary()]
    // Class A after measurement (plan 0079): these three are IDENTICAL on
    // ruleId, file, line, element and message — deliberately, since the claim
    // is that alike violations are not collapsed. There is no identity to
    // assert, so the count IS the value under test.
    expect(dedupeConfigFindings(many)).toHaveLength(3)
  })

  it('adds no note when there was no fan-out', () => {
    // "generated 1 rules" would be both ungrammatical and a lie about a fan-out
    // that did not happen.
    const [only] = dedupeConfigFindings([config()])
    expect(only?.message).not.toContain('generated')
  })

  it('preserves declaration order, and keeps the first of each group', () => {
    const findings = dedupeConfigFindings([
      config({ element: '**/first/**' }),
      config({ element: '**/second/**' }),
      config({ element: '**/first/**' }),
    ])
    expect(findings.map((f) => f.element)).toEqual(['**/first/**', '**/second/**'])
  })

  it('keeps a finding that has no element to key on', () => {
    // A missing key must mean "keep it", never "merge everything that lacks one".
    const findings = dedupeConfigFindings([config({ element: '' }), config({ element: '' })])
    // Class A, same reason as above: both findings lack an element by design.
    expect(findings).toHaveLength(2)
  })

  it('puts the count on the suggestion too, not only the message', () => {
    // Separate fields with separate consumers: the terminal prints `Fix:` from
    // `suggestion`, and `--format json` carries both. A reader seeing one of
    // them otherwise learns a different number from each.
    const [f] = dedupeConfigFindings([
      config({ suggestion: 'fix it' }),
      config({ suggestion: 'fix it' }),
    ])
    expect(f?.suggestion).toContain('generated 2 rules')
  })
})

describe('the fan-out this was built for, end to end', () => {
  const p = project('tsconfig.json')

  it('one wrong shared glob is one finding that names the option', () => {
    // Measured before the fix: 84 rules, 83 configuration findings, 2 distinct
    // messages. The end-to-end case matters because the unit tests above build
    // their findings by hand — they cannot catch the preset failing to produce
    // a stable key, which is what makes the collapse possible at all.
    const rules = strictBoundaries(p, {
      folders: '**/src/*',
      shared: ['**/src/not-built-yet/**'],
    })
    const raw = rules.flatMap((r) => r.violations())
    const rawConfig = raw.filter((v) => v.bypassFilters === true)
    // The fan-out is real, or this test proves nothing about collapsing it.
    expect(rawConfig.length).toBeGreaterThan(20)

    const deduped = dedupeConfigFindings(raw).filter((v) => v.bypassFilters === true)
    const isolation = deduped.filter((v) => v.ruleId === 'preset/boundaries/shared-isolation')
    expect(isolation).toHaveLength(1)

    // It names the option the user wrote, not the calls `atPath()` expanded into.
    expect(isolation[0]?.message).toContain('shared: "**/src/not-built-yet/**"')
    expect(isolation[0]?.message).not.toContain('reside in file matching')
    expect(isolation[0]?.message).toContain(`generated ${String(rawConfig.length - 1)} rules`)
  })

  it('checkAll() applies it — the wiring, not just the function', () => {
    // The sabotage matrix caught this gap: removing the call from `checkAll`
    // left every test above green, because they all invoke
    // `dedupeConfigFindings` directly. A helper nobody calls is not a feature.
    const rules = strictBoundaries(p, {
      folders: '**/src/*',
      shared: ['**/src/not-built-yet/**'],
    })
    let thrown: unknown
    try {
      checkAll(rules)
    } catch (error: unknown) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ArchRuleError)
    const reported = thrown instanceof ArchRuleError ? thrown.violations : []
    const isolation = reported.filter(
      (v) => v.bypassFilters === true && v.ruleId === 'preset/boundaries/shared-isolation',
    )
    expect(isolation).toHaveLength(1)
    expect(isolation[0]?.message).toContain('generated')
  })

  it('CONTROL: a correct configuration produces no configuration findings', () => {
    // Without this, a dedupe that dropped everything would pass every assertion
    // above.
    const rules = strictBoundaries(p, { folders: '**/src/*' })
    const findings = dedupeConfigFindings(rules.flatMap((r) => r.violations()))
    expect(findings.filter((v) => v.bypassFilters === true)).toEqual([])
  })
})
