import { describe, it, expect, vi } from 'vitest'
import { Project, type ClassDeclaration } from 'ts-morph'
import path from 'node:path'
import { classes } from '../../src/builders/class-rule-builder.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { definePredicate, defineCondition } from '../../src/core/define.js'
import { definePattern } from '../../src/helpers/pattern.js'
import type { ArchFunction } from '../../src/models/arch-function.js'

const pocFixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const pocTsconfigPath = path.join(pocFixturesDir, 'tsconfig.json')

const patternsFixturesDir = path.resolve(import.meta.dirname, '../fixtures/patterns')
const patternsTsconfigPath = path.join(patternsFixturesDir, 'tsconfig.json')

function loadPocProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: pocTsconfigPath })
  return {
    tsConfigPath: pocTsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

function loadPatternsProject(fixture: string): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: patternsTsconfigPath })
  const sourceFiles = tsMorphProject
    .getSourceFiles()
    .filter((sf) => sf.getFilePath().endsWith(`/${fixture}.ts`))
  return {
    tsConfigPath: patternsTsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => sourceFiles,
  }
}

describe('output formats', () => {
  const p = loadPocProject()

  it('format: json — writes JSON to stdout when violations occur', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .because('abstract classes should not exist')
        .check({ format: 'json' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0]?.[0]
      expect(typeof output).toBe('string')
      const parsed: unknown = JSON.parse(output as string)
      expect(parsed).toHaveProperty('summary')
      expect(parsed).toHaveProperty('violations')
      const obj = parsed as { summary: { total: number }; violations: unknown[] }
      expect(obj.summary.total).toBeGreaterThan(0)
      expect(obj.violations.length).toBeGreaterThan(0)
    } finally {
      stdoutSpy.mockRestore()
    }
  })

  it('format: github — writes GitHub annotation commands to stdout', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .because('abstract classes should not exist')
        .check({ format: 'github' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0]?.[0]
      expect(typeof output).toBe('string')
      expect(output as string).toContain('::error')
      expect(output as string).toContain('file=')
      expect(output as string).toContain('Architecture Violation')
    } finally {
      stdoutSpy.mockRestore()
    }
  })

  it('format: terminal (default) — writes to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    try {
      classes(p).that().areAbstract().should().notExist().check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      expect(stderrSpy).toHaveBeenCalled()
    } finally {
      stderrSpy.mockRestore()
    }
  })
})

describe('definePredicate — custom predicates', () => {
  const p = loadPocProject()

  it('custom predicate filters elements in .that().satisfy()', () => {
    const isAbstract = definePredicate<ClassDeclaration>('is abstract', (cls) => cls.isAbstract())

    // BaseService is abstract — filtering by it + notExist() should throw
    expect(() => {
      classes(p).that().satisfy(isAbstract).should().notExist().check()
    }).toThrow(ArchRuleError)
  })

  it('custom predicate that matches nothing yields no violations', () => {
    const hasNamedFoobar = definePredicate<ClassDeclaration>(
      'has name "Foobar"',
      (cls) => cls.getName() === 'Foobar',
    )

    // No class named Foobar exists, so notExist() should pass (empty set)
    expect(() => {
      classes(p).that().satisfy(hasNamedFoobar).should().notExist().check()
    }).not.toThrow()
  })

  it('custom predicate combines with built-in predicates via .and()', () => {
    const hasGetTotal = definePredicate<ClassDeclaration>('has a getTotal method', (cls) =>
      cls.getMethods().some((m) => m.getName() === 'getTotal'),
    )

    // Classes that extend BaseService AND have getTotal should be exported
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .and()
        .satisfy(hasGetTotal)
        .should()
        .beExported()
        .check()
    }).not.toThrow()
  })
})

describe('defineCondition — custom conditions', () => {
  const p = loadPocProject()

  it('custom condition in .should().satisfy() evaluates correctly', () => {
    const mustHaveMethods = defineCondition<ClassDeclaration>(
      'have at least one method',
      (elements, context) => {
        return elements
          .filter((cls) => cls.getMethods().length === 0)
          .map((cls) => ({
            rule: context.rule,
            element: cls.getName() ?? '<anonymous>',
            file: cls.getSourceFile().getFilePath(),
            line: cls.getStartLineNumber(),
            message: `${cls.getName() ?? '<anonymous>'} has no methods`,
            because: context.because,
          }))
      },
    )

    // DomainError has no methods (only constructor) — should produce a violation
    try {
      classes(p).should().satisfy(mustHaveMethods).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      const violatedElements = archError.violations.map((v) => v.element)
      expect(violatedElements).toContain('DomainError')
    }
  })

  it('custom condition passes when all elements satisfy it', () => {
    const allHaveNames = defineCondition<ClassDeclaration>('have a name', (elements, context) => {
      return elements
        .filter((cls) => cls.getName() === undefined)
        .map((cls) => ({
          rule: context.rule,
          element: '<anonymous>',
          file: cls.getSourceFile().getFilePath(),
          line: cls.getStartLineNumber(),
          message: 'class has no name',
          because: context.because,
        }))
    })

    // All classes in the fixture have names
    expect(() => {
      classes(p).should().satisfy(allHaveNames).check()
    }).not.toThrow()
  })
})

describe('pattern templates — definePattern + followPattern', () => {
  it('passes when functions follow the defined pattern', () => {
    const p = loadPatternsProject('paginated-correct')
    const paginatedCollection = definePattern('paginated-collection', {
      returnShape: {
        total: 'number',
        skip: 'number',
        limit: 'number',
        items: 'T[]',
      },
    })

    expect(() => {
      functions(p).should().followPattern(paginatedCollection).check()
    }).not.toThrow()
  })

  it('fails when functions are missing pattern properties', () => {
    const p = loadPatternsProject('paginated-missing')
    const paginatedCollection = definePattern('paginated-collection', {
      returnShape: {
        total: 'number',
        skip: 'number',
        limit: 'number',
        items: 'T[]',
      },
    })

    try {
      functions(p).should().followPattern(paginatedCollection).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      expect(archError.violations.length).toBeGreaterThan(0)
      const msg = archError.violations[0]?.message ?? ''
      expect(msg).toContain('paginated-collection')
      expect(msg).toContain('skip')
      expect(msg).toContain('limit')
    }
  })

  it('handles async functions by unwrapping Promise<T>', () => {
    const p = loadPatternsProject('paginated-async')
    const paginatedCollection = definePattern('paginated-collection', {
      returnShape: {
        total: 'number',
        skip: 'number',
        limit: 'number',
        items: 'T[]',
      },
    })

    expect(() => {
      functions(p).should().followPattern(paginatedCollection).check()
    }).not.toThrow()
  })

  it('detects wrong property types', () => {
    const p = loadPatternsProject('paginated-wrong-type')
    const paginatedCollection = definePattern('paginated-collection', {
      returnShape: {
        total: 'number',
        skip: 'number',
        limit: 'number',
        items: 'T[]',
      },
    })

    try {
      functions(p).should().followPattern(paginatedCollection).check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      const msg = archError.violations[0]?.message ?? ''
      expect(msg).toContain('total')
    }
  })
})

describe('structural conditions', () => {
  const p = loadPocProject()

  it('resideInFile — classes reside in .ts files', () => {
    expect(() => {
      classes(p).that().extend('BaseService').should().shouldResideInFile('**/*.ts').check()
    }).not.toThrow()
  })

  it('resideInFolder — BaseService subclasses reside in src folder', () => {
    expect(() => {
      classes(p).that().extend('BaseService').should().shouldResideInFolder('**/src').check()
    }).not.toThrow()
  })

  it('haveNameMatching via conditionHaveNameMatching', () => {
    expect(() => {
      classes(p)
        .that()
        .extend('BaseService')
        .should()
        .conditionHaveNameMatching(/Service$/)
        .check()
    }).not.toThrow()
  })

  it('beExported — all BaseService subclasses should be exported', () => {
    expect(() => {
      classes(p).that().extend('BaseService').should().beExported().check()
    }).not.toThrow()
  })

  it('notExist — abstract classes should not exist (fails for BaseService)', () => {
    expect(() => {
      classes(p).that().areAbstract().should().notExist().check()
    }).toThrow(ArchRuleError)
  })

  it('notExist — non-existent classes do not produce violations', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^ZZZNonExistent/)
        .should()
        .notExist()
        .check()
    }).not.toThrow()
  })
})

describe('excluding — suppress specific violations', () => {
  const p = loadPocProject()

  it('excluding a specific element by name suppresses its violation', () => {
    // Suppress console.warn for stale exclusion warnings
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // BaseService is abstract; without excluding it, notExist() throws
      expect(() => {
        classes(p).that().areAbstract().should().notExist().excluding('BaseService').check()
      }).not.toThrow()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('excluding with regex suppresses matching violations', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(() => {
        classes(p).that().areAbstract().should().notExist().excluding(/^Base/).check()
      }).not.toThrow()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('excluding warns on unused exclusions', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // "NonExistent" will not match any violation — should trigger a stale warning
      expect(() => {
        classes(p)
          .that()
          .areAbstract()
          .should()
          .notExist()
          .excluding('BaseService', 'NonExistent')
          .check()
      }).not.toThrow()

      const warnings = warnSpy.mock.calls.map((c) => String(c[0]))
      const staleWarning = warnings.find(
        (w: string) => w.includes('Unused exclusion') && w.includes('NonExistent'),
      )
      expect(staleWarning).toBeDefined()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('rule metadata — .rule({ id, because, suggestion, docs })', () => {
  const p = loadPocProject()

  it('metadata appears in violation output', () => {
    try {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .rule({
          id: 'arch/no-abstract',
          because: 'abstract classes couple subclasses',
          suggestion: 'Use composition over inheritance',
          docs: 'https://example.com/adr/001',
        })
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      const v = archError.violations[0]
      expect(v).toBeDefined()
      expect(v?.ruleId).toBe('arch/no-abstract')
      expect(v?.because).toBe('abstract classes couple subclasses')
      expect(v?.suggestion).toBe('Use composition over inheritance')
      expect(v?.docs).toBe('https://example.com/adr/001')
    }
  })

  it('rule metadata .because overrides standalone .because()', () => {
    try {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .because('this reason is overridden')
        .rule({
          id: 'arch/no-abstract',
          because: 'metadata reason wins',
        })
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      expect(archError.message).toContain('metadata reason wins')
    }
  })

  it('rule metadata with only id — no because/suggestion/docs', () => {
    try {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .rule({ id: 'arch/no-abstract-simple' })
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      const v = archError.violations[0]
      expect(v).toBeDefined()
      expect(v?.ruleId).toBe('arch/no-abstract-simple')
      expect(v?.suggestion).toBeUndefined()
      expect(v?.docs).toBeUndefined()
    }
  })
})

describe('severity — .severity("error") and .severity("warn")', () => {
  const p = loadPocProject()

  it('severity("error") throws ArchRuleError on violations', () => {
    expect(() => {
      classes(p).that().areAbstract().should().notExist().severity('error')
    }).toThrow(ArchRuleError)
  })

  it('severity("warn") does not throw on violations', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(() => {
        classes(p).that().areAbstract().should().notExist().severity('warn')
      }).not.toThrow()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('severity("error") does not throw when there are no violations', () => {
    expect(() => {
      classes(p).that().extend('BaseService').should().beExported().severity('error')
    }).not.toThrow()
  })

  it('severity("warn") does not throw when there are no violations', () => {
    expect(() => {
      classes(p).that().extend('BaseService').should().beExported().severity('warn')
    }).not.toThrow()
  })
})

describe('warn terminal method', () => {
  const p = loadPocProject()

  it('.warn() does not throw even with violations', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(() => {
        classes(p).that().areAbstract().should().notExist().because('should not exist').warn()
      }).not.toThrow()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('.warn() with format: json writes to stderr', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      classes(p).that().areAbstract().should().notExist().warn({ format: 'json' })

      expect(warnSpy).toHaveBeenCalled()
      const output = String(warnSpy.mock.calls[0]?.[0])
      expect(typeof output).toBe('string')
      const parsed: unknown = JSON.parse(output)
      expect(parsed).toHaveProperty('summary')
      expect(parsed).toHaveProperty('violations')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('.warn() with format: github writes ::warning annotations', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      classes(p).that().areAbstract().should().notExist().warn({ format: 'github' })

      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0]?.[0]
      expect(typeof output).toBe('string')
      expect(output as string).toContain('::warning')
    } finally {
      stdoutSpy.mockRestore()
    }
  })
})

describe('json output includes rule metadata', () => {
  const p = loadPocProject()

  it('json format includes ruleId, because, suggestion, and docs', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .rule({
          id: 'arch/no-abstract-json',
          because: 'composition over inheritance',
          suggestion: 'Use interfaces',
          docs: 'https://example.com/docs',
        })
        .check({ format: 'json' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0]?.[0]
      const parsed = JSON.parse(output as string) as {
        violations: Array<{
          ruleId: string | null
          because: string | null
          suggestion: string | null
          docs: string | null
        }>
      }
      const v = parsed.violations[0]
      expect(v).toBeDefined()
      expect(v?.ruleId).toBe('arch/no-abstract-json')
      expect(v?.because).toBe('composition over inheritance')
      expect(v?.suggestion).toBe('Use interfaces')
      expect(v?.docs).toBe('https://example.com/docs')
    } finally {
      stdoutSpy.mockRestore()
    }
  })
})

describe('github output includes metadata in annotations', () => {
  const p = loadPocProject()

  it('github format includes suggestion and docs in annotation message', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      classes(p)
        .that()
        .areAbstract()
        .should()
        .notExist()
        .rule({
          id: 'arch/no-abstract-gh',
          because: 'coupling risk',
          suggestion: 'Use composition',
          docs: 'https://example.com/docs',
        })
        .check({ format: 'github' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0]?.[0] as string
      expect(output).toContain('arch/no-abstract-gh')
      expect(output).toContain('Fix: Use composition')
      expect(output).toContain('Docs: https://example.com/docs')
    } finally {
      stdoutSpy.mockRestore()
    }
  })
})

describe('custom predicate + custom condition combined', () => {
  const p = loadPocProject()

  it('definePredicate + defineCondition together through full fluent chain', () => {
    const extendsBaseService = definePredicate<ClassDeclaration>('extends BaseService', (cls) => {
      const baseClass = cls.getBaseClass()
      return baseClass?.getName() === 'BaseService'
    })

    const shouldHaveGetTotal = defineCondition<ClassDeclaration>(
      'have a getTotal method',
      (elements, context) => {
        return elements
          .filter((cls) => !cls.getMethods().some((m) => m.getName() === 'getTotal'))
          .map((cls) => ({
            rule: context.rule,
            element: cls.getName() ?? '<anonymous>',
            file: cls.getSourceFile().getFilePath(),
            line: cls.getStartLineNumber(),
            message: `${cls.getName() ?? '<anonymous>'} is missing getTotal()`,
            because: context.because,
          }))
      },
    )

    // EdgeCaseService extends BaseService but has no getTotal() method
    try {
      classes(p)
        .that()
        .satisfy(extendsBaseService)
        .should()
        .satisfy(shouldHaveGetTotal)
        .because('all services need a getTotal method')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      const violatedElements = archError.violations.map((v) => v.element)
      expect(violatedElements).toContain('EdgeCaseService')
      expect(archError.violations[0]?.because).toBe('all services need a getTotal method')
    }
  })
})

describe('function-level custom predicate via definePredicate', () => {
  const p = loadPocProject()

  it('custom ArchFunction predicate filters functions', () => {
    const startsWithParse = definePredicate<ArchFunction>('starts with "parse"', (fn) => {
      const name = fn.getName()
      return name !== undefined && name.startsWith('parse')
    })

    // parseFooOrder, parseBarOrder, parseBazOrder, parseConfig — all start with "parse"
    try {
      functions(p)
        .that()
        .satisfy(startsWithParse)
        .should()
        .notExist()
        .because('use shared utility instead')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      const archError = error as ArchRuleError
      expect(archError.violations.length).toBeGreaterThanOrEqual(3)
    }
  })
})
