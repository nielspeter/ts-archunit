import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import {
  noSilentCatch,
  functionNoSilentCatch,
  moduleNoSilentCatch,
} from '../../src/rules/errors.js'
import { findSilentCatches } from '../../src/conditions/catch-analysis.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/rules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('noSilentCatch() — class variant', () => {
  const p = loadTestProject()

  // ─── Violations ────────────────────────────────────────────────

  it('catches catch block with no binding', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchNoBinding$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches catch block with unused binding', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchUnusedBinding$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches catch block that returns null without referencing error', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchReturnNull$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches underscore-prefixed but unreferenced binding', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchUnderscorePrefix$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches truly empty catch body', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchEmptyBody$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches console.log with hardcoded string but no error reference', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchHardcodedLog$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  // Destructured catch bindings tested via findSilentCatches() below
  // (strict TypeScript disallows catch ({ message }))

  // ─── Passes ────────────────────────────────────────────────────

  it('passes when error is rethrown', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CleanCatchRethrow$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).not.toThrow()
  })

  it('passes when error is logged', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CleanCatchLog$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).not.toThrow()
  })

  it('passes when error is passed to a function', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CleanCatchPassToFunction$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).not.toThrow()
  })

  it('passes when error is inspected with instanceof', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CleanCatchInstanceOf$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).not.toThrow()
  })

  it('passes when error property is accessed', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CleanCatchPropertyAccess$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).not.toThrow()
  })

  // Destructured catch pass case tested via findSilentCatches() below

  it('passes for class with no try/catch', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CleanNoCatch$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).not.toThrow()
  })

  // ─── Constructors / getters / setters ──────────────────────────

  it('scans constructors — catches silent catch in constructor', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchConstructor$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('scans getters — catches silent catch in getter', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchGetter$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('scans setters — catches silent catch in setter', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^SilentCatchSetter$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  // ─── Violation message assertions ──────────────────────────────

  it('violation for no-binding catch says "no error binding"', () => {
    const violations = classes(p)
      .that()
      .haveNameMatching(/^SilentCatchNoBinding$/)
      .should()
      .satisfy(noSilentCatch())
      .violations()

    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('no error binding')
  })

  it('violation for unused binding says "never references it"', () => {
    const violations = classes(p)
      .that()
      .haveNameMatching(/^SilentCatchUnusedBinding$/)
      .should()
      .satisfy(noSilentCatch())
      .violations()

    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('never references it')
  })

  // ─── Structural edge cases ─────────────────────────────────────

  it('reports exactly one violation when method has two catches, one silent', () => {
    const violations = classes(p)
      .that()
      .haveNameMatching(/^MultipleCatches$/)
      .should()
      .satisfy(noSilentCatch())
      .violations()

    expect(violations).toHaveLength(1)
  })

  it('finds silent catch inside arrow function within method', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CatchInArrowInMethod$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('catches silent catch even with finally block', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^CatchWithFinally$/)
        .should()
        .satisfy(noSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('functionNoSilentCatch() — function variant', () => {
  const p = loadTestProject()

  it('catches silent catch in standalone function', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/silent-catch.ts')
        .and()
        .haveNameMatching(/^silentCatchFunction$/)
        .should()
        .satisfy(functionNoSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes for clean function', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/silent-catch.ts')
        .and()
        .haveNameMatching(/^cleanCatchFunction$/)
        .should()
        .satisfy(functionNoSilentCatch())
        .check()
    }).not.toThrow()
  })

  it('passes for expression-bodied arrow (no block body)', () => {
    expect(() => {
      functions(p)
        .that()
        .resideInFile('**/silent-catch.ts')
        .and()
        .haveNameMatching(/^expressionBodiedArrow$/)
        .should()
        .satisfy(functionNoSilentCatch())
        .check()
    }).not.toThrow()
  })
})

describe('moduleNoSilentCatch() — module variant', () => {
  const p = loadTestProject()

  it('catches silent catch anywhere in module', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/silent-catch.ts')
        .should()
        .satisfy(moduleNoSilentCatch())
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes for module with no silent catches', () => {
    expect(() => {
      modules(p)
        .that()
        .resideInFile('**/clean-class.ts')
        .should()
        .satisfy(moduleNoSilentCatch())
        .check()
    }).not.toThrow()
  })
})

describe('findSilentCatches() — destructured catch bindings', () => {
  function createNonStrictProject() {
    return new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { strict: false, useUnknownInCatchVariables: false },
    })
  }

  it('passes when destructured property is referenced', () => {
    const proj = createNonStrictProject()
    const sf = proj.createSourceFile(
      't.ts',
      'function f() { try { x() } catch ({ message }) { console.log(message) } }',
    )
    const fn = sf.getFunctions()[0]!
    const results = findSilentCatches(fn.getBody()!)
    expect(results).toHaveLength(0)
  })

  it('catches destructured binding where no property is referenced', () => {
    const proj = createNonStrictProject()
    const sf = proj.createSourceFile(
      't.ts',
      'function f() { try { x() } catch ({ message }) { return null } }',
    )
    const fn = sf.getFunctions()[0]!
    const results = findSilentCatches(fn.getBody()!)
    expect(results).toHaveLength(1)
    expect(results[0]!.message).toContain('never references it')
  })

  it('passes when at least one destructured property is referenced', () => {
    const proj = createNonStrictProject()
    const sf = proj.createSourceFile(
      't.ts',
      'function f() { try { x() } catch ({ message, code }) { console.log(message) } }',
    )
    const fn = sf.getFunctions()[0]!
    const results = findSilentCatches(fn.getBody()!)
    expect(results).toHaveLength(0)
  })

  it('handles array destructured catch binding — referenced', () => {
    const proj = createNonStrictProject()
    const sf = proj.createSourceFile(
      't.ts',
      'function f() { try { x() } catch ([code, msg]) { console.log(msg) } }',
    )
    const fn = sf.getFunctions()[0]!
    const results = findSilentCatches(fn.getBody()!)
    expect(results).toHaveLength(0)
  })

  it('handles array destructured catch binding — unreferenced', () => {
    const proj = createNonStrictProject()
    const sf = proj.createSourceFile(
      't.ts',
      'function f() { try { x() } catch ([code, msg]) { return null } }',
    )
    const fn = sf.getFunctions()[0]!
    const results = findSilentCatches(fn.getBody()!)
    expect(results).toHaveLength(1)
  })
})
