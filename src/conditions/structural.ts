import { Node } from 'ts-morph'
import picomatch from 'picomatch'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementFile, getElementName } from '../core/violation.js'
import { elementCondition } from './helpers.js'
import { globNode } from '../core/glob-site.js'
import { marksAssertsCardinality } from '../core/cardinality.js'

/**
 * Elements must reside in a file matching the glob pattern.
 *
 * Uses picomatch for glob matching against the absolute file path.
 *
 * @example
 * // Assert all matched elements are in repository files
 * .should(resideInFile('** /repositories/*.ts'))
 */
export function resideInFile<T extends Node>(glob: string): Condition<T> {
  const isMatch = picomatch(glob)
  return elementCondition<T>(
    `reside in file matching '${glob}'`,
    (element) => isMatch(getElementFile(element)),
    (element) =>
      `${getElementName(element)} resides in '${getElementFile(element)}' which does not match '${glob}'`,
    // The generic element twin of `function.ts`'s condition and of the
    // `identity.ts:78` predicate — same absolute path, so the same kind. Plan
    // 0073's table listed only the `function.ts` pair; these two are exported from
    // `index.ts:86` and used by the class, module and type builders, so they were
    // the more reachable half of the hole.
    globNode({ glob, kind: 'file-path' }),
  )
}

/**
 * Elements must reside in a folder matching the glob pattern.
 *
 * Matches against the directory portion of the file path (everything
 * before the last path separator).
 *
 * @example
 * // Assert all matched elements are in the services folder
 * .should(resideInFolder('** /services'))
 */
export function resideInFolder<T extends Node>(glob: string): Condition<T> {
  const isMatch = picomatch(glob)
  return elementCondition<T>(
    `reside in folder matching '${glob}'`,
    (element) => {
      const filePath = getElementFile(element)
      const folder = filePath.substring(0, filePath.lastIndexOf('/'))
      return isMatch(folder)
    },
    (element) => {
      const filePath = getElementFile(element)
      const folder = filePath.substring(0, filePath.lastIndexOf('/'))
      return `${getElementName(element)} resides in folder '${folder}' which does not match '${glob}'`
    },
    globNode({ glob, kind: 'parent-dir' }),
  )
}

/**
 * Elements must have a name matching the regex pattern.
 *
 * @example
 * // Assert all matched elements follow the naming convention
 * .should(haveNameMatching(/Service$/))
 */
export function haveNameMatching<T extends Node>(regex: RegExp): Condition<T> {
  return elementCondition<T>(
    `have name matching ${String(regex)}`,
    (element) => regex.test(getElementName(element)),
    (element) => `${getElementName(element)} does not have a name matching ${String(regex)}`,
  )
}

/**
 * Elements must be exported from their module.
 *
 * Checks for the `export` keyword on the node. For variable declarations,
 * checks the parent variable statement.
 *
 * @example
 * // Assert all matched services are exported
 * .should(beExported())
 */
export function beExported<T extends Node>(): Condition<T> {
  return elementCondition<T>(
    'be exported',
    (element) => {
      // ts-morph type guards for nodes with isExported()
      if (
        Node.isClassDeclaration(element) ||
        Node.isFunctionDeclaration(element) ||
        Node.isInterfaceDeclaration(element) ||
        Node.isTypeAliasDeclaration(element) ||
        Node.isEnumDeclaration(element)
      ) {
        return element.isExported()
      }
      // VariableDeclaration — check parent VariableStatement
      if (Node.isVariableDeclaration(element)) {
        const varStatement = element.getVariableStatement()
        if (varStatement) {
          return varStatement.isExported()
        }
      }
      return false
    },
    (element) => `${getElementName(element)} is not exported`,
  )
}

/**
 * The predicate set must be empty — no elements should match.
 *
 * This is a set-level condition, not an element-level condition.
 * If ANY elements exist after predicate filtering, each one becomes
 * a violation with the message "X should not exist".
 *
 * @example
 * // Assert no parse*Order functions exist
 * functions(project)
 *   .that(haveNameMatching(/^parse\w+Order$/))
 *   .should(notExist())
 *   .because('use shared parseOrder() utility instead')
 */
export function notExist<T extends Node>(): Condition<T> {
  // Satisfied by an EMPTY selection — registered rather than tagged, because a
  // symbol keyed on this object is readable off it and forgeable (bug 0050).
  return marksAssertsCardinality({
    description: 'not exist',
    // Zero subjects is this condition's PASSING state, so an empty selection
    // and an unsatisfiable selector glob are both correct here (plan 0074).
    evaluate(elements: T[], context: ConditionContext): ArchViolation[] {
      return elements.map((element) =>
        createViolation(element, `${getElementName(element)} should not exist`, context),
      )
    },
  })
}
