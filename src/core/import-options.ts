import type { ExportDeclaration, ImportDeclaration } from 'ts-morph'

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
   * Default: **per condition.** `false` — count every import — for `dependOn`,
   * `importFrom`, `notImportFrom`, `onlyImportFrom`, `notDependOn` and
   * `respectLayerOrder`, which ask whether the code is *coupled*. `true` for
   * `beFreeOfCycles`, which asks whether the module is *evaluated*: an erased import
   * cannot contribute to an initialization cycle. See `docs/slices.md`.
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

/**
 * Check whether a re-export is purely type-only (no runtime dependency).
 *
 * The `export … from` analogue of {@link isTypeOnlyImport}, and **both halves of
 * the disjunction are needed** — measured, the two spellings put the flag in
 * different places:
 *
 * | form                            | `decl.isTypeOnly()` | specifiers |
 * | ------------------------------- | ------------------- | ---------- |
 * | `export type { X } from 's'`    | **true**            | false      |
 * | `export { type X } from 's'`    | false               | **true**   |
 * | `export type * from 's'`        | **true**            | (none)     |
 * | `export { X } from 's'`         | false               | false      |
 *
 * No default or namespace analogue exists, verified: there is no way to write a
 * re-export that binds a runtime value while every named specifier is
 * type-only, so this needs none of {@link isTypeOnlyImport}'s guards. A bare
 * `export * from 's'` has no named specifiers and is runtime, which is why the
 * second half requires a non-empty list.
 */
export function isTypeOnlyReExport(decl: ExportDeclaration): boolean {
  if (decl.isTypeOnly()) return true
  const specifiers = decl.getNamedExports()
  return specifiers.length > 0 && specifiers.every((s) => s.isTypeOnly())
}

/**
 * Split a variadic glob API's arguments, without a type assertion.
 *
 * Five entry points take `...args: [string[], ImportOptions] | string[]` —
 * `onlyImportFrom`, `notImportFrom`, `dependOn`, `importFrom`, `importFromAny` —
 * so a caller can write either `f('a', 'b')` or `f(['a', 'b'], { … })`. TypeScript
 * cannot narrow a tuple-union rest parameter from `Array.isArray(args[0])`, which
 * is true and was the stated reason for **ten** `as` casts across three files:
 *
 * ```ts
 * const globs: string[] = Array.isArray(args[0]) ? args[0] : (args as string[])
 * const options = Array.isArray(args[0]) && args.length > 1 ? (args[1] as ImportOptions) : undefined
 * ```
 *
 * [ADR-005](../../adr/005-no-any-no-type-assertions.md) prescribes a type guard,
 * and a guard does narrow it: `.filter((a): a is string => …)` produces `string[]`
 * with no assertion, and `typeof second === 'object'` narrows the options. The
 * casts were avoidable; only the direct narrowing was not.
 *
 * One owner rather than five copies, which is the other half. The dispatch was
 * duplicated five times, and a duplicated predicate in this repo has already
 * caused a measurement error once —
 * [bug 0044](../../bugs/fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md).
 */
export function splitGlobArgs(args: readonly (string[] | ImportOptions | string)[]): {
  globs: string[]
  options: ImportOptions | undefined
} {
  const [first, second] = args
  if (Array.isArray(first)) {
    return {
      globs: first,
      options:
        typeof second === 'object' && second !== null && !Array.isArray(second)
          ? second
          : undefined,
    }
  }
  // The variadic form: every argument is a glob string. The predicate is what
  // makes this cast-free — `filter` alone would leave the union in place.
  return { globs: args.filter((a): a is string => typeof a === 'string'), options: undefined }
}
