import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { agentGuardrails } from '../../src/presets/agent-guardrails.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/agent-guardrails')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const SRC = '**/mistakes.ts'

describe('agentGuardrails preset', () => {
  const p = loadTestProject()

  it('returns one severity-carrying builder per enabled rule', () => {
    const builders = agentGuardrails(p, {
      src: SRC,
      noInlineLogic: ['parseInt'],
      noGenericErrors: true,
      noStubs: true,
      noEmptyBodies: true,
      noCopyPaste: true,
    })
    expect(builders).toHaveLength(5) // 1 inline + 4 flags
  })

  it('catches inline parseInt (error severity)', () => {
    const [builder] = agentGuardrails(p, { src: SRC, noInlineLogic: ['parseInt'] })
    const violations = builder!.violations()
    expect(violations.some((v) => v.element.includes('parseCount'))).toBe(true)
    expect(violations.every((v) => v.severity === 'error')).toBe(true)
  })

  it('catches generic Error, stubs, and empty bodies', () => {
    const g = agentGuardrails(p, { src: SRC, noGenericErrors: true })
    expect(g[0]!.violations().some((v) => v.element.includes('boom'))).toBe(true)
    const s = agentGuardrails(p, { src: SRC, noStubs: true })
    expect(s[0]!.violations().some((v) => v.element.includes('todo'))).toBe(true)
    const e = agentGuardrails(p, { src: SRC, noEmptyBodies: true })
    expect(e[0]!.violations().some((v) => v.element.includes('emptyBody'))).toBe(true)
  })

  it('no-copy-paste is a warn-severity builder', () => {
    const builders = agentGuardrails(p, { src: SRC, noCopyPaste: true })
    const violations = builders[0]!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
  })

  it('override to "off" omits the builder', () => {
    const builders = agentGuardrails(p, {
      src: SRC,
      noGenericErrors: true,
      overrides: { 'preset/agent/no-generic-errors': 'off' },
    })
    expect(builders).toHaveLength(0)
  })

  it('override to "warn" downgrades the severity', () => {
    const [builder] = agentGuardrails(p, {
      src: SRC,
      noGenericErrors: true,
      overrides: { 'preset/agent/no-generic-errors': 'warn' },
    })
    const violations = builder!.violations()
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.every((v) => v.severity === 'warn')).toBe(true)
  })

  it('rules carry agent-facing metadata (suggestion) on violations', () => {
    const [builder] = agentGuardrails(p, { src: SRC, noGenericErrors: true })
    const violations = builder!.violations()
    expect(violations[0]?.suggestion).toContain('domain-specific')
    expect(violations[0]?.because).toBeTruthy()
  })

  it('empty / omitted noInlineLogic generates no inline-logic rules', () => {
    expect(agentGuardrails(p, { src: SRC, noInlineLogic: [] })).toHaveLength(0)
    expect(agentGuardrails(p, { src: SRC })).toHaveLength(0)
  })

  it('generates a distinct rule id per noInlineLogic entry', () => {
    const builders = agentGuardrails(p, { src: SRC, noInlineLogic: ['parseInt', 'eval'] })
    expect(builders).toHaveLength(2)
  })
})
