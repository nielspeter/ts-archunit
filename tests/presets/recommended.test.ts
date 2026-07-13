import { describe, it, expect, vi } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { recommended } from '../../src/presets/recommended.js'

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

  it('warns on an unrecognized override id (typo guard)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    recommended(p, { overrides: { 'preset/recommended/no-evalz': 'off' } })
    expect(warnSpy).toHaveBeenCalled()
    const msg = warnSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(msg).toContain('no-evalz')
    warnSpy.mockRestore()
  })
})
