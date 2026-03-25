import { describe, it, expect } from 'vitest'
import { Project, type SourceFile } from 'ts-morph'
import path from 'node:path'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ConditionContext } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'

// Minimal SourceFile-based builder for integration testing
class SourceFileRuleBuilder extends RuleBuilder<SourceFile> {
  protected getElements(): SourceFile[] {
    return this.project.getSourceFiles()
  }

  fileNameContains(substring: string): this {
    return this.addPredicate({
      description: `file name contains "${substring}"`,
      test: (sf) => sf.getBaseName().includes(substring),
    })
  }

  haveClassNamed(name: string): this {
    return this.addCondition({
      description: `have class named "${name}"`,
      evaluate: (sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] =>
        sourceFiles
          .filter((sf) => !sf.getClasses().some((c) => c.getName() === name))
          .map((sf) => ({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `Expected class "${name}" in ${sf.getBaseName()}`,
            because: context.because,
          })),
    })
  }

  containExport(): this {
    return this.addCondition({
      description: 'contain at least one export',
      evaluate: (sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] =>
        sourceFiles
          .filter((sf) => sf.getExportedDeclarations().size === 0)
          .map((sf) => ({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `No exports found in ${sf.getBaseName()}`,
            because: context.because,
          })),
    })
  }
}

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('rule chain integration (PoC fixtures)', () => {
  const p = loadTestProject()

  it('passes a rule that all source files have exports', () => {
    expect(() => {
      new SourceFileRuleBuilder(p).should().containExport().check()
    }).not.toThrow()
  })

  it('fails a rule that every file has a class named "NonExistent"', () => {
    expect(() => {
      new SourceFileRuleBuilder(p).should().haveClassNamed('NonExistent').check()
    }).toThrow(ArchRuleError)
  })

  it('filters files with predicates before evaluating conditions', () => {
    expect(() => {
      new SourceFileRuleBuilder(p)
        .that()
        .fileNameContains('base-service')
        .should()
        .haveClassNamed('BaseService')
        .check()
    }).not.toThrow()
  })

  it('chains because() with check()', () => {
    try {
      new SourceFileRuleBuilder(p)
        .should()
        .haveClassNamed('NonExistent')
        .because('every file should define this class')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('every file should define this class')
      expect(archError.violations.length).toBeGreaterThan(0)
    }
  })
})
