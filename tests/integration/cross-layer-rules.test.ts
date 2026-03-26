import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { crossLayer } from '../../src/builders/cross-layer-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import type { Layer } from '../../src/models/cross-layer.js'
import { haveMatchingCounterpart, satisfyPairCondition } from '../../src/conditions/cross-layer.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/cross-layer')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

function resolveTestLayers(): Layer[] {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  const allFiles = tsMorphProject.getSourceFiles()
  return [
    {
      name: 'routes',
      pattern: '**/routes/**',
      files: allFiles.filter((f) => f.getFilePath().includes('/routes/')),
    },
    {
      name: 'schemas',
      pattern: '**/schemas/**',
      files: allFiles.filter((f) => f.getFilePath().includes('/schemas/')),
    },
  ]
}

describe('crossLayer() — full fluent chain', () => {
  const p = loadTestProject()

  it('detects unmatched routes (order-route has no order-schema)', () => {
    const layers = resolveTestLayers()
    const mapped = crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .mapping(
        (a, b) =>
          a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
      )

    expect(() => {
      mapped.forEachPair().should(haveMatchingCounterpart(layers)).check()
    }).toThrow(ArchRuleError)
  })

  it('custom pair condition with satisfyPairCondition passes', () => {
    const mapped = crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .mapping(
        (a, b) =>
          a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
      )

    expect(() => {
      mapped
        .forEachPair()
        .should(satisfyPairCondition('always pass', () => null))
        .check()
    }).not.toThrow()
  })

  it('.warn() does not throw on violations', () => {
    const layers = resolveTestLayers()
    const mapped = crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .mapping(
        (a, b) =>
          a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
      )

    expect(() => {
      mapped
        .forEachPair()
        .should(haveMatchingCounterpart(layers))
        .because('every route must have a matching schema')
        .warn()
    }).not.toThrow()
  })
})
