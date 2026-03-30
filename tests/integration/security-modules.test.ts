import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { moduleNoEval, moduleNoProcessEnv, moduleNoConsoleLog } from '../../src/rules/security.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/rules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('security rules — module variants (integration)', () => {
  const p = loadTestProject()

  describe('moduleNoEval()', () => {
    it('catches eval in module', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/security-class.ts')
          .should()
          .satisfy(moduleNoEval())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean module', () => {
      expect(() => {
        modules(p).that().resideInFile('**/clean-class.ts').should().satisfy(moduleNoEval()).check()
      }).not.toThrow()
    })
  })

  describe('moduleNoProcessEnv()', () => {
    it('catches process.env in module', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/security-class.ts')
          .should()
          .satisfy(moduleNoProcessEnv())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean module', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/clean-class.ts')
          .should()
          .satisfy(moduleNoProcessEnv())
          .check()
      }).not.toThrow()
    })
  })

  describe('moduleNoConsoleLog()', () => {
    it('catches console.log in module', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/security-class.ts')
          .should()
          .satisfy(moduleNoConsoleLog())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean module', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/clean-class.ts')
          .should()
          .satisfy(moduleNoConsoleLog())
          .check()
      }).not.toThrow()
    })
  })
})
