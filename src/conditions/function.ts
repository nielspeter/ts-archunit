import picomatch from 'picomatch'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ArchFunction } from '../models/arch-function.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'

/**
 * Helper to create a per-element condition for ArchFunction.
 */
function functionCondition(
  description: string,
  predicate: (fn: ArchFunction) => boolean,
  messageFn: (fn: ArchFunction) => string,
): Condition<ArchFunction> {
  return {
    description,
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        if (!predicate(fn)) {
          violations.push({
            rule: context.rule,
            element: fn.getName() ?? '<anonymous>',
            file: fn.getSourceFile().getFilePath(),
            line: fn.getStartLineNumber(),
            message: messageFn(fn),
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * The predicate set must be empty — no functions should match.
 *
 * If ANY functions exist after predicate filtering, each one
 * becomes a violation.
 *
 * @example
 * functions(project)
 *   .that().haveNameMatching(/^parse\w+Order$/)
 *   .should(notExist())
 *   .because('use shared parseOrder() utility instead')
 */
export function notExist(): Condition<ArchFunction> {
  return {
    description: 'not exist',
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      return elements.map((fn) => ({
        rule: context.rule,
        element: fn.getName() ?? '<anonymous>',
        file: fn.getSourceFile().getFilePath(),
        line: fn.getStartLineNumber(),
        message: `${fn.getName() ?? '<anonymous>'} should not exist`,
        because: context.because,
      }))
    },
  }
}

/**
 * Functions must be exported from their module.
 */
export function beExported(): Condition<ArchFunction> {
  return functionCondition(
    'be exported',
    (fn) => fn.isExported(),
    (fn) => `${fn.getName() ?? '<anonymous>'} is not exported`,
  )
}

/**
 * Functions must be async.
 */
export function beAsync(): Condition<ArchFunction> {
  return functionCondition(
    'be async',
    (fn) => fn.isAsync(),
    (fn) => `${fn.getName() ?? '<anonymous>'} is not async`,
  )
}

/**
 * Functions must have a name matching the given pattern.
 */
export function haveNameMatching(pattern: RegExp): Condition<ArchFunction> {
  return functionCondition(
    `have name matching ${String(pattern)}`,
    (fn) => {
      const name = fn.getName()
      return name !== undefined && pattern.test(name)
    },
    (fn) => `${fn.getName() ?? '<anonymous>'} does not have a name matching ${String(pattern)}`,
  )
}

/**
 * Assert that at least one parameter of the function has a type matching
 * the given matcher.
 *
 * Passes when at least one parameter satisfies `matcher`.
 * Reports one violation per function that has no matching parameter.
 *
 * **Scope note:** This operates on the function's own parameter list only.
 * Unlike the class-level counterpart, it does NOT scan set accessors
 * because `collectFunctions()` excludes them.
 */
export function acceptParameterOfType(matcher: TypeMatcher): Condition<ArchFunction> {
  return functionCondition(
    'accept parameter of matching type',
    (fn) => fn.getParameters().some((p) => matcher(p.getType())),
    (fn) => `${fn.getName() ?? '<anonymous>'} has no parameter with matching type`,
  )
}

/**
 * Assert that NO parameter of the function has a type matching the given
 * matcher.
 *
 * Reports one violation **per parameter** whose type satisfies `matcher`,
 * with actionable messages including the parameter name and type.
 *
 * **Scope note:** This operates on the function's own parameter list only.
 * Unlike the class-level counterpart, it does NOT scan set accessors
 * because `collectFunctions()` excludes them.
 */
export function notAcceptParameterOfType(matcher: TypeMatcher): Condition<ArchFunction> {
  return {
    description: 'not accept parameter of matching type',
    evaluate(elements: ArchFunction[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const fn of elements) {
        const fnName = fn.getName() ?? '<anonymous>'
        for (const param of fn.getParameters()) {
          if (matcher(param.getType())) {
            const paramName = param.getName()
            const typeText = param.getType().getText()
            violations.push({
              rule: context.rule,
              element: fnName,
              file: fn.getSourceFile().getFilePath(),
              line: fn.getStartLineNumber(),
              message: `${fnName} parameter "${paramName}" has type "${typeText}"`,
              because: context.because,
            })
          }
        }
      }
      return violations
    },
  }
}

/**
 * Functions must have a return type that satisfies the given TypeMatcher.
 *
 * Unlike the `haveReturnType` predicate (which filters with RegExp),
 * this is a condition (assertion in `.should()`) that uses TypeMatcher
 * for composability with `isString()`, `matching()`, `not()`, `exactly()`, etc.
 *
 * @example
 * functions(project)
 *   .that().haveNameMatching(/^list/)
 *   .should().haveReturnTypeMatching(matching(/Collection/))
 *   .check()
 */
export function haveReturnTypeMatching(matcher: TypeMatcher): Condition<ArchFunction> {
  return functionCondition(
    'have return type matching the expected type constraint',
    (fn) => matcher(fn.getReturnType()),
    (fn) =>
      `${fn.getName() ?? '<anonymous>'} has return type '${fn.getReturnType().getText()}' which does not match the expected type constraint`,
  )
}

/**
 * Functions must reside in a file matching the glob.
 * ArchFunction is not a ts-morph Node, so the generic structural condition
 * cannot be used — this is the ArchFunction-specific equivalent.
 */
export function resideInFile(glob: string): Condition<ArchFunction> {
  const isMatch = picomatch(glob)
  return functionCondition(
    `reside in file matching '${glob}'`,
    (fn) => isMatch(fn.getSourceFile().getFilePath()),
    (fn) =>
      `${fn.getName() ?? '<anonymous>'} resides in '${fn.getSourceFile().getFilePath()}' which does not match '${glob}'`,
  )
}

/**
 * Functions must reside in a folder matching the glob.
 * ArchFunction is not a ts-morph Node, so the generic structural condition
 * cannot be used — this is the ArchFunction-specific equivalent.
 */
export function resideInFolder(glob: string): Condition<ArchFunction> {
  const isMatch = picomatch(glob)
  return functionCondition(
    `reside in folder matching '${glob}'`,
    (fn) => {
      const filePath = fn.getSourceFile().getFilePath()
      const folder = filePath.substring(0, filePath.lastIndexOf('/'))
      return isMatch(folder)
    },
    (fn) => {
      const filePath = fn.getSourceFile().getFilePath()
      const folder = filePath.substring(0, filePath.lastIndexOf('/'))
      return `${fn.getName() ?? '<anonymous>'} resides in folder '${folder}' which does not match '${glob}'`
    },
  )
}
