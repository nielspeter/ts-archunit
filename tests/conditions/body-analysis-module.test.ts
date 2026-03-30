import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { access, call } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/module-body')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('Module body analysis', () => {
  const p = loadTestProject()

  describe('notContain (full file — default)', () => {
    it('catches process.env access at module scope', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-process-env.ts')
          .should()
          .notContain(access('process.env'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('catches eval() inside a function body (full file mode)', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-eval-in-function.ts')
          .should()
          .notContain(call('eval'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('catches console.log at module scope', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-console-log.ts')
          .should()
          .notContain(call('console.log'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('catches fetch() inside class method (full file mode)', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-fetch-in-class.ts')
          .should()
          .notContain(call('fetch'))
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes on clean module', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/clean.ts')
          .should()
          .notContain(access('process.env'))
          .check()
      }).not.toThrow()
    })
  })

  describe('notContain with scopeToModule: true', () => {
    it('catches process.env at module scope', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-process-env.ts')
          .should()
          .notContain(access('process.env'), { scopeToModule: true })
          .check()
      }).toThrow(ArchRuleError)
    })

    it('skips eval() inside function body', () => {
      // eval is inside dangerousEval() — scopeToModule should skip it
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-eval-in-function.ts')
          .should()
          .notContain(call('eval'), { scopeToModule: true })
          .check()
      }).not.toThrow()
    })

    it('skips fetch() inside class method', () => {
      // fetch is inside ApiClient.getData() — scopeToModule should skip it
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-fetch-in-class.ts')
          .should()
          .notContain(call('fetch'), { scopeToModule: true })
          .check()
      }).not.toThrow()
    })

    it('catches console.log at module scope', () => {
      // console.log is a top-level statement — scopeToModule should catch it
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-console-log.ts')
          .should()
          .notContain(call('console.log'), { scopeToModule: true })
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('contain', () => {
    it('passes when module contains the pattern', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-console-log.ts')
          .should()
          .contain(call('console.log'))
          .check()
      }).not.toThrow()
    })

    it('fails when module does not contain the pattern', () => {
      expect(() => {
        modules(p).that().resideInFile('**/clean.ts').should().contain(call('console.log')).check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('useInsteadOf', () => {
    it('fails when bad pattern found', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-eval-in-function.ts')
          .should()
          .useInsteadOf(call('eval'), call('safeEval'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('scoped to folder', () => {
    it('works with resideInFolder predicate', () => {
      // All modules in src/ that use process.env — only has-process-env.ts has it
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/src/**')
          .should()
          .notContain(access('process.env'))
          .check()
      }).toThrow(ArchRuleError)
    })
  })
})
