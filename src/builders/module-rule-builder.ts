import type { SourceFile } from 'ts-morph'
import { RuleBuilder } from '../core/rule-builder.js'
import type { ArchProject } from '../core/project.js'
import {
  resideInFile as resideInFilePredicate,
  resideInFolder as resideInFolderPredicate,
} from '../predicates/identity.js'
import {
  importFrom as importFromPredicate,
  notImportFrom as notImportFromPredicate,
  exportSymbolNamed as exportSymbolNamedPredicate,
  havePathMatching as havePathMatchingPredicate,
} from '../predicates/module.js'
import {
  onlyImportFrom as onlyImportFromCondition,
  notImportFrom as notImportFromCondition,
  onlyHaveTypeImportsFrom as onlyHaveTypeImportsFromCondition,
  notHaveAliasedImports as notHaveAliasedImportsCondition,
} from '../conditions/dependency.js'
import type { ImportOptions } from '../core/import-options.js'
import { notExist } from '../conditions/structural.js'

/**
 * Rule builder for module-level (SourceFile) architecture rules.
 *
 * Each .ts file in the project is treated as a module. Predicates filter
 * which modules to check, conditions assert constraints on their imports.
 *
 * @example
 * modules(project)
 *   .that().resideInFolder('** /domain/** ')
 *   .should().onlyImportFrom('** /domain/** ', '** /shared/** ')
 *   .because('domain must not depend on infrastructure')
 *   .check()
 */
export class ModuleRuleBuilder extends RuleBuilder<SourceFile> {
  protected getElements(): SourceFile[] {
    return this.project.getSourceFiles()
  }

  // --- Identity predicates (from predicates/identity.ts) ---

  /**
   * Filter modules whose file name matches the given regex.
   * The regex is tested against the base file name (e.g., "user-service.ts").
   */
  haveNameMatching(pattern: RegExp | string): this {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    return this.addPredicate({
      description: `have name matching ${String(regex)}`,
      test: (sf) => regex.test(sf.getBaseName()),
    })
  }

  /**
   * Filter modules that reside in a file matching the given glob.
   * Matched against the absolute file path.
   */
  resideInFile(glob: string): this {
    return this.addPredicate(resideInFilePredicate<SourceFile>(glob))
  }

  /**
   * Filter modules that reside in a folder matching the given glob.
   * Matched against the directory portion of the absolute file path.
   */
  resideInFolder(glob: string): this {
    return this.addPredicate(resideInFolderPredicate<SourceFile>(glob))
  }

  // --- Module-specific predicates (from predicates/module.ts) ---

  /**
   * Filter modules that import from a path matching any of the given globs.
   * Pass `{ ignoreTypeImports: true }` to exclude type-only imports.
   */
  importFrom(...globs: string[]): this {
    return this.addPredicate(importFromPredicate(...globs))
  }

  /**
   * Filter modules that import from a path matching any of the given globs,
   * with options to control type-import handling.
   */
  importFromWithOptions(globs: string[], options: ImportOptions): this {
    return this.addPredicate(importFromPredicate(globs, options))
  }

  /**
   * Filter modules that do NOT import from any path matching the given globs.
   */
  notImportFrom(...globs: string[]): this {
    return this.addPredicate(notImportFromPredicate(...globs))
  }

  /**
   * Filter modules that do NOT import from any path matching the given globs,
   * with options to control type-import handling.
   */
  notImportFromWithOptions(globs: string[], options: ImportOptions): this {
    return this.addPredicate(notImportFromPredicate(globs, options))
  }

  /**
   * Filter modules that export a symbol with the given name.
   */
  exportSymbolNamed(name: string): this {
    return this.addPredicate(exportSymbolNamedPredicate(name))
  }

  /**
   * Filter modules whose file path matches the given glob.
   */
  havePathMatching(glob: string): this {
    return this.addPredicate(havePathMatchingPredicate(glob))
  }

  // --- Dependency conditions (from conditions/dependency.ts) ---

  /**
   * Every import must resolve to a path matching at least one of the globs.
   * Pass `{ ignoreTypeImports: true }` to exclude type-only imports.
   */
  onlyImportFrom(...globs: string[]): this {
    return this.addCondition(onlyImportFromCondition(...globs))
  }

  /**
   * Every import must resolve to a path matching at least one of the globs,
   * with options to control type-import handling.
   */
  onlyImportFromWithOptions(globs: string[], options: ImportOptions): this {
    return this.addCondition(onlyImportFromCondition(globs, options))
  }

  /**
   * No import may resolve to a path matching any of the globs.
   * Note: This is the condition variant (used after .should()).
   * The predicate variant (used after .that()) is notImportFrom().
   */
  notImportFromCondition(...globs: string[]): this {
    return this.addCondition(notImportFromCondition(...globs))
  }

  /**
   * No import may resolve to a path matching any of the globs,
   * with options to control type-import handling.
   *
   * Relationship with `onlyHaveTypeImportsFrom`:
   * `onlyHaveTypeImportsFrom` enforces that imports MUST use `import type`.
   * `notImportFromConditionWithOptions` with `ignoreTypeImports` allows type imports but forbids runtime imports.
   */
  notImportFromConditionWithOptions(globs: string[], options: ImportOptions): this {
    return this.addCondition(notImportFromCondition(globs, options))
  }

  /**
   * No import may use an aliased specifier (`import { x as y }`).
   */
  notHaveAliasedImports(): this {
    return this.addCondition(notHaveAliasedImportsCondition())
  }

  /**
   * Imports from matching paths must use `import type`.
   */
  onlyHaveTypeImportsFrom(...globs: string[]): this {
    return this.addCondition(onlyHaveTypeImportsFromCondition(...globs))
  }

  /**
   * The filtered module set must be empty.
   */
  notExist(): this {
    return this.addCondition(notExist<SourceFile>())
  }
}

/**
 * Entry point: create a module-level rule builder.
 *
 * @param p - The loaded ArchProject
 * @returns A ModuleRuleBuilder operating on all source files in the project
 *
 * @example
 * modules(project)
 *   .that().resideInFolder('** /services/** ')
 *   .should().onlyImportFrom('** /services/** ', '** /shared/** ')
 *   .check()
 */
export function modules(p: ArchProject): ModuleRuleBuilder {
  return new ModuleRuleBuilder(p)
}
