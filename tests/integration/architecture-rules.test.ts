import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { functions } from '../../src/builders/function-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { mustCall, classMustCall } from '../../src/rules/architecture.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/architecture')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('architecture rules (integration)', () => {
  const p = loadTestProject()

  describe('mustCall()', () => {
    it('passes when function calls matching pattern', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/good-service.ts')
          .and()
          .haveNameMatching(/^getUser$/)
          .should()
          .satisfy(mustCall(/findById/))
          .check()
      }).not.toThrow()
    })

    it('violation when function does not call matching pattern', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/bad-service.ts')
          .and()
          .haveNameMatching(/^getUser$/)
          .should()
          .satisfy(mustCall(/Repository/))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('pattern is user-provided regex', () => {
      // Any regex works — match any call containing "find"
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/good-service.ts')
          .and()
          .haveNameMatching(/^getUser$/)
          .should()
          .satisfy(mustCall(/find/))
          .check()
      }).not.toThrow()
    })
  })

  describe('classMustCall()', () => {
    it('passes when class contains matching call', () => {
      expect(() => {
        classes(p)
          .that()
          .resideInFile('**/good-class-service.ts')
          .should()
          .satisfy(classMustCall(/findById/))
          .check()
      }).not.toThrow()
    })

    it('violation when class does not contain matching call', () => {
      expect(() => {
        classes(p)
          .that()
          .resideInFile('**/bad-class-service.ts')
          .should()
          .satisfy(classMustCall(/Repository/))
          .check()
      }).toThrow(ArchRuleError)
    })
  })
})
