import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { searchClassBody } from '../../src/helpers/body-traversal.js'
import { call, newExpr } from '../../src/helpers/matchers.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')

describe('Body traversal', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  function findClass(name: string) {
    return project
      .getSourceFiles()
      .flatMap((sf) => sf.getClasses())
      .find((c) => c.getName() === name)!
  }

  describe('searchClassBody()', () => {
    it('finds parseInt in ProductService (bad service)', () => {
      const result = searchClassBody(findClass('ProductService'), call('parseInt'))
      expect(result.found).toBe(true)
      expect(result.matchingNodes.length).toBeGreaterThan(0)
    })

    it('does NOT find parseInt in OrderService (good service)', () => {
      const result = searchClassBody(findClass('OrderService'), call('parseInt'))
      expect(result.found).toBe(false)
      expect(result.matchingNodes).toHaveLength(0)
    })

    it('finds new Error in ProductService', () => {
      const result = searchClassBody(findClass('ProductService'), newExpr('Error'))
      expect(result.found).toBe(true)
    })

    it('does NOT find new Error in OrderService (uses DomainError)', () => {
      const result = searchClassBody(findClass('OrderService'), newExpr('Error'))
      expect(result.found).toBe(false)
    })

    it('finds new DomainError in OrderService', () => {
      const result = searchClassBody(findClass('OrderService'), newExpr('DomainError'))
      expect(result.found).toBe(true)
    })

    it('finds nested parseInt in EdgeCaseService.withNesting', () => {
      const result = searchClassBody(findClass('EdgeCaseService'), call('parseInt'))
      expect(result.found).toBe(true)
    })

    it('finds multiple violations in EdgeCaseService', () => {
      const parseResult = searchClassBody(findClass('EdgeCaseService'), call('parseInt'))
      const errorResult = searchClassBody(findClass('EdgeCaseService'), newExpr('Error'))
      expect(parseResult.found).toBe(true)
      expect(errorResult.found).toBe(true)
    })

    it('returns matching nodes with correct line numbers', () => {
      const result = searchClassBody(findClass('ProductService'), call('parseInt'))
      expect(result.matchingNodes.length).toBeGreaterThan(0)
      for (const node of result.matchingNodes) {
        expect(node.getStartLineNumber()).toBeGreaterThan(0)
      }
    })
  })
})
