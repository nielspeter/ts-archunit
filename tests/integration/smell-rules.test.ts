import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { smells } from '../../src/smells/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { call } from '../../src/helpers/matchers.js'

function loadProject(dir: string): ArchProject {
  const tsconfigPath = path.join(dir, 'tsconfig.json')
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('smells — full fluent chain', () => {
  describe('duplicateBodies()', () => {
    const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')
    const p = loadProject(fixturesDir)

    it('detects duplicate function bodies', () => {
      expect(() => {
        smells.duplicateBodies(p).withMinSimilarity(0.7).minLines(5).check()
      }).toThrow(ArchRuleError)
    })

    it('.warn() does not throw', () => {
      expect(() => {
        smells.duplicateBodies(p).withMinSimilarity(0.7).minLines(5).warn()
      }).not.toThrow()
    })

    it('high similarity threshold finds nothing', () => {
      expect(() => {
        smells.duplicateBodies(p).withMinSimilarity(1.0).minLines(5).check()
      }).not.toThrow()
    })

    it('.because() is accepted in the chain', () => {
      expect(() => {
        smells
          .duplicateBodies(p)
          .withMinSimilarity(0.7)
          .minLines(5)
          .because('copy-pasted parsers should be consolidated')
          .warn()
      }).not.toThrow()
    })
  })

  describe('inconsistentSiblings()', () => {
    const fixturesDir = path.resolve(
      import.meta.dirname,
      '../fixtures/smells/inconsistent-siblings',
    )
    const p = loadProject(fixturesDir)

    it('detects siblings that lack the majority pattern', () => {
      expect(() => {
        smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(3).check()
      }).toThrow(ArchRuleError)
    })

    it('.warn() does not throw', () => {
      expect(() => {
        smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(3).warn()
      }).not.toThrow()
    })
  })
})
