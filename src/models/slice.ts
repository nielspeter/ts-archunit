import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { ArchProject } from '../core/project.js'

/**
 * A slice groups source files into a logical unit.
 * Slices are the nodes in the slice dependency graph.
 */
export interface Slice {
  /** Slice name — directory name for matching(), key name for assignedFrom() */
  readonly name: string
  /** Source files belonging to this slice */
  readonly files: SourceFile[]
}

/**
 * A mapping of slice names to glob patterns.
 * Used by `assignedFrom()` to define slices explicitly.
 *
 * @example
 * const layers: SliceDefinition = {
 *   presentation: 'src/controllers/**',
 *   application: 'src/services/**',
 *   domain: 'src/domain/**',
 * }
 */
export type SliceDefinition = Record<string, string>

/**
 * Resolve slices by matching a glob pattern against source file paths.
 * Each unique directory matching the glob becomes a slice.
 *
 * The glob must contain a wildcard segment that distinguishes slices.
 * For example, 'src/features/*\/' matches each subdirectory of src/features/
 * as a separate slice.
 *
 * @param project - The loaded ArchProject
 * @param glob - A glob pattern where the wildcard segment defines slice boundaries
 * @returns Array of slices, one per matching directory
 *
 * @example
 * resolveByMatching(project, 'src/features/*\/')
 * // => [{ name: 'auth', files: [...] }, { name: 'billing', files: [...] }]
 */
export function resolveByMatching(project: ArchProject, glob: string): Slice[] {
  // Prepend ** if the glob is not already absolute or globbed at the root,
  // so it matches anywhere in an absolute file path.
  // Append */** to match: the slice directory segment (*) + any files inside (/**)
  const fullGlob =
    glob.startsWith('/') || glob.startsWith('**') ? glob + '*/**' : '**/' + glob + '*/**'
  const isMatch = picomatch(fullGlob)
  const sourceFiles = project.getSourceFiles()
  const sliceMap = new Map<string, SourceFile[]>()

  // Extract the base directory (everything up to and including the last / in the original glob)
  // For 'src/feature-', basedir is 'src/' so that 'feature-a' is extracted as slice name.
  // For 'src/features/*/', basedir is 'src/features/' so that the wildcard dirs are slice names.
  const lastSlashIdx = glob.lastIndexOf('/')
  const baseDir = lastSlashIdx >= 0 ? glob.slice(0, lastSlashIdx + 1) : ''

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath()
    if (!isMatch(filePath)) continue

    // Extract the slice name: the first directory segment after baseDir
    const baseDirIdx = filePath.indexOf(baseDir)
    if (baseDirIdx === -1) continue
    const relativePart = filePath.slice(baseDirIdx + baseDir.length)
    const sliceName = relativePart.split('/')[0]
    if (!sliceName) continue

    const existing = sliceMap.get(sliceName)
    if (existing) {
      existing.push(sf)
    } else {
      sliceMap.set(sliceName, [sf])
    }
  }

  return Array.from(sliceMap.entries()).map(([name, files]) => ({ name, files }))
}

/**
 * Resolve slices from an explicit name-to-glob mapping.
 * Each key becomes a slice name, and files matching its glob are assigned to it.
 *
 * A file matching multiple globs is assigned to the FIRST matching slice.
 * Files matching no glob are excluded from all slices.
 *
 * @param project - The loaded ArchProject
 * @param definition - Map of slice names to glob patterns
 * @returns Array of slices in definition key order
 *
 * @example
 * resolveByDefinition(project, {
 *   presentation: 'src/controllers/**',
 *   domain: 'src/domain/**',
 * })
 */
export function resolveByDefinition(project: ArchProject, definition: SliceDefinition): Slice[] {
  const sourceFiles = project.getSourceFiles()
  const entries = Object.entries(definition)
  const matchers = entries.map(
    ([name, glob]): { name: string; isMatch: picomatch.Matcher; files: SourceFile[] } => ({
      name,
      isMatch: picomatch(glob),
      files: [],
    }),
  )

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath()
    for (const matcher of matchers) {
      if (matcher.isMatch(filePath)) {
        matcher.files.push(sf)
        break // first match wins
      }
    }
  }

  return matchers.map(({ name, files }) => ({ name, files }))
}
