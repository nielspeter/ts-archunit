import { describe, it, expect } from 'vitest'
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
    const builders = recommended(p)
    expect(builders).toHaveLength(4)
  })

  it('the default include matches source files under src/', () => {
    // dangerous.ts trips all four; the default include must reach it.
    const violations = recommended(p).flatMap((b) => b.violations())
    expect(violations.length).toBeGreaterThan(0)
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
    expect(v?.suggestion).toBeTruthy()
    expect(v?.because).toContain('eval')
  })

  it('produces zero violations on clean code', () => {
    const violations = recommended(p, { include: '**/clean.ts' }).flatMap((b) => b.violations())
    expect(violations).toHaveLength(0)
  })

  it('override to "off" omits the builder', () => {
    const builders = recommended(p, { overrides: { 'preset/recommended/no-eval': 'off' } })
    expect(builders).toHaveLength(3)
  })

  it('override to "error" promotes a warn rule', () => {
    const builders = recommended(p, { overrides: { 'preset/recommended/no-empty-bodies': 'error' } })
    const empty = builders
      .flatMap((b) => b.violations())
      .find((v) => v.ruleId === 'preset/recommended/no-empty-bodies')
    expect(empty?.severity).toBe('error')
  })
})
