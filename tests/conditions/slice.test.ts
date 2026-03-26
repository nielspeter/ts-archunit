import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { beFreeOfCycles, respectLayerOrder, notDependOn } from '../../src/conditions/slice.js'
import { resolveByMatching, resolveByDefinition } from '../../src/models/slice.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/slices')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('beFreeOfCycles', () => {
  const p = loadTestProject()

  it('detects cycles between feature slices', () => {
    const featureSlices = resolveByMatching(p, 'src/feature-')
    const condition = beFreeOfCycles()
    const violations = condition.evaluate(featureSlices, ctx)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((v) => v.message.includes('Cycle detected'))).toBe(true)
    expect(violations.some((v) => v.message.includes('feature-a'))).toBe(true)
    expect(violations.some((v) => v.message.includes('feature-b'))).toBe(true)
  })

  it('passes when there are no cycles', () => {
    const layerSlices = resolveByDefinition(p, {
      domain: '**/domain/**',
      services: '**/services/**',
    })
    const condition = beFreeOfCycles()
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations).toHaveLength(0)
  })
})

describe('respectLayerOrder', () => {
  const p = loadTestProject()

  it('passes when dependencies flow downward', () => {
    const layerSlices = resolveByDefinition(p, {
      controllers: '**/controllers/**',
      services: '**/services/**',
      domain: '**/domain/**',
    })
    const condition = respectLayerOrder('controllers', 'services', 'domain')
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations).toHaveLength(0)
  })

  it('reports violations when a lower layer depends on a higher layer', () => {
    const layerSlices = resolveByDefinition(p, {
      controllers: '**/controllers/**',
      services: '**/services/**',
      domain: '**/domain/**',
      bad: '**/bad/**',
    })
    // bad (index 3) depends on controllers (index 0) — upward, violation
    const condition = respectLayerOrder('controllers', 'services', 'domain', 'bad')
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((v) => v.message.includes('bad'))).toBe(true)
    expect(violations.some((v) => v.message.includes('controllers'))).toBe(true)
  })
})

describe('notDependOn', () => {
  const p = loadTestProject()

  it('passes when no slice depends on the forbidden slice', () => {
    const layerSlices = resolveByDefinition(p, {
      domain: '**/domain/**',
      services: '**/services/**',
    })
    const condition = notDependOn('controllers')
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations).toHaveLength(0)
  })

  it('reports violations when a slice depends on a forbidden slice', () => {
    const layerSlices = resolveByDefinition(p, {
      bad: '**/bad/**',
      controllers: '**/controllers/**',
    })
    const condition = notDependOn('controllers')
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((v) => v.message.includes('forbidden slice "controllers"'))).toBe(true)
  })
})
