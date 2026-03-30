import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import {
  functionNoEval,
  functionNoFunctionConstructor,
  functionNoProcessEnv,
  functionNoConsoleLog,
  functionNoConsole,
  functionNoJsonParse,
} from '../../src/rules/security.js'

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

describe('security rules — function variants (integration)', () => {
  const p = loadTestProject()

  describe('functionNoEval()', () => {
    it('catches eval() in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .should()
          .satisfy(functionNoEval())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .and()
          .haveNameMatching(/^cleanFunction$/)
          .should()
          .satisfy(functionNoEval())
          .check()
      }).not.toThrow()
    })
  })

  describe('functionNoFunctionConstructor()', () => {
    it('catches new Function() in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .should()
          .satisfy(functionNoFunctionConstructor())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('functionNoProcessEnv()', () => {
    it('catches process.env in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .should()
          .satisfy(functionNoProcessEnv())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .and()
          .haveNameMatching(/^cleanFunction$/)
          .should()
          .satisfy(functionNoProcessEnv())
          .check()
      }).not.toThrow()
    })
  })

  describe('functionNoConsoleLog()', () => {
    it('catches console.log in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .should()
          .satisfy(functionNoConsoleLog())
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('functionNoConsole()', () => {
    it('catches console.warn and console.debug too', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .and()
          .haveNameMatching(/^(warnUser|debugInfo)$/)
          .should()
          .satisfy(functionNoConsole())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .and()
          .haveNameMatching(/^cleanFunction$/)
          .should()
          .satisfy(functionNoConsole())
          .check()
      }).not.toThrow()
    })
  })

  describe('functionNoJsonParse()', () => {
    it('catches JSON.parse in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .should()
          .satisfy(functionNoJsonParse())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/security-functions.ts')
          .and()
          .haveNameMatching(/^cleanFunction$/)
          .should()
          .satisfy(functionNoJsonParse())
          .check()
      }).not.toThrow()
    })
  })
})
