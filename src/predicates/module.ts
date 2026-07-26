import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import type { ImportOptions } from '../core/import-options.js'
import { isTypeOnlyImport } from '../core/import-options.js'
import { importCandidates } from '../core/import-candidates.js'

/**
 * Every string a glob may be matched against, across every import in the file.
 *
 * Flattened rather than grouped per import: these predicates only ask "does
 * ANY import match", so which import a candidate came from is not needed. See
 * `importCandidates` for why one import can contribute two strings.
 */
function importCandidatePaths(sourceFile: SourceFile, ignoreTypeImports = false): string[] {
  return sourceFile
    .getImportDeclarations()
    .filter((decl) => {
      if (!ignoreTypeImports) return true
      return !isTypeOnlyImport(decl)
    })
    .flatMap((decl) => [...importCandidates(decl)])
}

/**
 * Matches modules that import from a path matching any of the given globs.
 *
 * Each import contributes the resolved absolute path **and**, when the
 * specifier is non-relative, the specifier as written; a glob matches the
 * import if it matches either. So a bare package name works whether or not the
 * package is installed. See `importCandidates` for why.
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
    description: 'import from ' + globs.map((g) => `"${g}"`).join(', '),
    test: (sourceFile) =>
      importCandidatePaths(sourceFile, ignoreType).some((p) => matchers.some((m) => m(p))),
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
    description: 'not import from ' + globs.map((g) => `"${g}"`).join(', '),
    test: (sourceFile) =>
      !importCandidatePaths(sourceFile, ignoreType).some((p) => matchers.some((m) => m(p))),
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
