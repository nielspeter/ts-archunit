import { describe, it, expect } from 'vitest'
import { Project, type SourceFile } from 'ts-morph'
import path from 'node:path'
import { crossLayer, CrossLayerBuilder } from '../../src/builders/cross-layer-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import {
  haveMatchingCounterpart,
  haveConsistentExports,
  satisfyPairCondition,
} from '../../src/conditions/cross-layer.js'
import type { Layer } from '../../src/models/cross-layer.js'

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

describe('crossLayer() entry point', () => {
  const p = loadTestProject()

  it('returns a CrossLayerBuilder', () => {
    expect(crossLayer(p)).toBeInstanceOf(CrossLayerBuilder)
  })
})

describe('layer resolution', () => {
  const p = loadTestProject()

  it('resolves globs to correct source files', () => {
    const builder = crossLayer(p).layer('routes', '**/routes/**').layer('schemas', '**/schemas/**')

    // We can verify resolution indirectly by checking that mapping produces pairs
    const mapped = builder.mapping((a, b) => {
      // Match user-route.ts with user-schema.ts
      return a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', '')
    })

    // forEachPair succeeds — layers were resolved
    const pairBuilder = mapped.forEachPair()
    expect(pairBuilder).toBeDefined()
  })
})

describe('mapping produces pairs', () => {
  const p = loadTestProject()

  it('mapping function filters Cartesian product correctly', () => {
    // We verify by using a custom condition that counts pairs
    const receivedPairs: Array<{ left: string; right: string }> = []

    crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .mapping(
        (a, b) =>
          a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
      )
      .forEachPair()
      .should(
        satisfyPairCondition('collect pairs', (pair) => {
          receivedPairs.push({
            left: pair.left.getBaseName(),
            right: pair.right.getBaseName(),
          })
          return null // no violations
        }),
      )
      .check()

    // Only user-route -> user-schema should match
    expect(receivedPairs).toHaveLength(1)
    expect(receivedPairs[0]).toEqual({
      left: 'user-route.ts',
      right: 'user-schema.ts',
    })
  })
})

describe('happy path — all matched', () => {
  const p = loadTestProject()

  it('no violations when every left element has a right counterpart', () => {
    // Use only user-route and user-schema which match 1:1
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/user-route.ts')
        .layer('schemas', '**/schemas/user-schema.ts')
        .mapping(
          (a, b) =>
            a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
        )
        .forEachPair()
        .should(satisfyPairCondition('match correctly', () => null))
        .check()
    }).not.toThrow()
  })
})

describe('missing counterpart', () => {
  const p = loadTestProject()

  it('produces violation when a route has no matching schema', () => {
    const builder = crossLayer(p).layer('routes', '**/routes/**').layer('schemas', '**/schemas/**')

    // The mapping only matches user-route -> user-schema
    // order-route has NO matching schema (product-schema doesn't match)
    const mapped = builder.mapping(
      (a, b) =>
        a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
    )

    // To use haveMatchingCounterpart, we need resolved layers.
    // We build them by resolving manually for the condition.
    const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
    const allFiles = tsMorphProject.getSourceFiles()
    const resolvedLayers: Layer[] = [
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

    expect(() => {
      mapped.forEachPair().should(haveMatchingCounterpart(resolvedLayers)).check()
    }).toThrow(ArchRuleError)

    try {
      mapped.forEachPair().should(haveMatchingCounterpart(resolvedLayers)).check()
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.violations.length).toBeGreaterThanOrEqual(1)
      // order-route.ts should be unmatched
      const orderViolation = archError.violations.find((v) => v.message.includes('order-route.ts'))
      expect(orderViolation).toBeDefined()
    }
  })
})

describe('3-layer chain', () => {
  const p = loadTestProject()

  it('routes -> schemas -> sdk consecutive pairing works', () => {
    const receivedPairs: Array<{
      leftLayer: string
      rightLayer: string
      left: string
      right: string
    }> = []

    crossLayer(p)
      .layer('routes', '**/routes/**')
      .layer('schemas', '**/schemas/**')
      .layer('sdk', '**/sdk/**')
      .mapping((a, b) => {
        // Match by the base name prefix: user-route <-> user-schema <-> user-sdk
        const aBase = a
          .getBaseName()
          .replace('-route.ts', '')
          .replace('-schema.ts', '')
          .replace('-sdk.ts', '')
        const bBase = b
          .getBaseName()
          .replace('-route.ts', '')
          .replace('-schema.ts', '')
          .replace('-sdk.ts', '')
        return aBase === bBase
      })
      .forEachPair()
      .should(
        satisfyPairCondition('collect 3-layer pairs', (pair) => {
          receivedPairs.push({
            leftLayer: pair.leftLayer,
            rightLayer: pair.rightLayer,
            left: pair.left.getBaseName(),
            right: pair.right.getBaseName(),
          })
          return null
        }),
      )
      .check()

    // Should have pairs from routes->schemas AND schemas->sdk
    const routeToSchema = receivedPairs.filter(
      (p) => p.leftLayer === 'routes' && p.rightLayer === 'schemas',
    )
    const schemaToSdk = receivedPairs.filter(
      (p) => p.leftLayer === 'schemas' && p.rightLayer === 'sdk',
    )

    expect(routeToSchema.length).toBeGreaterThanOrEqual(1)
    expect(schemaToSdk.length).toBeGreaterThanOrEqual(1)

    // user-route -> user-schema
    expect(routeToSchema).toContainEqual({
      leftLayer: 'routes',
      rightLayer: 'schemas',
      left: 'user-route.ts',
      right: 'user-schema.ts',
    })

    // user-schema -> user-sdk
    expect(schemaToSdk).toContainEqual({
      leftLayer: 'schemas',
      rightLayer: 'sdk',
      left: 'user-schema.ts',
      right: 'user-sdk.ts',
    })
  })
})

describe('custom pair condition', () => {
  const p = loadTestProject()

  it('satisfyPairCondition receives correct pairs and can produce violations', () => {
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .layer('schemas', '**/schemas/**')
        .mapping(
          (a, b) =>
            a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
        )
        .forEachPair()
        .should(
          satisfyPairCondition('always fail', (pair) => ({
            rule: 'test rule',
            element: pair.left.getBaseName(),
            file: pair.left.getFilePath(),
            line: 1,
            message: 'custom failure',
          })),
        )
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('.because()', () => {
  const p = loadTestProject()

  it('reason appears in violation message', () => {
    try {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .layer('schemas', '**/schemas/**')
        .mapping(
          (a, b) =>
            a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
        )
        .forEachPair()
        .should(
          satisfyPairCondition('always fail', (pair) => ({
            rule: 'test rule',
            element: pair.left.getBaseName(),
            file: pair.left.getFilePath(),
            line: 1,
            message: 'custom failure',
          })),
        )
        .because('routes must have matching schemas')
        .check()

      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('routes must have matching schemas')
    }
  })
})

describe('.warn() vs .check()', () => {
  const p = loadTestProject()

  it('warn does not throw on violations', () => {
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .layer('schemas', '**/schemas/**')
        .mapping(
          (a, b) =>
            a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
        )
        .forEachPair()
        .should(
          satisfyPairCondition('always fail', (pair) => ({
            rule: 'test rule',
            element: pair.left.getBaseName(),
            file: pair.left.getFilePath(),
            line: 1,
            message: 'custom failure',
          })),
        )
        .warn()
    }).not.toThrow()
  })

  it('check throws ArchRuleError on violations', () => {
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .layer('schemas', '**/schemas/**')
        .mapping(
          (a, b) =>
            a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
        )
        .forEachPair()
        .should(
          satisfyPairCondition('always fail', (pair) => ({
            rule: 'test rule',
            element: pair.left.getBaseName(),
            file: pair.left.getFilePath(),
            line: 1,
            message: 'custom failure',
          })),
        )
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('empty layer', () => {
  const p = loadTestProject()

  it('no violations and no crash when a layer matches no files', () => {
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .layer('nonexistent', '**/does-not-exist/**')
        .mapping(() => true)
        .forEachPair()
        .should(
          satisfyPairCondition('should not be called', () => ({
            rule: 'test',
            element: 'test',
            file: 'test',
            line: 1,
            message: 'should not reach here',
          })),
        )
        .check()
    }).not.toThrow()
  })
})

describe('haveConsistentExports', () => {
  const p = loadTestProject()

  it('produces violation when exported symbols do not match', () => {
    // Extract exported symbol names
    const extractExports = (file: SourceFile): string[] => {
      const names: string[] = []
      for (const name of file.getExportedDeclarations().keys()) {
        names.push(name)
      }
      return names
    }

    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/user-route.ts')
        .layer('schemas', '**/schemas/user-schema.ts')
        .mapping(() => true) // Only one file each, so they pair up
        .forEachPair()
        .should(haveConsistentExports(extractExports, extractExports))
        .check()
    }).toThrow(ArchRuleError) // UserRoute !== UserSchema
  })
})

describe('mapping requires at least 2 layers', () => {
  const p = loadTestProject()

  it('throws if fewer than 2 layers', () => {
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .mapping(() => true)
    }).toThrow(RangeError)
  })
})

describe('severity', () => {
  const p = loadTestProject()

  it('.severity("error") throws on violations', () => {
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .layer('schemas', '**/schemas/**')
        .mapping(
          (a, b) =>
            a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
        )
        .forEachPair()
        .should(
          satisfyPairCondition('always fail', (pair) => ({
            rule: 'test rule',
            element: pair.left.getBaseName(),
            file: pair.left.getFilePath(),
            line: 1,
            message: 'custom failure',
          })),
        )
        .severity('error')
    }).toThrow(ArchRuleError)
  })

  it('.severity("warn") does not throw', () => {
    expect(() => {
      crossLayer(p)
        .layer('routes', '**/routes/**')
        .layer('schemas', '**/schemas/**')
        .mapping(
          (a, b) =>
            a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
        )
        .forEachPair()
        .should(
          satisfyPairCondition('always fail', (pair) => ({
            rule: 'test rule',
            element: pair.left.getBaseName(),
            file: pair.left.getFilePath(),
            line: 1,
            message: 'custom failure',
          })),
        )
        .severity('warn')
    }).not.toThrow()
  })
})
