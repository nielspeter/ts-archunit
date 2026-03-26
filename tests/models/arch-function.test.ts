import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import {
  fromFunctionDeclaration,
  fromArrowVariableDeclaration,
  collectFunctions,
} from '../../src/models/arch-function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const project = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})
const routesSf = project.getSourceFiles().find((sf) => sf.getBaseName() === 'routes.ts')!

describe('ArchFunction model', () => {
  describe('fromFunctionDeclaration', () => {
    const parseFoo = routesSf.getFunctions().find((f) => f.getName() === 'parseFooOrder')!
    const archFn = fromFunctionDeclaration(parseFoo)

    it('getName() returns function name', () => {
      expect(archFn.getName()).toBe('parseFooOrder')
    })

    it('getSourceFile() returns the containing source file', () => {
      expect(archFn.getSourceFile().getBaseName()).toBe('routes.ts')
    })

    it('isExported() reflects export status', () => {
      expect(archFn.isExported()).toBe(true)
    })

    it('isAsync() reflects async status', () => {
      expect(archFn.isAsync()).toBe(false)
    })

    it('getParameters() returns parameter declarations', () => {
      const params = archFn.getParameters()
      expect(params).toHaveLength(1)
      expect(params[0]!.getName()).toBe('order')
    })

    it('getReturnType() returns the resolved return type', () => {
      const returnType = archFn.getReturnType().getText()
      // parseFooOrder returns { field: string; direction: string }
      expect(returnType).toContain('field')
      expect(returnType).toContain('direction')
    })

    it('getBody() returns the function body', () => {
      expect(archFn.getBody()).toBeDefined()
    })

    it('getNode() returns the FunctionDeclaration', () => {
      expect(archFn.getNode().getKind()).toBe(SyntaxKind.FunctionDeclaration)
    })

    it('getStartLineNumber() returns a valid line number', () => {
      expect(archFn.getStartLineNumber()).toBeGreaterThan(0)
    })
  })

  describe('fromArrowVariableDeclaration', () => {
    const parseBaz = routesSf
      .getVariableDeclarations()
      .find((v) => v.getName() === 'parseBazOrder')!
    const archFn = fromArrowVariableDeclaration(parseBaz)

    it('getName() returns variable name', () => {
      expect(archFn.getName()).toBe('parseBazOrder')
    })

    it('getSourceFile() returns the containing source file', () => {
      expect(archFn.getSourceFile().getBaseName()).toBe('routes.ts')
    })

    it('isExported() reflects export status', () => {
      expect(archFn.isExported()).toBe(true)
    })

    it('isAsync() reflects async status of the arrow function', () => {
      expect(archFn.isAsync()).toBe(false)
    })

    it('getParameters() returns arrow function parameters', () => {
      const params = archFn.getParameters()
      expect(params).toHaveLength(1)
      expect(params[0]!.getName()).toBe('order')
    })

    it('getReturnType() returns the resolved return type', () => {
      const returnType = archFn.getReturnType().getText()
      expect(returnType).toContain('field')
    })

    it('getBody() returns the arrow function body', () => {
      expect(archFn.getBody()).toBeDefined()
    })

    it('getNode() returns the VariableDeclaration', () => {
      expect(archFn.getNode().getKind()).toBe(SyntaxKind.VariableDeclaration)
    })
  })

  describe('collectFunctions', () => {
    it('collects both FunctionDeclarations and arrow functions', () => {
      const fns = collectFunctions(routesSf)
      const names = fns.map((f) => f.getName())
      // FunctionDeclarations: parseFooOrder, parseBarOrder, listItems, parseConfig
      // Arrow functions: parseBazOrder
      expect(names).toContain('parseFooOrder')
      expect(names).toContain('parseBarOrder')
      expect(names).toContain('parseBazOrder')
      expect(names).toContain('listItems')
      expect(names).toContain('parseConfig')
    })

    it('does not include non-arrow variable declarations', () => {
      const fns = collectFunctions(routesSf)
      // All collected items should be actual functions
      for (const fn of fns) {
        expect(fn.getBody()).toBeDefined()
      }
    })
  })
})
