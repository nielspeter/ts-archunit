import type { Predicate } from './predicate.js'
import type { DeclaredGlobs } from './glob-site.js'
import type { Condition, ConditionContext } from './condition.js'
import type { ArchViolation } from './violation.js'

/**
 * Create a custom predicate for use in `.that().satisfy()` chains.
 *
 * The predicate filters elements — return `true` to keep, `false` to exclude.
 *
 * @example
 * ```ts
 * const isAbstract = definePredicate<ClassDeclaration>(
 *   'is abstract',
 *   (cls) => cls.isAbstract()
 * )
 *
 * classes(p).that().satisfy(isAbstract).should().beExported().check()
 * ```
 *
 * ## Declaring a glob
 *
 * If the predicate matches paths against a glob, pass it as `globs` — otherwise
 * `doctor` cannot see it, and a typo'd glob narrows the selection to nothing
 * while reporting a clean bill of health. This is a **selector**-position glob,
 * the one position that is acted on today, which is why the omission was bug
 * 0030's higher-severity half.
 *
 * @example
 * ```ts
 * const inGeneratedFolder = definePredicate<SourceFile>(
 *   "reside in '**\/generated/**'",
 *   (file) => picomatch('**\/generated/**')(file.getFilePath()),
 *   globNode({ glob: '**\/generated/**', kind: 'file-path' }),
 * )
 * ```
 *
 * The `kind` must say what the glob is really matched against, because it
 * selects which paths the glob is checked for satisfiability:
 *
 * - `file-path` — an **absolute** file path. Anchor the glob (`'**\/src/**'`,
 *   not `'src/**'`), or it matches nothing.
 * - `parent-dir` — the immediate parent directory of a file.
 * - `import-target` — a resolved module path **or a bare specifier**.
 *   Deliberately has no path universe, so `'fastify'` is never reported dead.
 * - `specifier` / `literal` — a string in the source rather than a path.
 *
 * A wrong `kind` is believed: declaring a bare specifier as `file-path` earns a
 * false dead-glob report, and declaring a real path as `import-target` silently
 * exempts it from checking. When unsure, the honest choice is to declare
 * nothing — the same position as before this parameter existed.
 */
export function definePredicate<T>(
  description: string,
  test: (element: T) => boolean,
  globs?: DeclaredGlobs,
): Predicate<T> {
  return { description, test, globs }
}

/**
 * Create a custom condition for use in `.should().satisfy()` chains.
 *
 * The callback receives the filtered element array and rule context.
 * Return an `ArchViolation[]` for elements that fail the condition.
 *
 * @example
 * ```ts
 * const useSharedHelper = defineCondition<ClassDeclaration>(
 *   'use shared count helper',
 *   (classes, context) => {
 *     return classes
 *       .filter(cls => !usesHelper(cls))
 *       .map(cls => createViolation(cls, 'should use shared count helper', context))
 *   }
 * )
 *
 * classes(p).that().extend('Base').should().satisfy(useSharedHelper).check()
 * ```
 *
 * ## Declaring a glob
 *
 * As with `definePredicate`, pass `globs` if the condition matches paths against
 * one — see that function for the `kind` values and what a wrong one costs. The
 * difference is what happens next: a **condition**-position glob is deliberately
 * *not* reported when it matches nothing, because a denylist glob matching
 * nothing is indistinguishable from a ban being respected. Declaring it makes it
 * visible to `globs()` and `explain`; it does not make it a finding.
 */
export function defineCondition<T>(
  description: string,
  evaluate: (elements: T[], context: ConditionContext) => ArchViolation[],
  globs?: DeclaredGlobs,
): Condition<T> {
  return { description, evaluate, globs }
}
