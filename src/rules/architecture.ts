import type { ClassDeclaration } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import type { ArchFunction } from '../models/arch-function.js'
import { call } from '../helpers/matchers.js'
import { classContain } from '../conditions/body-analysis.js'
import { functionContain } from '../conditions/body-analysis-function.js'

/**
 * Function body must contain at least one call matching the pattern.
 * Use to enforce that a layer actually delegates to its dependency.
 */
export function mustCall(pattern: RegExp): Condition<ArchFunction> {
  return functionContain(call(pattern))
}

export function classMustCall(pattern: RegExp): Condition<ClassDeclaration> {
  return classContain(call(pattern))
}
