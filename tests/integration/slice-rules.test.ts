import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { slices } from '../../src/builders/slice-rule-builder.js'
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

describe('slices() — full fluent chain', () => {
  const p = loadTestProject()

  describe('beFreeOfCycles with matching()', () => {
    it('feature slices with a cycle fail', () => {
      // matching uses a prefix — 'src/feature-' captures feature-a, feature-b, feature-c
      expect(() => {
        slices(p).matching('src/feature-').should().beFreeOfCycles().check()
      }).toThrow(ArchRuleError)
    })

    it('standalone slice is cycle-free', () => {
      // feature-c has no imports — a single acyclic slice
      expect(() => {
        slices(p).matching('src/feature-c').should().beFreeOfCycles().check()
      }).not.toThrow()
    })
  })

  describe('respectLayerOrder with assignedFrom()', () => {
    it('correct layer order passes', () => {
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

    it('reversed layer order fails', () => {
      expect(() => {
        slices(p)
          .assignedFrom({
            controllers: '**/controllers/**',
            services: '**/services/**',
            domain: '**/domain/**',
          })
          .should()
          .respectLayerOrder('domain', 'services', 'controllers')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('notDependOn with assignedFrom()', () => {
    it('domain does not depend on controllers', () => {
      expect(() => {
        slices(p)
          .assignedFrom({
            controllers: '**/controllers/**',
            services: '**/services/**',
            domain: '**/domain/**',
          })
          .should()
          .notDependOn('controllers')
          .check()
      }).not.toThrow()
    })
  })

  describe('.because(), .warn(), .rule(), .excluding(), .severity()', () => {
    it('.warn() does not throw on cycle violations', () => {
      expect(() => {
        slices(p)
          .matching('src/feature-')
          .should()
          .beFreeOfCycles()
          .because('circular dependencies prevent independent deployment')
          .warn()
      }).not.toThrow()
    })

    it('.rule() attaches metadata', () => {
      expect(() => {
        slices(p)
          .matching('src/feature-')
          .should()
          .beFreeOfCycles()
          .rule({
            id: 'arch/no-feature-cycles',
            because: 'circular deps prevent independent deployment',
            suggestion: 'extract shared code into src/shared/',
            docs: 'https://example.com/adr/cycles',
          })
          .warn()
      }).not.toThrow()
    })

    it('.excluding() suppresses named violations', () => {
      // Cycle element is "[feature-b, feature-a]" — regex matches it
      expect(() => {
        slices(p)
          .matching('src/feature-')
          .should()
          .beFreeOfCycles()
          .excluding(/feature-b.*feature-a/)
          .check()
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
  })
})
