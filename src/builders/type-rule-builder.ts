import type { ArchProject } from '../core/project.js'
import { RuleBuilder } from '../core/rule-builder.js'
import type { TypeMatcher } from '../helpers/type-matchers.js'
import {
  areInterfaces,
  areTypeAliases,
  haveProperty,
  havePropertyOfType,
  extendType,
  type TypeDeclaration,
} from '../predicates/type.js'
import { havePropertyType } from '../conditions/type-level.js'
import {
  havePropertyNamed as memberHavePropertyNamed,
  notHavePropertyNamed as memberNotHavePropertyNamed,
  havePropertyMatching as memberHavePropertyMatching,
  notHavePropertyMatching as memberNotHavePropertyMatching,
  haveOnlyReadonlyProperties as memberHaveOnlyReadonlyProperties,
  maxProperties as memberMaxProperties,
} from '../conditions/members.js'
import {
  beExported as conditionBeExported,
  notExist as conditionNotExist,
  haveNameMatching as conditionHaveNameMatching,
  resideInFile as conditionResideInFile,
  resideInFolder as conditionResideInFolder,
} from '../conditions/structural.js'
import {
  haveNameMatching as identityHaveNameMatching,
  resideInFile as identityResideInFile,
  resideInFolder as identityResideInFolder,
  areExported as identityAreExported,
  areNotExported as identityAreNotExported,
} from '../predicates/identity.js'

/**
 * Rule builder for interface and type alias declarations.
 *
 * Returned by the `types()` entry point. Provides type-specific
 * predicates and conditions on top of the base RuleBuilder chain.
 *
 * @example
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', not(isString()))
 *   .because('sortBy must be a union of literals, not bare string')
 *   .check()
 */
export class TypeRuleBuilder extends RuleBuilder<TypeDeclaration> {
  constructor(project: ArchProject) {
    super(project)
  }

  /**
   * Collect all InterfaceDeclarations and TypeAliasDeclarations
   * from all source files in the project.
   */
  protected getElements(): TypeDeclaration[] {
    const elements: TypeDeclaration[] = []
    for (const sf of this.project.getSourceFiles()) {
      elements.push(...sf.getInterfaces())
      elements.push(...sf.getTypeAliases())
    }
    return elements
  }

  // --- Type-specific predicates ---

  areInterfaces(): this {
    return this.addPredicate(areInterfaces())
  }

  areTypeAliases(): this {
    return this.addPredicate(areTypeAliases())
  }

  haveProperty(name: string): this {
    return this.addPredicate(haveProperty(name))
  }

  havePropertyOfType(name: string, matcher: TypeMatcher): this {
    return this.addPredicate(havePropertyOfType(name, matcher))
  }

  extendType(name: string): this {
    return this.addPredicate(extendType(name))
  }

  // --- Type-specific conditions ---

  havePropertyType(name: string, matcher: TypeMatcher): this {
    return this.addCondition(havePropertyType(name, matcher))
  }

  beExported(): this {
    return this.addCondition(conditionBeExported())
  }

  notExist(): this {
    return this.addCondition(conditionNotExist())
  }

  /** @deprecated Use `haveNameMatching()` after `.should()` instead. */
  conditionHaveNameMatching(pattern: RegExp): this {
    return this.addCondition(conditionHaveNameMatching(pattern))
  }

  // --- Member property conditions (plan 0030) ---

  havePropertyNamed(...names: string[]): this {
    return this.addCondition(memberHavePropertyNamed(...names))
  }

  notHavePropertyNamed(...names: string[]): this {
    return this.addCondition(memberNotHavePropertyNamed(...names))
  }

  havePropertyMatching(pattern: RegExp): this {
    return this.addCondition(memberHavePropertyMatching(pattern))
  }

  notHavePropertyMatching(pattern: RegExp): this {
    return this.addCondition(memberNotHavePropertyMatching(pattern))
  }

  haveOnlyReadonlyProperties(): this {
    return this.addCondition(memberHaveOnlyReadonlyProperties())
  }

  maxProperties(max: number): this {
    return this.addCondition(memberMaxProperties(max))
  }

  // --- Identity predicates (convenience wrappers) ---

  /**
   * After `.that()`: filter types whose name matches the pattern.
   * After `.should()`: assert matched types have names matching the pattern.
   */
  haveNameMatching(pattern: RegExp | string): this {
    if (this._phase === 'condition') {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
      return this.addCondition(conditionHaveNameMatching(regex))
    }
    return this.addPredicate(identityHaveNameMatching(pattern))
  }

  areExported(): this {
    return this.addPredicate(identityAreExported())
  }

  areNotExported(): this {
    return this.addPredicate(identityAreNotExported())
  }

  /**
   * After `.that()`: filter types in a file matching the glob.
   * After `.should()`: assert types reside in a file matching the glob.
   */
  resideInFile(glob: string): this {
    if (this._phase === 'condition') {
      return this.addCondition(conditionResideInFile(glob))
    }
    return this.addPredicate(identityResideInFile(glob))
  }

  /**
   * After `.that()`: filter types in a folder matching the glob.
   * After `.should()`: assert types reside in a folder matching the glob.
   */
  resideInFolder(glob: string): this {
    if (this._phase === 'condition') {
      return this.addCondition(conditionResideInFolder(glob))
    }
    return this.addPredicate(identityResideInFolder(glob))
  }
}

/**
 * Entry point for rules on interface and type alias declarations.
 *
 * Returns a TypeRuleBuilder that can filter and assert on all
 * InterfaceDeclaration and TypeAliasDeclaration nodes in the project.
 *
 * @example
 * // All types with a sortBy property must not use bare string
 * types(project)
 *   .that().haveProperty('sortBy')
 *   .should().havePropertyType('sortBy', not(isString()))
 *   .check()
 */
export function types(p: ArchProject): TypeRuleBuilder {
  return new TypeRuleBuilder(p)
}
