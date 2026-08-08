import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { recommended } from '../../src/presets/recommended.js'
import type { ArchViolation } from '../../src/core/violation.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/recommended')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('recommended preset', () => {
  const p = loadTestProject()

  it('is a thin floor — exactly four rules (2 error, 2 warn) with preset/recommended/* ids', () => {
    const violations = recommended(p).flatMap((b) => b.violations())
    const ids = new Set(violations.map((v) => v.ruleId))
    expect(recommended(p)).toHaveLength(4)
    expect(ids).toEqual(
      new Set([
        'preset/recommended/no-eval',
        'preset/recommended/no-function-constructor',
        'preset/recommended/no-silent-catch',
        'preset/recommended/no-empty-bodies',
      ]),
    )
    const errors = violations.filter((v) => v.severity === 'error').map((v) => v.ruleId)
    const warns = violations.filter((v) => v.severity === 'warn').map((v) => v.ruleId)
    expect(new Set(errors)).toEqual(
      new Set(['preset/recommended/no-eval', 'preset/recommended/no-function-constructor']),
    )
    expect(new Set(warns)).toEqual(
      new Set(['preset/recommended/no-silent-catch', 'preset/recommended/no-empty-bodies']),
    )
  })

  it('the default include matches source files under src/', () => {
    // dangerous.ts trips all four; the default include must reach it.
    const violations = recommended(p).flatMap((b) => b.violations())
    expect(violations.length).toBeGreaterThan(0)
  })

  it('the default include does NOT reach files outside src/', () => {
    // scripts/gen.ts has an eval but lives outside src/. Positive control first:
    // scope the include to it and confirm the rule *would* fire there.
    const scoped = recommended(p, { include: '**/scripts/**' }).flatMap((b) => b.violations())
    expect(scoped.some((v) => v.element?.includes('scriptEval'))).toBe(true)
    // Default include must exclude it.
    const def = recommended(p).flatMap((b) => b.violations())
    expect(def.some((v) => v.element?.includes('scriptEval'))).toBe(false)
  })

  it('catches eval and the Function constructor as errors', () => {
    const violations = recommended(p).flatMap((b) => b.violations())
    const evalV = violations.find((v) => v.ruleId === 'preset/recommended/no-eval')
    const fnV = violations.find((v) => v.ruleId === 'preset/recommended/no-function-constructor')
    expect(evalV?.severity).toBe('error')
    expect(fnV?.severity).toBe('error')
    expect(evalV?.element).toContain('runEval')
  })

  it('silent-catch and empty-bodies are warnings (reported, non-failing)', () => {
    const violations = recommended(p).flatMap((b) => b.violations())
    const silent = violations.find((v) => v.ruleId === 'preset/recommended/no-silent-catch')
    const empty = violations.find((v) => v.ruleId === 'preset/recommended/no-empty-bodies')
    expect(silent?.severity).toBe('warn')
    expect(empty?.severity).toBe('warn')
  })

  it('rules carry agent-facing metadata (because/suggestion/imperative)', () => {
    const violations = recommended(p).flatMap((b) => b.violations())
    const v = violations.find((x) => x.ruleId === 'preset/recommended/no-eval')
    expect(v).toBeDefined()
    expect(v?.suggestion).toBeTruthy()
    expect(v?.because).toContain('eval')
  })

  it('produces zero violations on clean code', () => {
    const violations = recommended(p, { include: '**/clean.ts' }).flatMap((b) => b.violations())
    expect(violations).toHaveLength(0)
  })

  it('override to "off" omits that specific builder', () => {
    const violations = recommended(p, {
      overrides: { 'preset/recommended/no-eval': 'off' },
    }).flatMap((b) => b.violations())
    expect(violations.some((v) => v.ruleId === 'preset/recommended/no-eval')).toBe(false)
    // the other three still fire
    expect(violations.some((v) => v.ruleId === 'preset/recommended/no-empty-bodies')).toBe(true)
  })

  it('override to "error" promotes a warn rule', () => {
    const empty = recommended(p, {
      overrides: { 'preset/recommended/no-empty-bodies': 'error' },
    })
      .flatMap((b) => b.violations())
      .find((v) => v.ruleId === 'preset/recommended/no-empty-bodies')
    expect(empty?.severity).toBe('error')
  })

  it('override to "warn" downgrades an error rule', () => {
    const evalV = recommended(p, {
      overrides: { 'preset/recommended/no-eval': 'warn' },
    })
      .flatMap((b) => b.violations())
      .find((v) => v.ruleId === 'preset/recommended/no-eval')
    expect(evalV?.severity).toBe('warn')
  })

  it('an unrecognized override id FAILS, it does not merely warn (bug 0038)', () => {
    // This test used to assert only that a spy fired, while calling itself a
    // "typo guard" — the exact shape ADR-008's Context table names: a spy proves
    // the call, never the consequence. The consequence was that the rule stayed
    // at its default and the build passed.
    //
    // The key is built at runtime, because a literal no longer compiles: the
    // override key is typed as a union of this preset's rule ids. That is the
    // first line of defence, and this test necessarily exercises the second —
    // the path a type cannot reach (a JS consumer, or a config read from disk).
    const typo: Partial<Record<string, 'error' | 'warn' | 'off'>> = {}
    typo['preset/recommended/no-evalz'] = 'off'

    const findings = recommended(p, { overrides: typo }).flatMap((r) => r.violations())
    const config = findings.filter((v) => v.bypassFilters === true)

    expect(config).toHaveLength(1)
    expect(config[0]?.message).toContain('no-evalz')
    expect(config[0]?.message).toContain('does nothing')
    // It lists the real ids, because the commonest cause is a near-miss.
    expect(config[0]?.suggestion).toContain('preset/recommended/no-eval')
    expect(config[0]?.suggestion).toContain('cannot be suppressed')
  })

  it('CONTROL: a correct override id produces no finding, and takes effect', () => {
    // Without this, "always report an override problem" passes the row above.
    const findings = recommended(p, {
      overrides: { 'preset/recommended/no-silent-catch': 'off' },
    }).flatMap((r) => r.violations())

    expect(findings.filter((v) => v.bypassFilters === true)).toEqual([])
    // …and the override did what it said: the rule is gone, not merely unreported.
    expect(findings.filter((v) => v.ruleId === 'preset/recommended/no-silent-catch')).toEqual([])
  })
})

/**
 * The declared-empty carrier — plan 0089.
 *
 * A preset user holds no builder, so `.expectEmpty()` is unreachable to them.
 * Once plan 0099's floor fails a check that examined nothing, their only other
 * remedy is `overrides: { id: 'off' }` — permanent, non-expiring, and it deletes
 * the rule rather than declaring a fact about it. ADR-009 part 3 makes the
 * carrier binding for that reason.
 */
describe('expectEmpty reaches the rules a preset constructs (plan 0089)', () => {
  const p = loadTestProject()
  /** Matches a real file that declares no functions — live glob, zero subjects. */
  const EMPTY = '**/types-only.ts'
  /** Matches nothing at all — a config error, not a declarable state (plan 0074). */
  const DEAD = '**/nowhere-at-all/**'
  const ALL_IDS = [
    'preset/recommended/no-eval',
    'preset/recommended/no-function-constructor',
    'preset/recommended/no-silent-catch',
    'preset/recommended/no-empty-bodies',
  ] as const
  const configFindings = (rules: ReturnType<typeof recommended>): ArchViolation[] =>
    rules.flatMap((r) => r.violations()).filter((v) => v.bypassFilters === true)

  it('the carrier reaches EVERY rule the preset constructs', () => {
    // The reason this plan blocks 0099. A preset user holds no builder, so
    // `.expectEmpty()` is unreachable to them; without a carrier their only
    // remedy is `overrides: 'off'`, which is permanent and deletes the rule
    // rather than declaring a fact about it.
    expect(configFindings(recommended(p, { include: EMPTY }))).toHaveLength(ALL_IDS.length)

    // All four clear — so the carrier reached all four, not just the first.
    expect(configFindings(recommended(p, { include: EMPTY, expectEmpty: [...ALL_IDS] }))).toEqual(
      [],
    )
  })

  it('declaring one rule clears ONLY that rule — by NAME, not by count', () => {
    // A blanket silencer would clear all four here. Non-vacuity for the row
    // above, which cannot tell "reached every rule" from "silenced everything".
    //
    // Asserted as a SET of surviving ids, because the count alone cannot tell
    // "reached the right rule" from "reached *a* rule". Measured: rotating the
    // carrier's key by one — declaring `no-eval` declares the next rule instead —
    // preserves every count in this file and passed 871/871. ADR-008 rule 5:
    // compare identities, not integers. Once 0099's floor lands, a mis-bound
    // carrier leaves the declared rule failing while a DIFFERENT rule is silently
    // declared empty and stays so — the mute button the carrier must never be.
    const one = recommended(p, {
      include: EMPTY,
      expectEmpty: ['preset/recommended/no-eval'],
    })
    expect(
      configFindings(one)
        .map((v) => v.ruleId)
        .sort(),
    ).toEqual(ALL_IDS.filter((id) => id !== 'preset/recommended/no-eval').sort())
  })

  it('a DEAD glob is not declarable — the carrier does not silence a config error', () => {
    // The distinction that makes the carrier safe. Plan 0074: an empty selection
    // is a state you may declare; a selector that can never match is a mistake,
    // and no declaration should hide it. Measured: still reported when declared.
    const dead = recommended(p, { include: DEAD, expectEmpty: [...ALL_IDS] })
    expect(configFindings(dead)).toHaveLength(ALL_IDS.length)
    expect(configFindings(dead)[0]?.message).toContain('can never match')
  })

  it('declaring is not a mute button — a declaration that is FALSE fails', () => {
    // Over the real corpus these rules DO select subjects, so declaring them
    // empty is a false statement. This is the half 0099's expiry branch reads.
    //
    // The SET, not a count: `toBeGreaterThan(0)` passed when one rule of four
    // expired, so three carriers could quietly do nothing and the row still read
    // green. All four are false over this corpus, so all four must say so.
    expect(
      configFindings(recommended(p, { expectEmpty: [...ALL_IDS] }))
        .map((v) => v.ruleId)
        .sort(),
    ).toEqual([...ALL_IDS].sort())
  })

  it('a rule switched off is NOT constructed, so declaring it is dead', () => {
    // `off` deleted the rule, so a declaration naming it applies to nothing.
    // Saying so is what stops "declare it" and "disable it" cancelling out.
    const both = recommended(p, {
      include: EMPTY,
      overrides: { 'preset/recommended/no-silent-catch': 'off' },
      expectEmpty: ['preset/recommended/no-silent-catch'],
    })
    const unbound = configFindings(both).filter((v) =>
      String(v.ruleId ?? '').startsWith('preset/expect-empty/'),
    )
    expect(unbound).toHaveLength(1)
    expect(unbound[0]?.suggestion).toContain("'off' is not constructed")
  })

  it('CONTROL: no declaration, real corpus — no configuration findings at all', () => {
    // Without this every row above holds if the producer fired always, or never.
    const plain = recommended(p)
    expect(plain).toHaveLength(ALL_IDS.length)
    expect(configFindings(plain)).toEqual([])
  })
})
