import picomatch from 'picomatch'
import type { SourceFile, ImportDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import { isTypeOnlyImport } from '../core/import-options.js'

export type { ImportOptions } from '../core/import-options.js'
import type { ImportOptions } from '../core/import-options.js'

/**
 * Resolve an import declaration to an absolute path or raw specifier.
 */
function resolveImportPath(decl: ImportDeclaration): string {
  const resolved = decl.getModuleSpecifierSourceFile()
  return resolved ? resolved.getFilePath() : decl.getModuleSpecifierValue()
}

/**
 * Create a violation for a source file with a specific offending import.
 */
function importViolation(
  sourceFile: SourceFile,
  importDecl: ImportDeclaration,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: sourceFile.getBaseName(),
    file: sourceFile.getFilePath(),
    line: importDecl.getStartLineNumber(),
    message,
    because: context.because,
  }
}

/**
 * Every import in the module must resolve to a path matching at least one of the globs.
 * Imports that don't match any glob produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /domain/** ')
 *   .should().onlyImportFrom('** /domain/** ', '** /shared/** ')
 *   .check()
 */
export function onlyImportFrom(globs: string[], options: ImportOptions): Condition<SourceFile>
export function onlyImportFrom(...globs: string[]): Condition<SourceFile>
export function onlyImportFrom(
  ...args: [string[], ImportOptions] | string[]
): Condition<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `only import from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          if (ignoreType && isTypeOnlyImport(decl)) continue
          const importPath = resolveImportPath(decl)
          if (!matchers.some((m) => m(importPath))) {
            violations.push(
              importViolation(
                sf,
                decl,
                `${sf.getBaseName()} imports "${importPath}" which does not match any of [${globs.join(', ')}]`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * No import in the module may resolve to a path matching any of the globs.
 * Imports that match a glob produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /features/** ')
 *   .should().notImportFrom('** /legacy/** ')
 *   .check()
 */
export function notImportFrom(globs: string[], options: ImportOptions): Condition<SourceFile>
export function notImportFrom(...globs: string[]): Condition<SourceFile>
export function notImportFrom(
  ...args: [string[], ImportOptions] | string[]
): Condition<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `not import from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          if (ignoreType && isTypeOnlyImport(decl)) continue
          const importPath = resolveImportPath(decl)
          if (matchers.some((m) => m(importPath))) {
            violations.push(
              importViolation(
                sf,
                decl,
                `${sf.getBaseName()} imports "${importPath}" which matches forbidden [${globs.join(', ')}]`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * Module must import from at least one path matching a glob.
 * Completes the import-condition family: onlyImportFrom (all),
 * notImportFrom (none), dependOn (at least one).
 *
 * Only considers static `import` declarations. Dynamic `import()`
 * expressions are not checked — use `beImported()` for import-graph
 * analysis that includes dynamic imports.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /services/** ')
 *   .should().satisfy(dependOn('** /logging/** '))
 *   .check()
 */
export function dependOn(globs: string[], options: ImportOptions): Condition<SourceFile>
export function dependOn(...globs: string[]): Condition<SourceFile>
export function dependOn(...args: [string[], ImportOptions] | string[]): Condition<SourceFile> {
  // ADR-005: as casts required — TS cannot narrow tuple union rest params after Array.isArray
  const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
  const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
  const ignoreType = options?.ignoreTypeImports === true
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description:
      globs.length === 1 ? `depend on ${quotedGlobs}` : `depend on at least one of ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        const hasMatch = sf.getImportDeclarations().some((decl) => {
          if (ignoreType && isTypeOnlyImport(decl)) return false
          const importPath = resolveImportPath(decl)
          return matchers.some((m) => m(importPath))
        })
        if (!hasMatch) {
          violations.push({
            rule: context.rule,
            element: sf.getBaseName(),
            file: sf.getFilePath(),
            line: 1,
            message: `${sf.getBaseName()} does not import from any path matching [${globs.join(', ')}]`,
            because: context.because,
          })
        }
      }
      return violations
    },
  }
}

/**
 * No import in the module may use an aliased named specifier (`import { x as y }`).
 * Each aliased specifier produces a violation.
 * Does not flag namespace imports (`import * as Foo`) — only named specifier aliases.
 *
 * To scope the check to specific import sources, filter with
 * `.that().importFrom(...)` predicates.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /src/** ')
 *   .should().notHaveAliasedImports()
 *   .because('aliases hide API design problems')
 *   .check()
 */
export function notHaveAliasedImports(): Condition<SourceFile> {
  return {
    description: 'not have aliased imports',
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          for (const specifier of decl.getNamedImports()) {
            const alias = specifier.getAliasNode()
            if (alias) {
              violations.push(
                importViolation(
                  sf,
                  decl,
                  `${sf.getBaseName()} aliases "${specifier.getName()}" as "${alias.getText()}"`,
                  context,
                ),
              )
            }
          }
        }
      }
      return violations
    },
  }
}

/**
 * Imports from paths matching the given globs must use `import type`, not `import`.
 * Non-matching imports are ignored. Matching imports that are not type-only produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /api/** ')
 *   .should().onlyHaveTypeImportsFrom('** /domain/entities/** ')
 *   .check()
 */
export function onlyHaveTypeImportsFrom(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  const quotedGlobs = globs.map((g) => `"${g}"`).join(', ')
  return {
    description: `only have type imports from ${quotedGlobs}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          const importPath = resolveImportPath(decl)
          if (matchers.some((m) => m(importPath)) && !isTypeOnlyImport(decl)) {
            violations.push(
              importViolation(
                sf,
                decl,
                `${sf.getBaseName()} has a value import from "${importPath}" which should be a type-only import`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}
