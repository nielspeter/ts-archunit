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
import {
  notExist,
  resideInFile as resideInFileCondition,
  resideInFolder as resideInFolderCondition,
} from '../conditions/structural.js'
import type { ExpressionMatcher } from '../helpers/matchers.js'
import type { ModuleBodyOptions } from '../helpers/body-traversal.js'
import {
  moduleContain,
  moduleNotContain,
  moduleUseInsteadOf,
} from '../conditions/body-analysis-module.js'
import {
  notHaveDefaultExport as notHaveDefaultExportCondition,
  haveDefaultExport as haveDefaultExportCondition,
  haveMaxExports as haveMaxExportsCondition,
} from '../conditions/exports.js'
import {
  onlyBeImportedVia as onlyBeImportedViaCondition,
  beImported as beImportedCondition,
  haveNoUnusedExports as haveNoUnusedExportsCondition,
} from '../conditions/reverse-dependency.js'

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
   * After `.that()`: filter modules that reside in a file matching the given glob.
   * After `.should()`: assert modules reside in a file matching the given glob.
   * Matched against the absolute file path.
   */
  resideInFile(glob: string): this {
    if (this._phase === 'condition') {
      return this.addCondition(resideInFileCondition<SourceFile>(glob))
    }
    return this.addPredicate(resideInFilePredicate<SourceFile>(glob))
  }

  /**
   * After `.that()`: filter modules that reside in a folder matching the given glob.
   * After `.should()`: assert modules reside in a folder matching the given glob.
   * Matched against the directory portion of the absolute file path.
   */
  resideInFolder(glob: string): this {
    if (this._phase === 'condition') {
      return this.addCondition(resideInFolderCondition<SourceFile>(glob))
    }
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
   * After `.that()`: filter modules that do NOT import from matching globs.
   * After `.should()`: assert that no import resolves to a matching glob.
   */
  notImportFrom(...globs: string[]): this {
    if (this._phase === 'condition') {
      return this.addCondition(notImportFromCondition(...globs))
    }
    return this.addPredicate(notImportFromPredicate(...globs))
  }

  /**
   * After `.that()`: filter modules that do NOT import from matching globs.
   * After `.should()`: assert that no import resolves to a matching glob.
   * With options to control type-import handling.
   */
  notImportFromWithOptions(globs: string[], options: ImportOptions): this {
    if (this._phase === 'condition') {
      return this.addCondition(notImportFromCondition(globs, options))
    }
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
   * @deprecated Use `notImportFrom()` after `.should()` instead — it now dispatches
   * as a condition automatically in the condition phase.
   */
  notImportFromCondition(...globs: string[]): this {
    return this.addCondition(notImportFromCondition(...globs))
  }

  /**
   * @deprecated Use `notImportFromWithOptions()` after `.should()` instead — it now
   * dispatches as a condition automatically in the condition phase.
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

  // --- Body analysis conditions (plan 0041 phase 2) ---

  /**
   * Assert that the module contains at least one match for the matcher.
   * Default: searches the entire file including class/function bodies.
   * With `{ scopeToModule: true }`: only searches top-level module-scope code.
   */
  contain(matcher: ExpressionMatcher, options?: ModuleBodyOptions): this {
    return this.addCondition(moduleContain(matcher, options))
  }

  /**
   * Assert that the module does NOT contain any match for the matcher.
   * Default: searches the entire file including class/function bodies.
   * With `{ scopeToModule: true }`: only searches top-level module-scope code.
   */
  notContain(matcher: ExpressionMatcher, options?: ModuleBodyOptions): this {
    return this.addCondition(moduleNotContain(matcher, options))
  }

  /**
   * Assert: module must NOT contain 'bad' AND must contain 'good'.
   */
  useInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher, options?: ModuleBodyOptions): this {
    return this.addCondition(moduleUseInsteadOf(bad, good, options))
  }

  // --- Export conditions (plan 0041 phase 3) ---

  /**
   * Assert that matched modules do NOT have a default export.
   */
  notHaveDefaultExport(): this {
    return this.addCondition(notHaveDefaultExportCondition())
  }

  /**
   * Assert that matched modules have a default export.
   */
  haveDefaultExport(): this {
    return this.addCondition(haveDefaultExportCondition())
  }

  /**
   * Assert that matched modules have at most `max` named exports.
   * Default exports are not counted.
   */
  haveMaxExports(max: number): this {
    return this.addCondition(haveMaxExportsCondition(max))
  }

  // --- Reverse dependency conditions (plan 0041 phase 4) ---

  /**
   * Assert that every file importing this module matches at least one glob.
   * Enforces barrel/facade patterns. Modules with zero importers pass vacuously.
   */
  onlyBeImportedVia(...globs: string[]): this {
    return this.addCondition(onlyBeImportedViaCondition(...globs))
  }

  /**
   * Assert that at least one other module in the project imports this module.
   * Detects dead/orphaned files. Use `.excluding()` to skip entry points.
   */
  beImported(): this {
    return this.addCondition(beImportedCondition())
  }

  /**
   * Assert that every named export is referenced by at least one other file.
   * Detects unused exports. More expensive than file-level checks — scope
   * with `.that().resideInFolder()` to limit the search space.
   */
  haveNoUnusedExports(): this {
    return this.addCondition(haveNoUnusedExportsCondition())
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
