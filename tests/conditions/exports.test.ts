import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/exports')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('Export conditions', () => {
  const p = loadTestProject()

  describe('notHaveDefaultExport', () => {
    it('catches file with default export', () => {
      expect(() => {
        modules(p).that().resideInFile('**/has-default.ts').should().notHaveDefaultExport().check()
      }).toThrow(ArchRuleError)
    })

    it('passes file without default export', () => {
      expect(() => {
        modules(p).that().resideInFile('**/no-default.ts').should().notHaveDefaultExport().check()
      }).not.toThrow()
    })
  })

  describe('haveDefaultExport', () => {
    it('passes file with default export', () => {
      expect(() => {
        modules(p).that().resideInFile('**/has-default.ts').should().haveDefaultExport().check()
      }).not.toThrow()
    })

    it('catches file without default export', () => {
      expect(() => {
        modules(p).that().resideInFile('**/no-default.ts').should().haveDefaultExport().check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('haveMaxExports', () => {
    it('passes file with 1 export when max is 1', () => {
      expect(() => {
        modules(p).that().resideInFile('**/single-export.ts').should().haveMaxExports(1).check()
      }).not.toThrow()
    })

    it('catches file with 3 exports when max is 1', () => {
      expect(() => {
        modules(p).that().resideInFile('**/multi-export.ts').should().haveMaxExports(1).check()
      }).toThrow(ArchRuleError)
    })

    it('passes file with 3 exports when max is 3', () => {
      expect(() => {
        modules(p).that().resideInFile('**/multi-export.ts').should().haveMaxExports(3).check()
      }).not.toThrow()
    })

    it('does not count default export', () => {
      // has-default.ts has 1 default export and 0 named exports
      expect(() => {
        modules(p).that().resideInFile('**/has-default.ts').should().haveMaxExports(0).check()
      }).not.toThrow()
    })
  })

  describe('combined with folder predicates', () => {
    it('scoped to folder works', () => {
      // multi-export.ts has 3 exports — should fail max 2
      expect(() => {
        modules(p).that().resideInFolder('**/src/**').should().haveMaxExports(2).check()
      }).toThrow(ArchRuleError)
    })
  })
})
