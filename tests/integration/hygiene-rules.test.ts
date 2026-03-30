import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import {
  noDeadModules,
  noUnusedExports,
  noStubComments,
  noEmptyBodies,
} from '../../src/rules/hygiene.js'

// ─── Reverse-deps fixtures (dead modules + unused exports) ───────

const reverseDepsDir = path.resolve(import.meta.dirname, '../fixtures/reverse-deps')
const reverseDepsConfig = path.join(reverseDepsDir, 'tsconfig.json')

function loadReverseDepsProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: reverseDepsConfig })
  return {
    tsConfigPath: reverseDepsConfig,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

// ─── Stubs fixtures (stub comments + empty bodies) ───────────────

const stubsDir = path.resolve(import.meta.dirname, '../fixtures/stubs')
const stubsConfig = path.join(stubsDir, 'tsconfig.json')

function loadStubsProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: stubsConfig })
  return {
    tsConfigPath: stubsConfig,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('hygiene rules (integration)', () => {
  describe('noDeadModules()', () => {
    const p = loadReverseDepsProject()

    it('catches module with zero importers', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/unused.ts')
          .should()
          .satisfy(noDeadModules())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for module that is imported', () => {
      // has-unused-export.ts is imported by consumer-of-partial.ts
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-unused-export.ts')
          .should()
          .satisfy(noDeadModules())
          .check()
      }).not.toThrow()
    })

    it('entry points can be excluded via .excluding()', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/unused.ts')
          .should()
          .satisfy(noDeadModules())
          .excluding('unused.ts')
          .check()
      }).not.toThrow()
    })
  })

  describe('noUnusedExports()', () => {
    const p = loadReverseDepsProject()

    it('catches export with zero external references', () => {
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/has-unused-export.ts')
          .should()
          .satisfy(noUnusedExports())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes when all exports are referenced', () => {
      // internal/helper.ts exports formatName, re-exported by public/index.ts
      expect(() => {
        modules(p)
          .that()
          .resideInFile('**/internal/helper.ts')
          .should()
          .satisfy(noUnusedExports())
          .check()
      }).not.toThrow()
    })
  })

  describe('noStubComments()', () => {
    const p = loadStubsProject()

    it('catches HACK comment inside function body', () => {
      // has-hack.ts has `// HACK: hardcoded timeout` inside getTimeout()
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/has-hack.ts')
          .should()
          .satisfy(noStubComments())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for clean functions', () => {
      expect(() => {
        functions(p).that().resideInFile('**/clean.ts').should().satisfy(noStubComments()).check()
      }).not.toThrow()
    })

    it('custom pattern overrides defaults', () => {
      // Custom pattern that does NOT match HACK
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/has-hack.ts')
          .should()
          .satisfy(noStubComments(/NONEXISTENT_PATTERN/))
          .check()
      }).not.toThrow()
    })
  })

  describe('noEmptyBodies()', () => {
    const p = loadStubsProject()

    it('catches empty function body', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/empty-function.ts')
          .should()
          .satisfy(noEmptyBodies())
          .check()
      }).toThrow(ArchRuleError)
    })

    it('passes for functions with body', () => {
      expect(() => {
        functions(p)
          .that()
          .resideInFile('**/empty-function.ts')
          .and()
          .haveNameMatching(/^hasBody$/)
          .should()
          .satisfy(noEmptyBodies())
          .check()
      }).not.toThrow()
    })
  })
})
