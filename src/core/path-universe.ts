import type { ArchProject } from './project.js'

/**
 * Every path a glob could legitimately match in a project, materialized once.
 *
 * A free function over `ArchProject` rather than a method on it: bare-object
 * `ArchProject` literals are real test doubles across the suite, and adding a
 * required method would break every one of them. Lives in `src/core/`, takes
 * `ArchProject` in and hands plain strings out, and imports no ts-morph —
 * ADR-007's batch-first shape by construction, one materialization instead of
 * a traversal per glob.
 */
export interface PathUniverse {
  /** Absolute paths of every file in the project. */
  readonly filePaths: readonly string[]
  /**
   * Immediate parent directories only.
   *
   * Not all ancestors. `resideInFolder` tests
   * `filePath.substring(0, filePath.lastIndexOf('/'))` — the immediate parent
   * and nothing else — so an all-ancestors set is not a harmless
   * over-approximation, it is a **false green**: measured on this repo, 41 of
   * the 122 ancestors are no file's parent, so `resideInFolder('**\/tests/fixtures')`
   * can never select anything while an all-ancestors universe calls it
   * satisfiable. Using the parent set removes the over-approximation rather
   * than excusing it.
   */
  readonly parentDirs: readonly string[]
  /** `filePaths` relative to the tsconfig directory, for message wording. */
  readonly tsconfigRelativeFilePaths: readonly string[]
  /** `parentDirs` relative to the tsconfig directory, for message wording. */
  readonly tsconfigRelativeParentDirs: readonly string[]
}

const cache = new WeakMap<ArchProject, PathUniverse>()

/**
 * The project's path universe, computed once per project.
 *
 * Memoized on the project identity, so a rule file with fifty rules pays for
 * one traversal rather than fifty.
 */
export function pathUniverse(project: ArchProject): PathUniverse {
  const cached = cache.get(project)
  if (cached) return cached

  const filePaths = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath())
  const parentDirs = [
    ...new Set(filePaths.map((filePath) => filePath.substring(0, filePath.lastIndexOf('/')))),
  ]
  const root = tsconfigDir(project.tsConfigPath)
  const universe: PathUniverse = {
    filePaths,
    parentDirs,
    tsconfigRelativeFilePaths: filePaths.map((filePath) => relativeTo(root, filePath)),
    tsconfigRelativeParentDirs: parentDirs.map((dir) => relativeTo(root, dir)),
  }
  cache.set(project, universe)
  return universe
}

/**
 * The views a glob of this kind is matched against.
 *
 * Satisfiability is taken against the **union** — a glob is unsatisfiable only
 * when nothing in any view matches it. That is deliberately generous, so that
 * a wrong `base` cannot make a glob look unmatched. It does NOT make `base`
 * message-only: the anchor check in `syntacticFault` consults it, and an
 * unanchored `base: 'absolute'` glob is dead regardless of what any view
 * holds. See `GlobBase`.
 *
 * `import-target`, `specifier` and `literal` are not path kinds and have no
 * views, so they can never be found unsatisfiable here.
 */
export function viewsFor(
  universe: PathUniverse,
  kind: 'file-path' | 'parent-dir' | 'import-target' | 'specifier' | 'literal',
): readonly (readonly string[])[] {
  if (kind === 'file-path') return [universe.filePaths, universe.tsconfigRelativeFilePaths]
  if (kind === 'parent-dir') return [universe.parentDirs, universe.tsconfigRelativeParentDirs]
  return []
}

/** The directory containing the tsconfig, with forward slashes and no trailing separator. */
function tsconfigDir(tsConfigPath: string): string {
  const normalized = tsConfigPath.replaceAll('\\', '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
}

/**
 * `filePath` relative to `root`, or unchanged when it sits outside.
 *
 * Deliberately not `path.relative`: that would emit `../../..` for a path
 * above the root, which encodes the root's depth — machine-dependent, and the
 * same mistake `toPortablePath` exists to avoid.
 */
function relativeTo(root: string, filePath: string): string {
  if (root === '') return filePath
  const prefix = root.endsWith('/') ? root : root + '/'
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}
