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
 * A segment that denotes "the slice level" rather than a directory name.
 *
 * Deliberately only `*` / `**`, not "any segment containing a metacharacter":
 * `[slug]`, `(marketing)`, `[...rest]` are ordinary directory names in Next.js,
 * Remix and SvelteKit projects. Treating them as wildcards truncated `baseDir`
 * mid-path, which merged real sibling directories into one slice — dropping the
 * intra-slice edges that `beFreeOfCycles` needs and turning a real cycle green.
 */
const WILDCARD_SEGMENT = /^\*{1,2}$/

/**
 * Characters that make a segment non-literal for prefix purposes.
 *
 * Only `*` and `?`. Brackets and braces are excluded deliberately: `[slug]`,
 * `(marketing)` and `{a,b}` occur as real directory names, and a `baseDir` cut
 * before them is located in the path literally — which is what makes those routes
 * resolve correctly. Cutting at `*`/`?` matters for partial wildcards
 * (`src/feature-*\/x/*`), where keeping the segment would put a `*` inside
 * `baseDir` and no path could ever contain it.
 */
const WILDCARD_CHARS = /[*?]/

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
 * Redundant and therefore stripped: a leading `**\/` (patterns are matched against
 * absolute paths anyway), a leading `./` (never present in an absolute path), and a
 * trailing `/` **after a wildcard segment**.
 *
 * A trailing `/` after a *literal* segment is NOT redundant: `'src/features/'` means
 * "the directories inside features", while `'src/features'` makes `features` a name
 * filter and yields a single slice. So these are equivalent —
 * `'src/features/*'`, `'src/features/*\/'`, `'src/features/'`,
 * `'**\/src/features/*'`, `'./src/features/*'` — and `'src/features'` is different.
 */
function parseMatchingGlob(glob: string): MatchingGlob {
  let normalized = glob
  // Loop over BOTH redundant prefixes together: './' and '**/' can appear in
  // either order ('**/./src/*'), and stripping one kind to exhaustion before the
  // other left a residual that made the whole glob unmatchable.
  while (normalized.startsWith('./') || normalized.startsWith('**/')) {
    normalized = normalized.startsWith('./') ? normalized.slice(2) : normalized.slice(3)
  }

  // A trailing '/' after a wildcard segment is redundant ('src/features/*/' means
  // the same as 'src/features/*'), so drop it — otherwise the pattern would demand
  // an extra directory level. After a LITERAL segment it is meaningful and stays:
  // 'src/features/' means the directories inside features. The test is "the segment
  // IS a wildcard", never "contains a metacharacter" — `[slug]` is a real directory.
  if (normalized.endsWith('/')) {
    const withoutSlash = normalized.slice(0, -1)
    const finalSegment = withoutSlash.slice(withoutSlash.lastIndexOf('/') + 1)
    if (WILDCARD_SEGMENT.test(finalSegment)) normalized = withoutSlash
  }

  const endsWithSlash = normalized.endsWith('/')
  const segments = normalized.split('/').filter((segment) => segment !== '')

  // The slice level is the first `*`/`**` segment; everything literal before it is
  // the directory prefix we locate in the path. With no wildcard segment at all, a
  // trailing '/' means "the directories inside this one" (so every segment is
  // prefix), while its absence makes the final segment a name filter — that is what
  // distinguishes 'src/features/' (slices inside features) from 'src/feature-'
  // (slices named feature-*).
  const wildcardIdx = segments.findIndex((segment) => WILDCARD_CHARS.test(segment))
  const prefixSegments =
    wildcardIdx >= 0
      ? segments.slice(0, wildcardIdx)
      : endsWithSlash
        ? segments
        : segments.slice(0, -1)
  const baseDir = prefixSegments.length > 0 ? prefixSegments.join('/') + '/' : ''

  // The pattern keeps the glob's own shape (interior segments included) so that
  // `packages/*/src/*` still requires the `/src/` level, and `dir/*` still matches
  // files sitting directly in `dir` as well as subdirectories. Only `baseDir` is
  // segment-derived — it is the part that has to be findable in a real path.
  const fullGlob = (normalized.startsWith('/') ? normalized : '**/' + normalized) + '*/**'

  return { fullGlob, baseDir }
}

/**
 * The literal directory prefix a `matching()` glob would search for, or `''` when
 * it has none (`'*'`, `'src'`, `'{a,b}/x/*'`). Exposed so the rule builder can
 * state the *actual* cause of an empty result instead of guessing at one.
 */
export function matchingGlobPrefix(glob: string): string {
  return parseMatchingGlob(glob).baseDir
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
 * `'src/features/*\/'`, `'src/features/'` and `'**\/src/features/*'` are equivalent.
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
