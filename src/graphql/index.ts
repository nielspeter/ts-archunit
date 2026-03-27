/**
 * GraphQL extension for ts-archunit.
 *
 * Sub-path export: `import { schema, resolvers } from '@nielspeter/ts-archunit/graphql'`
 *
 * Requires the `graphql` npm package as an optional peer dependency.
 * Schema loading will throw a clear error if graphql is not installed.
 */

import type { ArchProject } from '../core/project.js'
import { loadSchemaFromGlob, loadSchemaFromSDL } from './schema-loader.js'
import { SchemaRuleBuilder } from './schema-rule-builder.js'
import { ResolverRuleBuilder } from './resolver-rule-builder.js'

// --- Entry points ---

/**
 * Create a schema rule builder scoped to .graphql files matching the glob.
 *
 * @param projectOrRoot - ArchProject (uses tsconfig root) or a directory path
 * @param glob - Glob pattern for .graphql files (e.g. 'schema/*.graphql')
 * @returns A SchemaRuleBuilder for defining schema architecture rules
 *
 * @example
 * ```typescript
 * import { project } from '@nielspeter/ts-archunit'
 * import { schema } from '@nielspeter/ts-archunit/graphql'
 *
 * const p = project('tsconfig.json')
 * schema(p, 'src/schema/*.graphql')
 *   .typesNamed(/Collection$/)
 *   .should()
 *   .haveFields('total', 'skip', 'limit', 'items')
 *   .check()
 * ```
 */
export function schema(projectOrRoot: ArchProject | string, glob: string): SchemaRuleBuilder {
  const rootDir =
    typeof projectOrRoot === 'string' ? projectOrRoot : extractRootDir(projectOrRoot.tsConfigPath)
  const loaded = loadSchemaFromGlob(rootDir, glob)
  return new SchemaRuleBuilder(loaded)
}

/**
 * Create a schema rule builder from a raw SDL string.
 *
 * @param sdl - GraphQL Schema Definition Language string
 * @param sourcePath - Optional file path for error reporting
 * @returns A SchemaRuleBuilder
 */
export function schemaFromSDL(sdl: string, sourcePath?: string): SchemaRuleBuilder {
  const loaded = loadSchemaFromSDL(sdl, sourcePath)
  return new SchemaRuleBuilder(loaded)
}

/**
 * Create a resolver rule builder scoped to TypeScript files matching the glob.
 *
 * Resolver files are regular TypeScript — analyzed via ts-morph, not the graphql package.
 * Conditions like contain(call('loader.load')) reuse the body analysis engine.
 *
 * @param p - The loaded ArchProject
 * @param glob - Glob pattern for resolver files (e.g. 'src/resolvers/**')
 * @returns A ResolverRuleBuilder
 *
 * @example
 * ```typescript
 * import { project } from '@nielspeter/ts-archunit'
 * import { resolvers } from '@nielspeter/ts-archunit/graphql'
 * import { call } from '@nielspeter/ts-archunit'
 *
 * const p = project('tsconfig.json')
 * resolvers(p, 'src/resolvers/**')
 *   .that()
 *   .resolveFieldReturning(/^[A-Z]/)
 *   .should()
 *   .contain(call('loader.load'))
 *   .because('prevent N+1 queries')
 *   .check()
 * ```
 */
export function resolvers(p: ArchProject, glob: string): ResolverRuleBuilder {
  const sourceFiles = p.getSourceFiles().filter((sf) => {
    const filePath = sf.getFilePath()
    return picomatchFilter(filePath, glob, extractRootDir(p.tsConfigPath))
  })
  return new ResolverRuleBuilder(sourceFiles)
}

// --- Re-exports ---

export { SchemaRuleBuilder } from './schema-rule-builder.js'
export { ResolverRuleBuilder } from './resolver-rule-builder.js'
export { resolveFieldReturning } from './resolver-rule-builder.js'

// Schema predicates (standalone)
export { queries, mutations, typesNamed, returnListOf } from './schema-predicates.js'
export type { SchemaElement } from './schema-predicates.js'

// Schema conditions (standalone)
export { haveFields, acceptArgs, haveMatchingResolver } from './schema-conditions.js'

// Schema loader utilities
export { loadSchemaFromGlob, loadSchemaFromSDL, isGraphQLAvailable } from './schema-loader.js'
export type {
  LoadedSchema,
  GraphQLSchemaLike,
  GraphQLObjectTypeLike,
  GraphQLFieldLike,
  GraphQLArgumentLike,
  GraphQLTypeLike,
} from './schema-loader.js'

// --- Internal helpers ---

import path from 'node:path'
import picomatch from 'picomatch'

function extractRootDir(tsConfigPath: string): string {
  return path.dirname(tsConfigPath)
}

const matcherCache = new Map<string, picomatch.Matcher>()

function picomatchFilter(filePath: string, glob: string, rootDir: string): boolean {
  const relativePath = path.relative(rootDir, filePath)
  let matcher = matcherCache.get(glob)
  if (!matcher) {
    matcher = picomatch(glob)
    matcherCache.set(glob, matcher)
  }
  return matcher(relativePath)
}
