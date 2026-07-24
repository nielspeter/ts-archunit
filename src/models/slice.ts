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

/** Glob metacharacters that make a segment non-literal. */
const GLOB_META = /[*?[\]{}!]/

/**
 * The two things a `matching()` glob has to yield, derived from **one**
 * normalization of the input.
 *
 * Deriving them from differently-normalized inputs is what made bug 0009
 * possible: the picomatch pattern accepted spellings whose `baseDir` could never
 * be found in a path, so files matched and were then silently discarded during
 * slice-name extraction. Both now come from the same `normalized` string, which
 * removes that divergence class — though they remain distinct derivations (for
 * `'src/features'` the pattern's base is `src/features` while `baseDir` is
 * `src/`, by design: the final segment is a name filter, not a directory).
 */
interface MatchingGlob {
  /** Absolute-path pattern handed to picomatch. */
  readonly fullGlob: string
  /** Wildcard-free literal directory prefix, located in the path to name slices. */
  readonly baseDir: string
}

/**
 * Normalize a `matching()` glob so every spelling of one intent agrees.
 *
 * `'src/features/*'`, `'src/features/*\/'`, `'**\/src/features/*'` and
 * `'**\/src/features/*\/'` all resolve the same slices: a leading `**\/` is
 * redundant (patterns are matched against absolute paths anyway) and a trailing
 * `/` only says "a directory", which is already implied.
 */
function parseMatchingGlob(glob: string): MatchingGlob {
  let normalized = glob
  // A leading './' is what people copy out of tsconfig `include`; it never occurs
  // in an absolute path, so leaving it in made the whole glob unmatchable while
  // every stated remedy ("check the prefix", "add '**/'") was false.
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  while (normalized.startsWith('**/')) normalized = normalized.slice(3)

  // Strip a trailing '/' ONLY when the final segment is a wildcard. For
  // 'src/features/*/' the slash is redundant, but for a wildcard-free
  // 'src/features/' it is the whole meaning: "the directories inside features",
  // not "paths starting with features". Stripping it unconditionally collapsed
  // the latter into a single slice named 'features' — and one mega-slice makes
  // beFreeOfCycles structurally unable to fail, because intra-slice edges are
  // dropped. That turned a real cycle from red to green.
  if (normalized.endsWith('/')) {
    const withoutSlash = normalized.slice(0, -1)
    const finalSegment = withoutSlash.slice(withoutSlash.lastIndexOf('/') + 1)
    if (GLOB_META.test(finalSegment)) normalized = withoutSlash
  }

  // Prepend ** unless already absolute, so the pattern matches anywhere in an
  // absolute path. Append */** to match the slice segment + anything inside it.
  const fullGlob = (normalized.startsWith('/') ? normalized : '**/' + normalized) + '*/**'

  // baseDir is the literal prefix up to the FIRST wildcard, cut back to a '/'
  // boundary — so it is a real directory path that `indexOf` can find. Taking
  // everything up to the *last* '/' instead (the old behavior) put a wildcard
  // inside baseDir for any glob with a trailing or interior `*`, which then
  // matched no path at all.
  const metaIdx = normalized.search(GLOB_META)
  const literal = metaIdx === -1 ? normalized : normalized.slice(0, metaIdx)
  const lastSlashIdx = literal.lastIndexOf('/')
  const baseDir = lastSlashIdx >= 0 ? literal.slice(0, lastSlashIdx + 1) : ''

  return { fullGlob, baseDir }
}

/**
 * Resolve slices by matching a glob pattern against source file paths.
 *
 * The segment following the glob's literal prefix names each slice. That segment
 * is a **directory** when files are nested under it, and otherwise each matching
 * **file** name — `matching('src/features/*')` over `features/billing/order.ts`
 * yields a `billing` slice, while over a flat `services/order.service.ts` it
 * yields an `order.service.ts` slice.
 *
 * Every spelling of the same intent agrees: `'src/features/*'`,
 * `'src/features/*\/'` and `'**\/src/features/*'` are equivalent.
 *
 * @param project - The loaded ArchProject
 * @param glob - A glob whose literal prefix locates the slices; the next segment names them
 * @returns Array of slices, one per distinct name
 *
 * @example
 * resolveByMatching(project, 'src/features/*')
 * // => [{ name: 'auth', files: [...] }, { name: 'billing', files: [...] }]
 */
export function resolveByMatching(project: ArchProject, glob: string): Slice[] {
  const { fullGlob, baseDir } = parseMatchingGlob(glob)

  // No literal directory prefix (e.g. '*', '**', 'src' with no '/'). Bail rather
  // than search for '' in the path: `indexOf('')` is 0, so the "slice name" would
  // be the path's first segment — empty on POSIX (harmless by accident) but the
  // drive letter on Windows, which would mint ONE slice holding every file and
  // silently pass every inter-slice condition. Returning no slices makes the
  // discovery guard fire instead (ADR-008).
  if (baseDir === '') return []
  const isMatch = picomatch(fullGlob)
  const sourceFiles = project.getSourceFiles()
  const sliceMap = new Map<string, SourceFile[]>()

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
