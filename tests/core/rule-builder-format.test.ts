import { describe, it, expect, vi } from 'vitest'
import { RuleBuilder } from '../../src/core/rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import type { Predicate } from '../../src/core/predicate.js'
import type { Condition, ConditionContext } from '../../src/core/condition.js'
import type { ArchViolation } from '../../src/core/violation.js'

// --- Test element type ---
interface TestElement {
  name: string
  file: string
  line: number
}

// --- Test-only concrete builder ---
class TestRuleBuilder extends RuleBuilder<TestElement> {
  constructor(
    project: ArchProject,
    private elements: TestElement[],
  ) {
    super(project)
  }

  protected getElements(): TestElement[] {
    return this.elements
  }

  withPredicate(predicate: Predicate<TestElement>): this {
    return this.addPredicate(predicate)
  }

  withCondition(condition: Condition<TestElement>): this {
    return this.addCondition(condition)
  }
}

// --- Helpers ---

function alwaysFail(): Condition<TestElement> {
  return {
    description: 'always fails',
    evaluate: (elements: TestElement[], context: ConditionContext): ArchViolation[] =>
      elements.map((el) => ({
        rule: context.rule,
        element: el.name,
        file: el.file,
        line: el.line,
        message: `violation in ${el.name}`,
        because: context.because,
      })),
  }
}

const stubProject = {} as ArchProject

const elements: TestElement[] = [
  { name: 'ServiceA', file: `${process.cwd()}/src/a.ts`, line: 5 },
  { name: 'ServiceB', file: `${process.cwd()}/src/b.ts`, line: 10 },
]

describe('RuleBuilder with format option', () => {
  it('check({ format: "github" }) prints annotations and throws', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const builder = new TestRuleBuilder(stubProject, elements)
    expect(() => {
      builder.should().withCondition(alwaysFail()).check({ format: 'github' })
    }).toThrow(ArchRuleError)

    expect(writeSpy).toHaveBeenCalledOnce()
    const output = String(writeSpy.mock.calls[0]?.[0])
    expect(output).toContain('::error file=')
    expect(output).toContain('ServiceA')

    writeSpy.mockRestore()
  })

  it('warn({ format: "json" }) prints JSON to stderr', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const builder = new TestRuleBuilder(stubProject, elements)
    builder.should().withCondition(alwaysFail()).warn({ format: 'json' })

    expect(warnSpy).toHaveBeenCalledOnce()
    const output = String(warnSpy.mock.calls[0]?.[0])
    const parsed = JSON.parse(output) as { summary: { total: number } }
    expect(parsed.summary.total).toBe(2)

    warnSpy.mockRestore()
  })

  it('warn({ format: "github" }) prints ::warning annotations', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const builder = new TestRuleBuilder(stubProject, elements)
    builder.should().withCondition(alwaysFail()).warn({ format: 'github' })

    expect(writeSpy).toHaveBeenCalledOnce()
    const output = String(writeSpy.mock.calls[0]?.[0])
    expect(output).toContain('::warning file=')
    expect(output).not.toContain('::error')

    writeSpy.mockRestore()
  })

  it('check() without format uses terminal (backward compatible)', () => {
    const builder = new TestRuleBuilder(stubProject, elements)
    expect(() => {
      builder.should().withCondition(alwaysFail()).check()
    }).toThrow(ArchRuleError)
  })
})
