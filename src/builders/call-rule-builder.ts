import type { ArchProject } from '../core/project.js'
import { RuleBuilder } from '../core/rule-builder.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ArchCall } from '../models/arch-call.js'
import { collectCalls } from '../models/arch-call.js'
import {
  haveNameMatching as identityHaveNameMatching,
  haveNameStartingWith as identityHaveNameStartingWith,
  haveNameEndingWith as identityHaveNameEndingWith,
  resideInFile as identityResideInFile,
  resideInFolder as identityResideInFolder,
} from '../predicates/identity.js'
import {
  onObject as callOnObject,
  withMethod as callWithMethod,
  withArgMatching as callWithArgMatching,
  withStringArg as callWithStringArg,
} from '../predicates/call.js'
import {
  haveCallbackContaining as conditionHaveCallbackContaining,
  notHaveCallbackContaining as conditionNotHaveCallbackContaining,
  notExist as callNotExist,
  haveArgumentWithProperty as conditionHaveArgumentWithProperty,
  notHaveArgumentWithProperty as conditionNotHaveArgumentWithProperty,
} from '../conditions/call.js'

/**
 * Rule builder for call-expression-level architecture rules.
 *
 * Operates on CallExpression nodes across all source files,
 * wrapped in the ArchCall model for uniform predicate access.
 *
 * @example
 * ```typescript
 * // All Express route handlers must call handleError()
 * calls(project)
 *   .that().onObject('app')
 *   .and().withMethod(/^(get|post|put|delete|patch)$/)
 *   .should().haveCallbackContaining(call('handleError'))
 *   .because('unhandled errors crash the server')
 *   .check()
 *
 * // No route may call db.query() directly
 * calls(project)
 *   .that().onObject('app')
 *   .and().withMethod(/^(get|post|put|delete|patch)$/)
 *   .should().notHaveCallbackContaining(call('db.query'))
 *   .because('use repository methods instead')
 *   .check()
 *
 * // Select specific routes by path pattern
 * calls(project)
 *   .that().onObject('router')
 *   .and().withMethod('get')
 *   .and().withStringArg(0, '/api/users/**')
 *   .should().haveCallbackContaining(call('authenticate'))
 *   .check()
 * ```
 */
export class CallRuleBuilder extends RuleBuilder<ArchCall> {
  protected getElements(): ArchCall[] {
    return this.project.getSourceFiles().flatMap(collectCalls)
  }

  // --- Identity predicates (subset: no areExported/areNotExported) ---

  haveNameMatching(pattern: RegExp | string): this {
    return this.addPredicate(identityHaveNameMatching<ArchCall>(pattern))
  }

  haveNameStartingWith(prefix: string): this {
    return this.addPredicate(identityHaveNameStartingWith<ArchCall>(prefix))
  }

  haveNameEndingWith(suffix: string): this {
    return this.addPredicate(identityHaveNameEndingWith<ArchCall>(suffix))
  }

  resideInFile(glob: string): this {
    return this.addPredicate(identityResideInFile<ArchCall>(glob))
  }

  resideInFolder(glob: string): this {
    return this.addPredicate(identityResideInFolder<ArchCall>(glob))
  }

  // Note: areExported() and areNotExported() are intentionally omitted.
  // Call expressions cannot be exported. See spec section 5.1.

  // --- Call-specific predicates ---

  onObject(name: string): this {
    return this.addPredicate(callOnObject(name))
  }

  withMethod(nameOrRegex: string | RegExp): this {
    return this.addPredicate(callWithMethod(nameOrRegex))
  }

  withArgMatching(index: number, pattern: string | RegExp): this {
    return this.addPredicate(callWithArgMatching(index, pattern))
  }

  withStringArg(index: number, glob: string): this {
    return this.addPredicate(callWithStringArg(index, glob))
  }

  // --- Condition methods ---

  /**
   * Assert that the call's callback argument(s) contain a match.
   */
  haveCallbackContaining(matcher: ExpressionMatcher): this {
    return this.addCondition(conditionHaveCallbackContaining(matcher))
  }

  /**
   * Assert that the call's callback argument(s) do NOT contain a match.
   */
  notHaveCallbackContaining(matcher: ExpressionMatcher): this {
    return this.addCondition(conditionNotHaveCallbackContaining(matcher))
  }

  /**
   * The filtered call set must be empty.
   */
  notExist(): this {
    return this.addCondition(callNotExist())
  }

  /**
   * Assert that at least one object literal argument has ALL named properties.
   */
  haveArgumentWithProperty(...names: string[]): this {
    return this.addCondition(conditionHaveArgumentWithProperty(...names))
  }

  /**
   * Assert that NO object literal argument has ANY of the named properties.
   */
  notHaveArgumentWithProperty(...names: string[]): this {
    return this.addCondition(conditionNotHaveArgumentWithProperty(...names))
  }

  // --- Public accessors (used by plan 0015 within()) ---

  /**
   * Get the underlying ArchProject.
   * Used by within() to create scoped builders.
   */
  getProject(): ArchProject {
    return this.project
  }

  /**
   * Get the ArchCall elements that match the current predicate chain.
   * Used by within() to extract callbacks from matched calls.
   */
  getMatchedCalls(): ArchCall[] {
    return this.getElements().filter((archCall) => this._predicates.every((p) => p.test(archCall)))
  }
}

/**
 * Entry point for call-expression architecture rules.
 *
 * Scans all source files in the project for CallExpression nodes
 * and wraps them in ArchCall for predicate/condition evaluation.
 *
 * @example
 * ```typescript
 * import { project, calls, call } from '@nielspeter/ts-archunit'
 *
 * const p = project('tsconfig.json')
 *
 * calls(p)
 *   .that().onObject('app').and().withMethod('get')
 *   .should().haveCallbackContaining(call('authenticate'))
 *   .check()
 * ```
 */
export function calls(p: ArchProject): CallRuleBuilder {
  return new CallRuleBuilder(p)
}
