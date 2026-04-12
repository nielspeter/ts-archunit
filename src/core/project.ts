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

// ─── Workspace (multi-tsconfig) ─────────────────────────────────

const workspaceCache = new Map<string, ArchProject>()

/**
 * Load multiple TypeScript projects into a unified view.
 *
 * Returns a standard `ArchProject` backed by a single ts-morph `Project`
 * that contains source files from all tsconfigs. This makes cross-workspace
 * imports visible to `beImported()`, `haveNoUnusedExports()`, and all other
 * conditions that traverse the import graph.
 *
 * Paths are sorted alphabetically before loading. The alphabetically first
 * tsconfig's compiler options are used for type checking — this makes
 * behavior deterministic regardless of the order paths are passed.
 * Subsequent tsconfigs only contribute their source files.
 *
 * @param tsConfigPaths - Paths to tsconfig.json files (relative or absolute)
 * @throws {Error} If any tsconfig file does not exist or if no paths are provided
 *
 * @example
 * const ws = workspace([
 *   'apps/web/tsconfig.json',
 *   'apps/api/tsconfig.json',
 *   'packages/shared/tsconfig.json',
 * ])
 *
 * modules(ws)
 *   .that().resideInFolder('** /packages/shared/src/** ')
 *   .should().satisfy(noUnusedExports())
 *   .check()
 */
export function workspace(tsConfigPaths: string[]): ArchProject {
  if (tsConfigPaths.length === 0) {
    throw new Error(
      'workspace() requires at least one tsconfig path.\n' +
        'Example: workspace(["apps/web/tsconfig.json", "packages/shared/tsconfig.json"])',
    )
  }

  // Sort resolved paths so the primary config (first) is deterministic
  // regardless of call order. workspace([A,B]) and workspace([B,A]) produce
  // identical projects with the same compiler options (alphabetically first wins).
  // Unicode codepoint order — deterministic across all OS locales (no localeCompare)
  const resolvedPaths = tsConfigPaths
    .map((p) => path.resolve(p))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const cacheKey = resolvedPaths.join('\0')
  const cached = workspaceCache.get(cacheKey)
  if (cached) {
    return cached
  }

  // Validate all paths exist before creating the project
  for (const resolved of resolvedPaths) {
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `tsconfig not found: ${resolved}\n` +
          `Provide valid paths to tsconfig.json files in the workspace() call.`,
      )
    }
  }

  // Create project with the alphabetically first tsconfig's compiler options
  const primaryConfig = resolvedPaths[0]
  if (!primaryConfig) throw new Error('No resolved paths available')
  const tsMorphProject = new Project({
    tsConfigFilePath: primaryConfig,
  })

  // Add source files from remaining tsconfigs
  for (let i = 1; i < resolvedPaths.length; i++) {
    const configPath = resolvedPaths[i]
    if (configPath) tsMorphProject.addSourceFilesFromTsConfig(configPath)
  }

  const archProject: ArchProject = {
    tsConfigPath: primaryConfig,
    _project: tsMorphProject,
    getSourceFiles() {
      return tsMorphProject.getSourceFiles()
    },
  }

  workspaceCache.set(cacheKey, archProject)
  return archProject
}

/**
 * Clear the project singleton cache.
 *
 * Used by watch mode to force fresh ts-morph Project creation on re-runs,
 * and by tests for isolation between test cases.
 *
 * Clears both the `project()` and `workspace()` caches.
 */
export function resetProjectCache(): void {
  cache.clear()
  workspaceCache.clear()
}
