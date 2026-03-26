import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'

/**
 * Resolve the import paths for a source file.
 * Returns absolute paths for resolvable imports, raw specifiers for external packages.
 */
function getImportPaths(sourceFile: SourceFile): string[] {
  return sourceFile.getImportDeclarations().map((decl) => {
    const resolved = decl.getModuleSpecifierSourceFile()
    return resolved ? resolved.getFilePath() : decl.getModuleSpecifierValue()
  })
}

/**
 * Matches modules that import from a path matching the given glob.
 *
 * The glob is matched against resolved absolute import paths.
 * For external (non-resolvable) imports, it matches against the raw specifier.
 *
 * @example
 * modules(p).that().importFrom('** /infrastructure/**')
 */
export function importFrom(glob: string): Predicate<SourceFile> {
  const isMatch = picomatch(glob)
  return {
    description: `import from "${glob}"`,
    test: (sourceFile) => getImportPaths(sourceFile).some((p) => isMatch(p)),
  }
}

/**
 * Matches modules that do NOT import from a path matching the given glob.
 *
 * @example
 * modules(p).that().notImportFrom('** /legacy/**')
 */
export function notImportFrom(glob: string): Predicate<SourceFile> {
  const isMatch = picomatch(glob)
  return {
    description: `not import from "${glob}"`,
    test: (sourceFile) => !getImportPaths(sourceFile).some((p) => isMatch(p)),
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
