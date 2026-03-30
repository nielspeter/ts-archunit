import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/reverse-deps')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('Reverse dependency conditions', () => {
  const p = loadTestProject()

  describe('onlyBeImportedVia', () => {
    it('catches direct import bypassing barrel', () => {
      // internal/helper.ts is imported by bad-consumer.ts (not via index.ts)
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/helper.ts')
          .should()
          .onlyBeImportedVia('**/public/**', '**/internal/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes when all importers go through allowed paths', () => {
      // public/index.ts is imported only by consumer.ts — check that consumer matches **/src/**
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/public/index.ts')
          .should()
          .onlyBeImportedVia('**/src/**')
          .check()
      }).not.toThrow()
    })

    it('module with no importers passes (vacuously true)', () => {
      // unused.ts has zero importers — vacuously passes
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/unused.ts')
          .should()
          .onlyBeImportedVia('**/public/**')
          .check()
      }).not.toThrow()
    })

    it('multiple allowed globs — any match is OK', () => {
      // internal/helper.ts is imported by public/index.ts AND bad-consumer.ts
      // Allow both patterns — should pass
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/helper.ts')
          .should()
          .onlyBeImportedVia('**/public/**', '**/bad-consumer.ts')
          .check()
      }).not.toThrow()
    })
  })

  describe('beImported', () => {
    it('violation on module with zero importers', () => {
      expect(() => {
        modules(p).that().resideInFile('**/internal/unused.ts').should().beImported().check()
      }).toThrow(ArchRuleError)
    })

    it('passes on module with at least one importer', () => {
      expect(() => {
        modules(p).that().resideInFile('**/internal/helper.ts').should().beImported().check()
      }).not.toThrow()
    })

    it('entry points can be excluded via .excluding()', () => {
      // unused.ts would fail beImported, but we exclude it
      expect(() => {
        modules(p)
          .that()
          .resideInFolder('**/internal/**')
          .should()
          .beImported()
          .excluding('unused.ts')
          .check()
      }).not.toThrow()
    })
  })

  describe('haveNoUnusedExports', () => {
    it('violation on export with zero external references', () => {
      // has-unused-export.ts exports unusedFunction which nobody imports
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-unused-export.ts')
          .should()
          .haveNoUnusedExports()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes when all exports are referenced', () => {
      // consumer.ts exports greet() — but is greet() referenced? Not by this fixture.
      // Use consumer-of-partial.ts which exports result — referenced by nobody either.
      // Let's use internal/helper.ts: exports formatName, referenced by public/index.ts and bad-consumer.ts
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/helper.ts')
          .should()
          .haveNoUnusedExports()
          .check()
      }).not.toThrow()
    })

    it('re-exports count as references (isolated)', () => {
      // reexport-only.ts exports helperTwo — ONLY referenced via re-export in public/index.ts
      // No direct import from any other file. The re-export should count as a reference.
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/reexport-only.ts')
          .should()
          .haveNoUnusedExports()
          .check()
      }).not.toThrow()
    })
  })

  describe('combined with resideInFolder', () => {
    it('scoped beImported works', () => {
      // internal/ has helper.ts (imported) and unused.ts (not imported)
      expect(() => {
        modules(p).that().resideInFolder('**/internal/**').should().beImported().check()
      }).toThrow(ArchRuleError)
    })
  })
})
