import { describe, it, expect } from 'vitest'
import { Project, SyntaxKind } from 'ts-morph'
import path from 'node:path'
import picomatch from 'picomatch'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Probe 1: Function Existence — find elements by name/location', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  describe('FunctionDeclaration by name regex', () => {
    const pattern = /^parse\w+Order$/

    const allFunctions = project
      .getSourceFiles()
      .flatMap((sf) => sf.getFunctions())

    const matched = allFunctions.filter((fn) => {
      const name = fn.getName()
      return name !== undefined && pattern.test(name)
    })

    it('finds parseFooOrder and parseBarOrder', () => {
      const names = matched.map((fn) => fn.getName())
      expect(names).toContain('parseFooOrder')
      expect(names).toContain('parseBarOrder')
    })

    it('does not match listItems or parseConfig', () => {
      const names = matched.map((fn) => fn.getName())
      expect(names).not.toContain('listItems')
      expect(names).not.toContain('parseConfig')
    })
  })

  describe('const arrow functions (VariableDeclaration)', () => {
    const pattern = /^parse\w+Order$/

    const allArrowFns = project
      .getSourceFiles()
      .flatMap((sf) => sf.getVariableDeclarations())
      .filter((v) => {
        const init = v.getInitializer()
        return init !== undefined && init.getKind() === SyntaxKind.ArrowFunction
      })

    const matched = allArrowFns.filter((v) => pattern.test(v.getName()))

    it('finds parseBazOrder as const arrow function', () => {
      const names = matched.map((v) => v.getName())
      expect(names).toContain('parseBazOrder')
    })

    it('does not match non-arrow const declarations', () => {
      // parseBazOrder should be the only match
      expect(matched).toHaveLength(1)
    })
  })

  describe('filter by file path glob', () => {
    const isMatch = picomatch('**/routes.*')

    it('all parseXxxOrder functions are in routes.ts', () => {
      const pattern = /^parse\w+Order$/

      // FunctionDeclarations
      const fnDecls = project
        .getSourceFiles()
        .filter((sf) => isMatch(sf.getFilePath()))
        .flatMap((sf) => sf.getFunctions())
        .filter((fn) => {
          const name = fn.getName()
          return name !== undefined && pattern.test(name)
        })

      // Arrow functions
      const arrowFns = project
        .getSourceFiles()
        .filter((sf) => isMatch(sf.getFilePath()))
        .flatMap((sf) => sf.getVariableDeclarations())
        .filter((v) => {
          const init = v.getInitializer()
          return init !== undefined && init.getKind() === SyntaxKind.ArrowFunction
        })
        .filter((v) => pattern.test(v.getName()))

      expect(fnDecls).toHaveLength(2) // parseFooOrder, parseBarOrder
      expect(arrowFns).toHaveLength(1) // parseBazOrder
    })

    it('no parseXxxOrder functions outside routes.ts', () => {
      const notRoutes = picomatch('**/routes.*')
      const pattern = /^parse\w+Order$/

      const outsideRoutes = project
        .getSourceFiles()
        .filter((sf) => !notRoutes(sf.getFilePath()))
        .flatMap((sf) => sf.getFunctions())
        .filter((fn) => {
          const name = fn.getName()
          return name !== undefined && pattern.test(name)
        })

      expect(outsideRoutes).toHaveLength(0)
    })
  })
})
