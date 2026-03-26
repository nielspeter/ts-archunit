import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { types, TypeRuleBuilder } from '../../src/builders/type-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { notExist } from '../../src/conditions/structural.js'
import type { TypeDeclaration } from '../../src/predicates/type.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('types() entry point', () => {
  const p = loadTestProject()

  it('returns a TypeRuleBuilder', () => {
    expect(types(p)).toBeInstanceOf(TypeRuleBuilder)
  })

  it('getElements finds interfaces and type aliases', () => {
    // Fixtures have UnsafeOptions, SafeOptions, SortColumn, etc.
    expect(() => {
      types(p).should().satisfy(notExist<TypeDeclaration>()).check()
    }).toThrow(ArchRuleError)
  })
})

describe('TypeRuleBuilder identity predicates', () => {
  const p = loadTestProject()

  it('haveNameMatching filters by regex', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching(/Options$/)
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('haveNameMatching with string pattern', () => {
    expect(() => {
      types(p)
        .that()
        .haveNameMatching('Unsafe')
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('areExported filters to exported types', () => {
    expect(() => {
      types(p)
        .that()
        .areExported()
        .and()
        .haveNameMatching(/^SafeOptions$/)
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('areNotExported filters to non-exported types', () => {
    // StrictOptions is not exported in options.ts
    expect(() => {
      types(p).that().areNotExported().should().satisfy(notExist<TypeDeclaration>()).check()
    }).toThrow(ArchRuleError)
  })

  it('resideInFile filters by file glob', () => {
    expect(() => {
      types(p)
        .that()
        .resideInFile('**/options.ts')
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('resideInFolder filters by folder glob', () => {
    expect(() => {
      types(p)
        .that()
        .resideInFolder('**/src/**')
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('resideInFolder with nonexistent folder matches nothing', () => {
    expect(() => {
      types(p)
        .that()
        .resideInFolder('**/nonexistent/**')
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).not.toThrow()
  })
})

describe('TypeRuleBuilder type-specific predicates', () => {
  const p = loadTestProject()

  it('areInterfaces filters to interfaces only', () => {
    expect(() => {
      types(p)
        .that()
        .areInterfaces()
        .and()
        .haveNameMatching(/Options/)
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('areTypeAliases filters to type aliases only', () => {
    // SortColumn, PartialStrictOptions, PickedOptions are type aliases
    expect(() => {
      types(p).that().areTypeAliases().should().satisfy(notExist<TypeDeclaration>()).check()
    }).toThrow(ArchRuleError)
  })

  it('haveProperty filters by property name', () => {
    expect(() => {
      types(p).that().haveProperty('sortBy').should().satisfy(notExist<TypeDeclaration>()).check()
    }).toThrow(ArchRuleError)
  })

  it('extendType with nonexistent base matches nothing', () => {
    expect(() => {
      types(p)
        .that()
        .extendType('NonExistentBase')
        .should()
        .satisfy(notExist<TypeDeclaration>())
        .check()
    }).not.toThrow()
  })
})
