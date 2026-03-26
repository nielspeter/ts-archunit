import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { slices, SliceRuleBuilder } from '../../src/builders/slice-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

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

describe('slices() entry point', () => {
  const p = loadTestProject()

  it('returns a SliceRuleBuilder', () => {
    expect(slices(p)).toBeInstanceOf(SliceRuleBuilder)
  })
})

describe('SliceRuleBuilder with matching()', () => {
  const p = loadTestProject()

  it('detects cycles between feature slices', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().check()
    }).toThrow(ArchRuleError)
  })

  it('passes beFreeOfCycles when slices are acyclic', () => {
    expect(() => {
      slices(p).matching('src/feature-c').should().beFreeOfCycles().check()
    }).not.toThrow()
  })
})

describe('SliceRuleBuilder with assignedFrom()', () => {
  const p = loadTestProject()

  it('passes respectLayerOrder when dependencies flow correctly', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
        })
        .should()
        .respectLayerOrder('controllers', 'services', 'domain')
        .check()
    }).not.toThrow()
  })

  it('fails respectLayerOrder when a lower layer depends upward', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
          bad: '**/bad/**',
        })
        .should()
        .respectLayerOrder('controllers', 'services', 'domain', 'bad')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes notDependOn when no forbidden dependencies exist', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          domain: '**/domain/**',
          services: '**/services/**',
        })
        .should()
        .notDependOn('controllers')
        .check()
    }).not.toThrow()
  })

  it('fails notDependOn when forbidden dependencies exist', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          bad: '**/bad/**',
          controllers: '**/controllers/**',
        })
        .should()
        .notDependOn('controllers')
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('SliceRuleBuilder chain methods', () => {
  const p = loadTestProject()

  it('.because() includes reason in error', () => {
    try {
      slices(p)
        .matching('src/feature-')
        .should()
        .beFreeOfCycles()
        .because('features must not have circular deps')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('features must not have circular deps')
    }
  })

  it('.warn() does not throw', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().warn()
    }).not.toThrow()
  })

  it('.severity("error") throws on violations', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().severity('error')
    }).toThrow(ArchRuleError)
  })

  it('.severity("warn") does not throw', () => {
    expect(() => {
      slices(p).matching('src/feature-').should().beFreeOfCycles().severity('warn')
    }).not.toThrow()
  })

  it('supports multiple conditions with andShould()', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
        })
        .should()
        .respectLayerOrder('controllers', 'services', 'domain')
        .andShould()
        .beFreeOfCycles()
        .check()
    }).not.toThrow()
  })
})
