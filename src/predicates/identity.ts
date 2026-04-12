import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'

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
  return {
    description: `reside in file matching "${glob}"`,
    test: (element) => isMatch(element.getSourceFile().getFilePath()),
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
  return {
    description: `reside in folder matching "${glob}"`,
    test: (element) => {
      const filePath = element.getSourceFile().getFilePath()
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))
      return isMatch(dirPath)
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
