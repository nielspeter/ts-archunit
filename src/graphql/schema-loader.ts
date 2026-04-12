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
 * Load the graphql package synchronously. Throws a clear error if not installed.
 *
 * Uses createRequire for synchronous loading since schema loading is synchronous.
 */
function requireGraphQL(): GraphQLPackage {
  if (cachedGraphQL) return cachedGraphQL

  try {
    const esmRequire = createRequire(import.meta.url)
    cachedGraphQL = esmRequire('graphql') as GraphQLPackage
    return cachedGraphQL
  } catch {
    throw new Error(
      '[ts-archunit/graphql] The "graphql" package is required but not installed.\n' +
        'Install it with: npm install graphql',
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
