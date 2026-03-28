import type { ImportDeclaration } from 'ts-morph'

/**
 * Options for import-related conditions and predicates.
 */
export interface ImportOptions {
  /**
   * When true, type-only imports (`import type { X }` and imports where
   * ALL specifiers are type-only) are excluded from violation checks.
   *
   * Type-only imports are erased at compile time and create no runtime dependency.
   * Useful for layer isolation rules where type-sharing is acceptable.
   *
   * Default: false (all imports checked, for backward compatibility).
   */
  ignoreTypeImports?: boolean
}

/**
 * Check whether an import declaration is purely type-only (no runtime dependency).
 *
 * Returns true for:
 * - `import type { X } from '...'` (declaration-level type-only)
 * - `import type Foo from '...'` (default type-only import)
 * - `import { type X, type Y } from '...'` (all specifiers are type-only, no default/namespace)
 *
 * Returns false for:
 * - `import { X } from '...'` (runtime import)
 * - `import { type X, Y } from '...'` (mixed: Y is runtime)
 * - `import defaultExport, { type X } from '...'` (default import is runtime)
 * - `import * as Foo from '...'` (namespace import is runtime)
 */
export function isTypeOnlyImport(decl: ImportDeclaration): boolean {
  // Declaration-level: import type { X } or import type Foo
  if (decl.isTypeOnly()) return true
  // Default import creates a runtime binding
  if (decl.getDefaultImport()) return false
  // Namespace import creates a runtime binding
  if (decl.getNamespaceImport()) return false
  // All named specifiers must be individually type-only
  const specifiers = decl.getNamedImports()
  return specifiers.length > 0 && specifiers.every((s) => s.isTypeOnly())
}
