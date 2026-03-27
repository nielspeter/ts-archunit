import { describe, it, expect } from 'vitest'
import { Project, type ClassDeclaration } from 'ts-morph'
import path from 'node:path'
import { acceptParameterOfType, notAcceptParameterOfType } from '../../src/conditions/class.js'
import { matching } from '../../src/helpers/type-matchers.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const project = new Project({ tsConfigFilePath: tsconfigPath })

function getClass(name: string): ClassDeclaration {
  for (const sf of project.getSourceFiles()) {
    const cls = sf.getClass(name)
    if (cls) return cls
  }
  throw new Error(`Class ${name} not found in fixtures`)
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('acceptParameterOfType()', () => {
  it('passes when constructor has matching param', () => {
    const cond = acceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('ServiceAcceptingDb')], ctx)
    expect(violations).toHaveLength(0)
  })

  it('passes when method has matching param', () => {
    const cond = acceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('ServiceWithDbMethod')], ctx)
    expect(violations).toHaveLength(0)
  })

  it('fails when no param matches', () => {
    const cond = acceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('CleanService')], ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('has no parameter with matching type')
  })

  it('scans constructor AND methods — class with matching param only in a method still passes', () => {
    // ServiceWithDbMethod has DatabaseClient only in a method, not constructor
    const cond = acceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('ServiceWithDbMethod')], ctx)
    expect(violations).toHaveLength(0)
  })
})

describe('notAcceptParameterOfType()', () => {
  it('passes when no param matches', () => {
    const cond = notAcceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('CleanService')], ctx)
    expect(violations).toHaveLength(0)
  })

  it('reports violation per matching param', () => {
    const cond = notAcceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('RepoAcceptingDb')], ctx)
    // RepoAcceptingDb constructor has db: DatabaseClient (1 match), logger: Logger (no match)
    expect(violations).toHaveLength(1)
  })

  it('reports violations across members', () => {
    const cond = notAcceptParameterOfType(matching(/DatabaseClient/))
    // ServiceWithDbEverywhere has DatabaseClient in both constructor and reconnect method
    const violations = cond.evaluate([getClass('ServiceWithDbEverywhere')], ctx)
    expect(violations).toHaveLength(2)
  })

  it('violation message includes member name and param name', () => {
    const cond = notAcceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('ServiceAcceptingDb')], ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('constructor')
    expect(violations[0]!.message).toContain('"db"')
  })

  it('violation message includes type text', () => {
    const cond = notAcceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getClass('ServiceAcceptingDb')], ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('DatabaseClient')
  })
})
