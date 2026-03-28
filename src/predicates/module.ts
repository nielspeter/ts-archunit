import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import type { ImportOptions } from '../core/import-options.js'
import { isTypeOnlyImport } from '../core/import-options.js'

/**
 * Resolve the import paths for a source file, optionally filtering out type-only imports.
 * Returns absolute paths for resolvable imports, raw specifiers for external packages.
 */
function getImportPaths(sourceFile: SourceFile, ignoreTypeImports = false): string[] {
  return sourceFile
    .getImportDeclarations()
    .filter((decl) => {
      if (!ignoreTypeImports) return true
      return !isTypeOnlyImport(decl)
    })
    .map((decl) => {
      const resolved = decl.getModuleSpecifierSourceFile()
      return resolved ? resolved.getFilePath() : decl.getModuleSpecifierValue()
    })
}

/**
 * Matches modules that import from a path matching any of the given globs.
 *
 * The globs are matched against resolved absolute import paths.
 * For external (non-resolvable) imports, they match against the raw specifier.
 *
 * @example
 * modules(p).that().importFrom('** /infrastructure/**')
 * modules(p).that().importFrom('fastify', 'knex', 'bullmq')
 */
export function importFrom(globs: string[], options: ImportOptions): Predicate<SourceFile>
export function importFrom(...globs: string[]): Predicate<SourceFile>
export function importFrom(...args: [string[], ImportOptions] | string[]): Predicate<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  return {
    description: `import from ${globs.map((g) => `"${g}"`).join(', ')}`,
    test: (sourceFile) =>
      getImportPaths(sourceFile, ignoreType).some((p) => matchers.some((m) => m(p))),
  }
}

/**
 * Matches modules that do NOT import from any path matching the given globs.
 *
 * @example
 * modules(p).that().notImportFrom('** /legacy/**')
 * modules(p).that().notImportFrom('fastify', 'knex', 'bullmq')
 */
export function notImportFrom(globs: string[], options: ImportOptions): Predicate<SourceFile>
export function notImportFrom(...globs: string[]): Predicate<SourceFile>
export function notImportFrom(
  ...args: [string[], ImportOptions] | string[]
): Predicate<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  return {
    description: `not import from ${globs.map((g) => `"${g}"`).join(', ')}`,
    test: (sourceFile) =>
      !getImportPaths(sourceFile, ignoreType).some((p) => matchers.some((m) => m(p))),
  }
}

/**
 * Matches modules that export a symbol with the given name.
 *
 * Checks the module's exported declarations for a matching name.
 *
 * @example
 * modules(p).that().exportSymbolNamed('default')
 */
export function exportSymbolNamed(name: string): Predicate<SourceFile> {
  return {
    description: `export symbol named "${name}"`,
    test: (sourceFile) => sourceFile.getExportedDeclarations().has(name),
  }
}

/**
 * Matches modules whose file path matches the given glob.
 *
 * Similar to resideInFile but semantically clearer for modules —
 * "modules that have path matching" vs "elements that reside in file".
 *
 * @example
 * modules(p).that().havePathMatching('** /services/*.ts')
 */
export function havePathMatching(glob: string): Predicate<SourceFile> {
  const isMatch = picomatch(glob)
  return {
    description: `have path matching "${glob}"`,
    test: (sourceFile) => isMatch(sourceFile.getFilePath()),
  }
}
