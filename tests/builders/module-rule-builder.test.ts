import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules, ModuleRuleBuilder } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('modules() entry point', () => {
  const p = loadTestProject()

  it('returns a ModuleRuleBuilder', () => {
    expect(modules(p)).toBeInstanceOf(ModuleRuleBuilder)
  })

  it('getElements returns all source files', () => {
    // Verify the builder has access to project source files
    // by running a rule that touches all modules
    expect(() => {
      modules(p).should().notExist().check()
    }).toThrow(ArchRuleError)
  })
})

describe('ModuleRuleBuilder fluent chain', () => {
  const p = loadTestProject()

  describe('predicate methods', () => {
    it('.resideInFolder() filters modules by folder', () => {
      // domain modules exist, so notExist should fail
      expect(() => {
        modules(p).that().resideInFolder('**/domain/**').should().notExist().check()
      }).toThrow(ArchRuleError)

      // no modules in nonexistent folder, so notExist should pass
      expect(() => {
        modules(p).that().resideInFolder('**/nonexistent/**').should().notExist().check()
      }).not.toThrow()
    })

    it('.importFrom() filters modules that import from a glob', () => {
      expect(() => {
        modules(p).that().importFrom('**/infra/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.havePathMatching() filters modules by path', () => {
      expect(() => {
        modules(p).that().havePathMatching('**/shared/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.exportSymbolNamed() filters modules exporting a symbol', () => {
      expect(() => {
        modules(p).that().exportSymbolNamed('Order').should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('condition methods', () => {
    it('.onlyImportFrom() passes when domain imports are allowed', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/domain/**')
          .and()
          .haveNameMatching(/^(?!typed-service)/)
          .should()
          .onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })

    it('.onlyImportFrom() fails when imports violate the constraint', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .onlyImportFrom('**/domain/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.notImportFromCondition() passes when no forbidden imports exist', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/domain/**')
          .and()
          .haveNameMatching(/^(?!typed-service)/)
          .should()
          .notImportFromCondition('**/infra/**')
          .check()
      }).not.toThrow()
    })

    it('.notImportFromCondition() fails when forbidden imports exist', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .notImportFromCondition('**/infra/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.onlyHaveTypeImportsFrom() validates type-only imports', () => {
      expect(() => {
        modules(p)
          .that()
          .havePathMatching('**/bad/non-type-import.ts')
          .should()
          .onlyHaveTypeImportsFrom('**/domain/**')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('additional predicate wiring', () => {
    it('.haveNameMatching() with string pattern', () => {
      expect(() => {
        modules(p).that().haveNameMatching('order').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.notImportFrom() filters modules not importing from a glob', () => {
      expect(() => {
        modules(p).that().notImportFrom('**/infra/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.resideInFile() filters modules by file glob', () => {
      expect(() => {
        modules(p).that().resideInFile('**/domain/*.ts').should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('full chain with .because()', () => {
    it('includes reason in error message', () => {
      try {
        modules(p)
          .that()
          .resideInFolder('**/bad/**')
          .should()
          .onlyImportFrom('**/domain/**')
          .because('bad modules should only use domain')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        expect(archError.message).toContain('bad modules should only use domain')
      }
    })
  })

  describe('named selections', () => {
    it('supports reusing a predicate chain across multiple rules', () => {
      const domainModules = modules(p)
        .that()
        .resideInFolder('**/domain/**')
        .and()
        .haveNameMatching(/^(?!typed-service)/)

      expect(() => {
        domainModules.should().onlyImportFrom('**/domain/**', '**/shared/**').check()
      }).not.toThrow()

      expect(() => {
        domainModules.should().notImportFromCondition('**/infra/**').check()
      }).not.toThrow()
    })
  })
})
