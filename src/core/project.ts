import { Project, type SourceFile } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs'

/**
 * A loaded TypeScript project. Returned by `project()`.
 *
 * Wraps a ts-morph `Project` and provides access to source files.
 * Use this as the first argument to entry points like `classes(p)`, `modules(p)`, etc.
 */
export interface ArchProject {
  /** Resolved absolute path to the tsconfig.json used to load this project. */
  readonly tsConfigPath: string

  /** Returns all source files included by the tsconfig. */
  getSourceFiles(): SourceFile[]

  /**
   * The underlying ts-morph Project.
   * @internal Used by entry points — not part of the public API.
   */
  readonly _project: Project
}

const cache = new Map<string, ArchProject>()

/**
 * Load a TypeScript project from a tsconfig.json path.
 *
 * Returns a cached instance if the same tsconfig has been loaded before.
 * The tsconfig path is resolved to an absolute path before caching,
 * so relative and absolute paths pointing to the same file share one instance.
 *
 * @param tsConfigPath - Path to tsconfig.json (relative or absolute)
 * @throws {Error} If the tsconfig file does not exist
 */
export function project(tsConfigPath: string): ArchProject {
  const resolved = path.resolve(tsConfigPath)

  const cached = cache.get(resolved)
  if (cached) {
    return cached
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `tsconfig not found: ${resolved}\n` +
        `Provide a valid path to tsconfig.json, e.g. project('tsconfig.json') or project('./packages/app/tsconfig.json')`,
    )
  }

  const tsMorphProject = new Project({
    tsConfigFilePath: resolved,
  })

  const archProject: ArchProject = {
    tsConfigPath: resolved,
    _project: tsMorphProject,
    getSourceFiles() {
      return tsMorphProject.getSourceFiles()
    },
  }

  cache.set(resolved, archProject)
  return archProject
}

/**
 * Clear the project singleton cache.
 *
 * Used by watch mode to force fresh ts-morph Project creation on re-runs,
 * and by tests for isolation between test cases.
 */
export function resetProjectCache(): void {
  cache.clear()
}
