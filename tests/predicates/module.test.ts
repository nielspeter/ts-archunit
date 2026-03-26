import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  importFrom,
  notImportFrom,
  exportSymbolNamed,
  havePathMatching,
} from '../../src/predicates/module.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getSourceFile(relativePath: string) {
  const fullPath = path.join(fixturesDir, relativePath)
  const sf = tsMorphProject.getSourceFile(fullPath)
  if (!sf) throw new Error(`Fixture not found: ${fullPath}`)
  return sf
}

describe('module predicates', () => {
  describe('importFrom', () => {
    it('matches a module that imports from a matching glob', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = importFrom('**/shared/**')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module that has no matching imports', () => {
      const sf = getSourceFile('src/domain/entity.ts')
      const pred = importFrom('**/shared/**')
      expect(pred.test(sf)).toBe(false)
    })

    it('matches against resolved absolute paths', () => {
      const sf = getSourceFile('src/infra/api-client.ts')
      const pred = importFrom('**/domain/**')
      expect(pred.test(sf)).toBe(true)
    })
  })

  describe('notImportFrom', () => {
    it('matches a module that does not import from the glob', () => {
      const sf = getSourceFile('src/domain/entity.ts')
      const pred = notImportFrom('**/infra/**')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module that imports from the glob', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const pred = notImportFrom('**/infra/**')
      expect(pred.test(sf)).toBe(false)
    })
  })

  describe('exportSymbolNamed', () => {
    it('matches a module that exports the named symbol', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = exportSymbolNamed('Order')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module that does not export the symbol', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = exportSymbolNamed('NonExistent')
      expect(pred.test(sf)).toBe(false)
    })
  })

  describe('havePathMatching', () => {
    it('matches a module whose path matches the glob', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = havePathMatching('**/domain/**')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module whose path does not match', () => {
      const sf = getSourceFile('src/shared/logger.ts')
      const pred = havePathMatching('**/domain/**')
      expect(pred.test(sf)).toBe(false)
    })
  })
})
