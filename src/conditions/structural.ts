import { Node } from 'ts-morph'
import picomatch from 'picomatch'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { createViolation, getElementFile, getElementName } from '../core/violation.js'
import { elementCondition } from './helpers.js'

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
  return {
    description: 'not exist',
    evaluate(elements: T[], context: ConditionContext): ArchViolation[] {
      return elements.map((element) =>
        createViolation(element, `${getElementName(element)} should not exist`, context),
      )
    },
  }
}
