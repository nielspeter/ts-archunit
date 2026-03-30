import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { functionNoGenericErrors, functionNoTypeErrors } from '../../src/rules/errors.js'

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

describe('error rules — function variants (integration)', () => {
  const p = loadTestProject()

  describe('functionNoGenericErrors()', () => {
    it('catches new Error() in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/error-functions.ts')
          .and()
          .haveNameMatching(/^throwGeneric$/)
          .should()
          .satisfy(functionNoGenericErrors())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('allows new CustomError() in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/error-functions.ts')
          .and()
          .haveNameMatching(/^throwCustom$/)
          .should()
          .satisfy(functionNoGenericErrors())
          .check()
      }).not.toThrow()
    })
  })

  describe('functionNoTypeErrors()', () => {
    it('catches new TypeError() in functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/error-functions.ts')
          .and()
          .haveNameMatching(/^throwTypeError$/)
          .should()
          .satisfy(functionNoTypeErrors())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean functions', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/error-functions.ts')
          .and()
          .haveNameMatching(/^throwCustom$/)
          .should()
          .satisfy(functionNoTypeErrors())
          .check()
      }).not.toThrow()
    })
  })
})
