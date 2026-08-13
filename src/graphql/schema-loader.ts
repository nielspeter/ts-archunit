import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'

/**
 * A parsed GraphQL schema with per-file document tracking.
 *
 * The schema is the merged result of all matched .graphql files.
 * Documents preserve per-file source information for violation reporting.
 */
export interface LoadedSchema {
  /** The merged GraphQL schema object (from `graphql` package's buildSchema) */
  readonly schema: GraphQLSchemaLike
  /** Per-file parsed documents with source location info */
  readonly documents: ReadonlyArray<{
    readonly filePath: string
    readonly sdl: string
  }>
}

/**
 * Minimal interface for the parts of GraphQLSchema we use.
 * Avoids importing graphql types at the module level (optional peer dep).
 */
export interface GraphQLSchemaLike {
  getQueryType(): GraphQLObjectTypeLike | undefined | null
  getMutationType(): GraphQLObjectTypeLike | undefined | null
  getTypeMap(): Record<string, GraphQLTypeLike>
}

/**
 * Minimal interface for GraphQL object types.
 */
export interface GraphQLObjectTypeLike {
  readonly name: string
  getFields(): Record<string, GraphQLFieldLike>
}

/**
 * Minimal interface for GraphQL fields.
 */
export interface GraphQLFieldLike {
  readonly name: string
  readonly type: GraphQLTypeLike
  readonly args: ReadonlyArray<GraphQLArgumentLike>
}

/**
 * Minimal interface for GraphQL arguments.
 */
export interface GraphQLArgumentLike {
  readonly name: string
  readonly type: GraphQLTypeLike
}

/**
 * Minimal interface for GraphQL types.
 */
export interface GraphQLTypeLike {
  readonly toString: () => string
}

/**
 * GraphQL package interface — the subset of functions we use.
 */
interface GraphQLPackage {
  buildSchema: (sdl: string) => GraphQLSchemaLike
}

// Cached reference to the graphql package
let cachedGraphQL: GraphQLPackage | undefined

/**
 * The actual loading step, indirected through a swappable reference (see
 * {@link setGraphQLLoaderForTests}). Uses createRequire for synchronous
 * loading since schema loading is synchronous.
 */
function defaultLoadGraphQL(): GraphQLPackage {
  const esmRequire = createRequire(import.meta.url)
  // `createRequire` returns `any` for an optional peer dependency resolved at
  // runtime, so there is no typed path here — the JS-interop boundary ADR-005
  // allows. The `catch` below is the real guard: a missing or malformed
  // `graphql` throws with an install instruction rather than failing later on a
  // property access (bug 0049).
  // ts-archunit-exclude adr005/no-as-cast-module: optional peer dep, no typed path
  return esmRequire('graphql') as GraphQLPackage
}

let loadGraphQL: () => GraphQLPackage = defaultLoadGraphQL

/**
 * Load the graphql package synchronously. Throws a clear error describing why
 * the package could not be used.
 */
function requireGraphQL(): GraphQLPackage {
  if (cachedGraphQL) return cachedGraphQL

  try {
    cachedGraphQL = loadGraphQL()
    return cachedGraphQL
  } catch (cause) {
    // The install instruction only answers "the `graphql` package itself is
    // missing". Node's own MODULE_NOT_FOUND names the specifier it failed to
    // resolve: requiring the missing top-level package throws
    // "Cannot find module 'graphql'", while requiring an installed-but-corrupt
    // package (one of ITS internal files missing) throws naming that internal
    // file instead — same code, different specifier. Checking the message for
    // the exact top-level specifier (verified against Node's actual output,
    // see the fixture in tests/graphql/schema-loader-require-errors.test.ts)
    // is what keeps a corrupt install from being told to run an install that
    // cannot fix it. Every other cause — that corrupt-internal-file case, a
    // version mismatch, a throw from `graphql`'s own module initialisation —
    // used to be reported as "not installed" too, discarding the one line
    // that would have told the reader what actually happened. Found by
    // running `preset/recommended/no-silent-catch` over our own `src/` for
    // the first time.
    const notInstalled =
      cause instanceof Error &&
      'code' in cause &&
      cause.code === 'MODULE_NOT_FOUND' &&
      /Cannot find module 'graphql'/.test(cause.message)
    if (notInstalled) {
      throw new Error(
        '[ts-archunit/graphql] The "graphql" package is required but not installed.\n' +
          'Install it with: npm install graphql',
        { cause },
      )
    }
    throw new Error(
      `[ts-archunit/graphql] The "graphql" package is installed but could not be loaded: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    )
  }
}

/**
 * Load and parse .graphql files matching a glob pattern relative to a root directory.
 *
 * @param rootDir - The root directory to resolve the glob against
 * @param glob - Glob pattern for .graphql files (e.g. 'schema/*.graphql')
 * @returns A LoadedSchema with the merged schema and per-file documents
 * @throws If no .graphql files are found or if SDL is invalid
 */
export function loadSchemaFromGlob(rootDir: string, glob: string): LoadedSchema {
  const resolvedRoot = path.resolve(rootDir)
  const matcher = picomatch(glob)

  // Find all .graphql files matching the glob
  const graphqlFiles = findGraphqlFiles(resolvedRoot, matcher)

  if (graphqlFiles.length === 0) {
    throw new Error(
      `[ts-archunit/graphql] No .graphql files found matching "${glob}" in ${resolvedRoot}`,
    )
  }

  // Read all files and collect SDL
  const documents: Array<{ filePath: string; sdl: string }> = []
  const sdlParts: string[] = []

  for (const filePath of graphqlFiles) {
    const sdl = fs.readFileSync(filePath, 'utf-8')
    documents.push({ filePath, sdl })
    sdlParts.push(sdl)
  }

  return buildLoadedSchema(sdlParts.join('\n'), documents)
}

/**
 * Load a schema from a raw SDL string.
 *
 * @param sdl - GraphQL Schema Definition Language string
 * @param sourcePath - Optional file path for error reporting
 * @returns A LoadedSchema
 */
export function loadSchemaFromSDL(sdl: string, sourcePath?: string): LoadedSchema {
  const documents = [{ filePath: sourcePath ?? '<inline>', sdl }]
  return buildLoadedSchema(sdl, documents)
}

/**
 * Build a LoadedSchema from concatenated SDL and per-file document list.
 */
function buildLoadedSchema(
  sdl: string,
  documents: Array<{ filePath: string; sdl: string }>,
): LoadedSchema {
  const gql = requireGraphQL()
  const schema = gql.buildSchema(sdl)
  return { schema, documents }
}

/**
 * Recursively find .graphql files in a directory that match the given predicate.
 */
function findGraphqlFiles(
  dir: string,
  matcher: (relativePath: string) => boolean,
  rootDir?: string,
): string[] {
  const root = rootDir ?? dir
  const results: string[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findGraphqlFiles(fullPath, matcher, root))
    } else if (entry.name.endsWith('.graphql')) {
      const relativePath = path.relative(root, fullPath)
      if (matcher(relativePath)) {
        results.push(fullPath)
      }
    }
  }

  return results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Check whether the graphql package is available.
 * Used by the runtime guard in the barrel export.
 */
export function isGraphQLAvailable(): boolean {
  try {
    requireGraphQL()
    return true
  } catch {
    return false
  }
}

/**
 * Replace how `graphql` is loaded. **Tests only** —
 * [bug 0080](../../bugs/fixed/0080-a-node-module-mock-does-not-isolate-under-full-suite-concurrency.md):
 * `vi.doMock('node:module', ...)` intercepts a Node builtin, which is not
 * reliably isolated per-file under Vitest's worker-reuse defaults and failed
 * intermittently under full-suite load. This seam replaces only this
 * module's own loading step — nothing shared with any other file to race on.
 */
export function setGraphQLLoaderForTests(loader: () => GraphQLPackage): void {
  loadGraphQL = loader
}

/**
 * Restore the real loader and clear the cached package. **Tests only** — see
 * {@link setGraphQLLoaderForTests}.
 */
export function resetGraphQLLoaderForTests(): void {
  loadGraphQL = defaultLoadGraphQL
  cachedGraphQL = undefined
}
