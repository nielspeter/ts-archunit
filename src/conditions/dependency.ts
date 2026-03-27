import picomatch from 'picomatch'
import type { SourceFile, ImportDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'

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
export function onlyImportFrom(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  return {
    description: `only import from ${globs.map((g) => `"${g}"`).join(', ')}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
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
export function notImportFrom(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  return {
    description: `not import from ${globs.map((g) => `"${g}"`).join(', ')}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
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
  return {
    description: `only have type imports from ${globs.map((g) => `"${g}"`).join(', ')}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          const importPath = resolveImportPath(decl)
          if (matchers.some((m) => m(importPath)) && !decl.isTypeOnly()) {
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
