import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { isTypeOnlyImport } from '../../src/core/import-options.js'

const project = new Project({ useInMemoryFileSystem: true })

function getImportDeclaration(code: string) {
  const sf = project.createSourceFile(`test-${Math.random()}.ts`, code, { overwrite: true })
  const imports = sf.getImportDeclarations()
  if (imports.length === 0) throw new Error('No imports found')
  return imports[0]!
}

describe('isTypeOnlyImport()', () => {
  it('returns true for declaration-level type-only import', () => {
    const decl = getImportDeclaration(`import type { Foo } from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(true)
  })

  it('returns true for declaration-level default type-only import', () => {
    const decl = getImportDeclaration(`import type Foo from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(true)
  })

  it('returns false for regular named import', () => {
    const decl = getImportDeclaration(`import { Foo } from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(false)
  })

  it('returns false for default import (runtime binding)', () => {
    const decl = getImportDeclaration(`import Foo from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(false)
  })

  it('returns false for namespace import (runtime binding)', () => {
    const decl = getImportDeclaration(`import * as Foo from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(false)
  })

  it('returns true when all named specifiers are individually type-only', () => {
    const decl = getImportDeclaration(`import { type Foo, type Bar } from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(true)
  })

  it('returns false for mixed specifiers (some type-only, some runtime)', () => {
    const decl = getImportDeclaration(`import { type Foo, Bar } from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(false)
  })

  it('returns false for default import combined with type-only specifiers', () => {
    const decl = getImportDeclaration(`import Foo, { type Bar } from './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(false)
  })

  it('returns false for side-effect import (no specifiers)', () => {
    const decl = getImportDeclaration(`import './foo.js'`)
    expect(isTypeOnlyImport(decl)).toBe(false)
  })
})
