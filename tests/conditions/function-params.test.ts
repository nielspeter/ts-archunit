import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { acceptParameterOfType, notAcceptParameterOfType } from '../../src/conditions/function.js'
import { matching } from '../../src/helpers/type-matchers.js'
import { collectFunctions } from '../../src/models/arch-function.js'
import type { ConditionContext } from '../../src/core/condition.js'
import type { ArchFunction } from '../../src/models/arch-function.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const project = new Project({ tsConfigFilePath: tsconfigPath })

function getAllFunctions(): ArchFunction[] {
  return project.getSourceFiles().flatMap((sf) => collectFunctions(sf))
}

function getFunctionByName(name: string): ArchFunction {
  const fn = getAllFunctions().find((f) => f.getName() === name)
  if (!fn) throw new Error(`Function '${name}' not found in fixtures`)
  return fn
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('acceptParameterOfType()', () => {
  it('passes when function has matching param', () => {
    const cond = acceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getFunctionByName('createServiceWithDb')], ctx)
    expect(violations).toHaveLength(0)
  })

  it('fails when no param matches', () => {
    const cond = acceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getFunctionByName('createCleanService')], ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('has no parameter with matching type')
  })
})

describe('notAcceptParameterOfType()', () => {
  it('passes when no param matches', () => {
    const cond = notAcceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getFunctionByName('createCleanService')], ctx)
    expect(violations).toHaveLength(0)
  })

  it('reports violation for matching param', () => {
    const cond = notAcceptParameterOfType(matching(/DatabaseClient/))
    const violations = cond.evaluate([getFunctionByName('createServiceWithDb')], ctx)
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('createServiceWithDb')
    expect(violations[0]!.message).toContain('"db"')
    expect(violations[0]!.message).toContain('DatabaseClient')
  })
})
