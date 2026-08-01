import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'
import { globNode } from '../core/glob-site.js'
import { isProjectRelative, relativeToRoot } from '../core/project-relative.js'

/** Types that have a name — ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, etc. */
export interface Named {
  getName(): string | undefined
}

/** Types that have a source file — any ts-morph Node. */
export interface Located {
  getSourceFile(): SourceFile
}

/** Types that can be exported — ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, etc. */
export interface Exportable {
  isExported(): boolean
}

// --- Name predicates ---

/**
 * Matches elements whose name matches the given pattern.
 * - RegExp: tested against the name directly
 * - string: converted to RegExp (e.g. 'Service$' becomes /Service$/)
 */
export function haveNameMatching<T extends Named>(pattern: RegExp | string): Predicate<T> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return {
    description: `have name matching ${String(regex)}`,
    test: (element) => {
      const name = element.getName()
      return name !== undefined && regex.test(name)
    },
  }
}

/**
 * Matches elements whose name starts with the given prefix.
 */
export function haveNameStartingWith<T extends Named>(prefix: string): Predicate<T> {
  return {
    description: `have name starting with "${prefix}"`,
    test: (element) => {
      const name = element.getName()
      return name?.startsWith(prefix) ?? false
    },
  }
}

/**
 * Matches elements whose name ends with the given suffix.
 */
export function haveNameEndingWith<T extends Named>(suffix: string): Predicate<T> {
  return {
    description: `have name ending with "${suffix}"`,
    test: (element) => {
      const name = element.getName()
      return name?.endsWith(suffix) ?? false
    },
  }
}

// --- File & Folder predicates ---

/**
 * Matches elements that reside in a file matching the given glob.
 * The glob is matched against the absolute file path using picomatch.
 *
 * @example
 * resideInFile('** /routes.ts')   // matches /abs/path/src/routes.ts
 * resideInFile('** /src/*.ts')    // matches any .ts file directly in src/
 */
export function resideInFile<T extends Located>(glob: string): Predicate<T> {
  const isMatch = picomatch(glob)
  const relative = isProjectRelative(glob)
  return {
    // `base: 'normalized'` when the glob is project-relative — the anchor check
    // in `syntacticFault` calls an unanchored glob dead against absolute paths,
    // and it stops being dead exactly when it starts working (plan 0067 C).
    globs: globNode({ glob, kind: 'file-path', base: relative ? 'normalized' : 'absolute' }),
    description: `reside in file matching "${glob}"`,
    test: (element) => {
      const sourceFile = element.getSourceFile()
      const filePath = sourceFile.getFilePath()
      if (isMatch(filePath)) return true
      if (!relative) return false
      const fromRoot = relativeToRoot(sourceFile, filePath)
      return fromRoot !== undefined && isMatch(fromRoot)
    },
  }
}

/**
 * Matches elements that reside in a folder matching the given glob.
 * The glob is matched against the directory portion of the absolute file path.
 *
 * @example
 * resideInFolder('** /routes/**')   // matches files anywhere under a routes/ folder
 * resideInFolder('** /src/services/**')
 */
export function resideInFolder<T extends Located>(glob: string): Predicate<T> {
  const isMatch = picomatch(glob)
  const relative = isProjectRelative(glob)
  return {
    // `parent-dir`, not `file-path`: the test below reads the directory
    // portion, so this glob is matched against the immediate parent and
    // nothing else. It is the only selector in src/ that does.
    globs: globNode({
      glob,
      kind: 'parent-dir',
      base: relative ? 'normalized' : 'absolute',
    }),
    description: `reside in folder matching "${glob}"`,
    test: (element) => {
      const sourceFile = element.getSourceFile()
      const filePath = sourceFile.getFilePath()
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))
      if (isMatch(dirPath)) return true
      // Project-relative: the same directory, named from the project root
      // (plan 0067 C). `'src/domain/**'` means that folder AT THE ROOT, which
      // is narrower and more accurate than the `'**/src/domain/**'` the old
      // advice prescribed.
      if (!relative) return false
      const fromRoot = relativeToRoot(sourceFile, dirPath)
      return fromRoot !== undefined && isMatch(fromRoot)
    },
  }
}

/**
 * Matches modules whose file path matches the given glob.
 *
 * Similar to resideInFile but semantically clearer for modules —
 * "modules that have path matching" vs "elements that reside in file".
 *
 * Lives here, beside `resideInFile`/`resideInFolder`, rather than in
 * `predicates/module.ts`: it is an **identity** predicate, and identity
 * predicates are legitimately single-glob — you match one location pattern,
 * not a blacklist. The `api/no-single-glob-predicates` dogfood rule bans
 * single-glob predicates in `module.ts` precisely because a module predicate
 * like `importFrom`/`notImportFrom` must be variadic, and it carved out
 * identity predicates by name in a comment. Moving the function makes that
 * carve-out the rule's own scope instead of a comment beside it — exclusion by
 * construction (ADR-008 rule 3). No public API change: `src/index.ts`
 * re-exports it under the same name, and there is no `./predicates` subpath.
 *
 * @example
 * modules(p).that().havePathMatching('** /services/*.ts')
 */
export function havePathMatching(glob: string): Predicate<SourceFile> {
  const isMatch = picomatch(glob)
  const relative = isProjectRelative(glob)
  return {
    globs: globNode({ glob, kind: 'file-path', base: relative ? 'normalized' : 'absolute' }),
    description: `have path matching "${glob}"`,
    test: (sourceFile) => {
      const filePath = sourceFile.getFilePath()
      if (isMatch(filePath)) return true
      if (!relative) return false
      const fromRoot = relativeToRoot(sourceFile, filePath)
      return fromRoot !== undefined && isMatch(fromRoot)
    },
  }
}

// --- Export predicates ---

/**
 * Matches elements that are exported from their module.
 */
export function areExported<T extends Exportable>(): Predicate<T> {
  return {
    description: 'are exported',
    test: (element) => element.isExported(),
  }
}

/**
 * Matches elements that are NOT exported from their module.
 */
export function areNotExported<T extends Exportable>(): Predicate<T> {
  return {
    description: 'are not exported',
    test: (element) => !element.isExported(),
  }
}
