import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules } from '../../src/builders/module-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { comment, STUB_PATTERNS } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/stubs')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('comment() matcher', () => {
  const p = loadTestProject()

  it('catches // TODO comment', () => {
    expect(() => {
      modules(p).that().resideInFile('**/has-todo.ts').should().notContain(comment(/TODO/)).check()
    }).toThrow(ArchRuleError)
  })

  it('catches /* FIXME */ block comment', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-fixme-block.ts')
        .should()
        .notContain(comment(/FIXME/))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches HACK comment inside function', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/has-hack.ts')
        .should()
        .notContain(comment(/HACK/))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('does NOT match TODO/FIXME inside string literals', () => {
    // todo-in-string.ts has 'TODO: fix this later' and 'FIXME: known issue' as strings, not comments
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/todo-in-string.ts')
        .should()
        .notContain(comment(/TODO|FIXME/))
        .check()
    }).not.toThrow()
  })

  it('no false positives on clean module', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/clean.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).not.toThrow()
  })
})

describe('STUB_PATTERNS', () => {
  const p = loadTestProject()

  it('catches TODO', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-todo.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches FIXME', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-fixme-block.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches HACK', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/has-hack.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches STUB and "coming soon"', () => {
    // has-stub-marker.ts has "STUB" and "coming soon" in comments
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-stub-marker.ts')
        .should()
        .notContain(comment(STUB_PATTERNS))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('custom pattern overrides defaults', () => {
    // Only look for DEFERRED — none of the fixtures have it
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/has-todo.ts')
        .should()
        .notContain(comment(/DEFERRED/))
        .check()
    }).not.toThrow()
  })
})

describe('notHaveEmptyBody — functions', () => {
  const p = loadTestProject()

  it('catches empty function body', () => {
    expect(() => {
      functions(p).that().resideInFile('**/empty-function.ts').should().notHaveEmptyBody().check()
    }).toThrow(ArchRuleError)
  })

  it('passes function with body', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/empty-function.ts')
        .and()
        .haveNameMatching(/^hasBody$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).not.toThrow()
  })

  it('expression-bodied arrow always passes', () => {
    // arrowWithBody = () => 42 — expression body, not a block
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/empty-function.ts')
        .and()
        .haveNameMatching(/^arrowWithBody$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).not.toThrow()
  })

  it('catches function with only a comment (still empty)', () => {
    // commentOnlyBody has { // TODO: implement this } — zero statements
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/empty-function.ts')
        .and()
        .haveNameMatching(/^commentOnlyBody$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('notHaveEmptyBody — classes', () => {
  const p = loadTestProject()

  it('catches empty class', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^EmptyClass$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes class with members', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^NonEmptyClass$/)
        .should()
        .notHaveEmptyBody()
        .check()
    }).not.toThrow()
  })
})
