import { describe, it, expect, vi } from 'vitest'
import { ArchRuleError } from '../../src/core/errors.js'
import { TestRuleBuilder, stubProject, alwaysFail } from '../support/test-rule-builder.js'

const elements = [
  { name: 'ServiceA', file: `${process.cwd()}/src/a.ts`, line: 5, exported: true },
  { name: 'ServiceB', file: `${process.cwd()}/src/b.ts`, line: 10, exported: true },
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
