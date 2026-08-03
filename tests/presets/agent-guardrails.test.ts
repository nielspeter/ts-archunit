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
    // One per enabled rule, BY ID — five builders with the same id also had
    // length 5, and "per enabled rule" is a statement about which.
    expect(builders.map((b) => b.describeRule().id)).toEqual([
      'preset/agent/no-inline-logic/parseInt',
      'preset/agent/no-generic-errors',
      'preset/agent/no-stubs',
      'preset/agent/no-empty-bodies',
      'preset/agent/no-copy-paste',
    ])
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

  it('rules carry agent-facing metadata (id/suggestion/because) on violations', () => {
    const [builder] = agentGuardrails(p, { src: SRC, noGenericErrors: true })
    const violations = builder!.violations()
    expect(violations[0]?.ruleId).toBe('preset/agent/no-generic-errors')
    expect(violations[0]?.suggestion).toContain('domain-specific')
    expect(violations[0]?.because).toBeTruthy()
  })

  it('produces zero violations on clean code (no false positives)', () => {
    const builders = agentGuardrails(p, {
      src: '**/clean.ts',
      noInlineLogic: ['parseInt', 'eval', 'JSON.parse'],
      noGenericErrors: true,
      noStubs: true,
      noEmptyBodies: true,
    })
    const violations = builders.flatMap((b) => b.violations())
    expect(violations).toHaveLength(0)
  })

  it('empty / omitted noInlineLogic generates no inline-logic rules', () => {
    expect(agentGuardrails(p, { src: SRC, noInlineLogic: [] })).toHaveLength(0)
    expect(agentGuardrails(p, { src: SRC })).toHaveLength(0)
  })

  it('generates a distinct rule id per noInlineLogic entry', () => {
    const builders = agentGuardrails(p, { src: SRC, noInlineLogic: ['parseInt', 'eval'] })
    // DISTINCT is the claim, and a count of 2 cannot see it: two builders
    // sharing one id — the bug this guards — also had length 2.
    expect(builders.map((b) => b.describeRule().id)).toEqual([
      'preset/agent/no-inline-logic/parseInt',
      'preset/agent/no-inline-logic/eval',
    ])
  })
})

/**
 * Presets must see handler maps (bug 0013).
 *
 * `functions()` keeps object-literal collection opt-in so that widening a
 * selector the USER wrote does not silently change their rule. A preset's
 * subject set is the preset's own, and this one's docstring already promises
 * that "standalone functions, arrow functions, and class methods are all
 * covered" — a handler map is none of the three, so `{ POST: () => {} }`
 * slipped every guardrail in the preset named for the mistakes agents make.
 *
 * Ask ADR-008's question of the tests above: what would they do if no preset
 * rule could see a handler map? They would all pass — every other fixture here
 * declares its functions. That is why this block has its own fixture.
 */
describe('agentGuardrails sees handler maps', () => {
  const handlerMapDir = path.resolve(import.meta.dirname, '../fixtures/presets/handler-map')
  const handlerMapTsconfig = path.join(handlerMapDir, 'tsconfig.json')
  const project = new Project({ tsConfigFilePath: handlerMapTsconfig })
  const hp: ArchProject = {
    tsConfigPath: handlerMapTsconfig,
    _project: project,
    getSourceFiles: () => project.getSourceFiles(),
  }

  const elementsFor = (id: string): string[] =>
    agentGuardrails(hp, {
      src: '**/src/**',
      noGenericErrors: true,
      noStubs: true,
      noEmptyBodies: true,
    })
      .flatMap((r) => r.violations())
      .filter((v) => v.ruleId === id)
      .map((v) => v.element)
      .sort()

  it('flags the same defect in a named function and an object-literal handler', () => {
    // Identical bodies, so anything reported for one must be reported for the
    // other. Asserting the exact pair rather than a count keeps this from
    // passing if the object-literal one were reported twice.
    expect(elementsFor('preset/agent/no-stubs')).toEqual(['namedHandler', 'routes.objectHandler'])
    expect(elementsFor('preset/agent/no-generic-errors')).toEqual([
      'namedHandler',
      'routes.objectHandler',
    ])
  })

  it('flags an empty arrow used as a handler-map value', () => {
    // The canonical agent stub: `{ POST: () => {} }`.
    expect(elementsFor('preset/agent/no-empty-bodies')).toEqual(['routes.emptyHandler'])
  })
})
