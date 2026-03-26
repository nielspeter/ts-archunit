# Plan 0021: GraphQL Extension — Schema & Resolver Rules

## Status

- **State:** Done
- **Priority:** P3 — Build when users ask for it
- **Effort:** 3-5 days
- **Created:** 2026-03-26
- **Depends on:** 0005 (Rule Builder), 0011 (Body Analysis)

## Purpose

Ship a GraphQL extension as a separate entry point (`ts-archunit/graphql`) that lets users enforce architecture rules on `.graphql` schema files and their TypeScript resolver implementations. GraphQL schemas are not TypeScript — they need their own parser — so this lives outside the core (spec Section 9).

Two motivating rules from the spec:

```typescript
import { schema, resolvers } from 'ts-archunit/graphql'

// Collection types must have standard pagination fields
schema(p, 'src/**/*.graphql')
  .typesNamed(/Collection$/)
  .should()
  .haveFields('total', 'skip', 'limit', 'items')
  .check()

// Resolver fields returning objects must use DataLoader
resolvers(p, 'src/resolvers/**')
  .that()
  .resolveFieldReturning(/^[A-Z]/)
  .should()
  .contain(call('loader.load'))
  .because('prevent N+1 queries')
  .check()
```

## Design Decisions

### Separate entry point, optional peer dependency

The `graphql` npm package is only needed by projects that have a GraphQL layer. It is listed as an `optionalPeerDependency` — not a hard dependency of ts-archunit. The sub-path export `ts-archunit/graphql` is only importable when `graphql` is installed. This follows ADR-004 (ESM sub-path exports) and the pattern established by `ts-archunit/rules/*` in plan 0024.

**Runtime guard:** The entry point (`src/graphql/index.ts`) must check for the `graphql` package at import time and throw a clear error if missing. This prevents cryptic module-not-found errors when users import `ts-archunit/graphql` without `graphql` installed.

```json
{
  "exports": {
    "./graphql": {
      "types": "./dist/graphql/index.d.ts",
      "import": "./dist/graphql/index.js"
    }
  },
  "peerDependencies": {
    "graphql": "^16.0.0"
  },
  "peerDependenciesMeta": {
    "graphql": { "optional": true }
  }
}
```

### Reuse body analysis engine for resolvers

Resolver conditions (`contain`, `notContain`) reuse the same body analysis matchers from plan 0011 (`call()`, `newExpr()`, `access()`). No new matcher infrastructure is needed — resolvers are TypeScript functions, so the existing engine applies directly.

### Schema parsing via `graphql` package

Schema files are parsed with `graphql`'s `buildSchema()` / `parse()`. The resulting `DocumentNode` / `GraphQLSchema` is the basis for schema predicates. This avoids building a custom SDL parser.

## Phase 1: Package Structure

```
src/graphql/
├── index.ts               # Public API: schema(), resolvers()
├── schema-loader.ts       # Parse .graphql files via graphql package
├── schema-builder.ts      # SchemaRuleBuilder — fluent chain for schema rules
├── resolver-builder.ts    # ResolverRuleBuilder — fluent chain for resolver rules
├── schema-predicates.ts   # queries(), mutations(), typesNamed(), returnListOf()
├── schema-conditions.ts   # haveFields(), acceptArgs(), haveMatchingResolver()
└── resolver-predicates.ts # resolveFieldReturning()
```

## Phase 2: Schema Loader

### `src/graphql/schema-loader.ts`

Load and parse `.graphql` files from glob patterns. Returns a merged `GraphQLSchema` plus per-file source maps for violation reporting.

```typescript
import { buildSchema, parse, Source } from 'graphql'
import type { DocumentNode } from 'graphql'
import type { ArchProject } from '../core/project.js'

export interface LoadedSchema {
  schema: GraphQLSchema
  documents: Array<{ filePath: string; document: DocumentNode }>
}

export function loadSchema(project: ArchProject, glob: string): LoadedSchema {
  // 1. Resolve glob against project root
  // 2. Read each .graphql file
  // 3. Parse into DocumentNode (preserving source location)
  // 4. Merge into single GraphQLSchema via buildSchema(concatenated SDL)
  // 5. Return schema + per-file documents for location tracking
}
```

**Key detail:** Source locations from `graphql`'s parser map back to file + line for violation code frames.

## Phase 3: Entry Points

### `schema(project, glob)`

Returns a `SchemaRuleBuilder` scoped to the types/fields in the matched `.graphql` files.

```typescript
import type { ArchProject } from '../core/project.js'

export function schema(project: ArchProject, glob: string): SchemaRuleBuilder {
  const loaded = loadSchema(project, glob)
  return new SchemaRuleBuilder(loaded)
}
```

### `resolvers(project, glob)`

Returns a `ResolverRuleBuilder` scoped to TypeScript files that implement resolvers. Resolver files are regular TypeScript — loaded via ts-morph (ADR-002), not the `graphql` package.

```typescript
export function resolvers(project: ArchProject, glob: string): ResolverRuleBuilder {
  const files = project.getSourceFiles(glob)
  return new ResolverRuleBuilder(files)
}
```

## Phase 4: Schema Predicates

Predicates filter which schema elements a rule applies to.

| Predicate            | Selects                                      |
| -------------------- | -------------------------------------------- |
| `queries()`          | Fields on the `Query` root type              |
| `mutations()`        | Fields on the `Mutation` root type           |
| `typesNamed(regex)`  | Object types matching the name pattern       |
| `returnListOf(type)` | Fields whose return type is a list of `type` |

The builder chain: `schema(p, glob).queries().should()...` or `schema(p, glob).typesNamed(/Collection$/).should()...`.

## Phase 5: Schema Conditions

Conditions assert structural properties of the filtered schema elements.

| Condition                | Asserts                                                 |
| ------------------------ | ------------------------------------------------------- |
| `haveFields(...names)`   | Type has all listed fields                              |
| `acceptArgs(...names)`   | Field accepts all listed arguments                      |
| `haveMatchingResolver()` | Cross-references resolver files — a resolver must exist |

### `haveMatchingResolver()` — cross-reference

This condition takes the `resolvers()` glob as a parameter (or is passed the resolver builder). It checks that for each schema field, a corresponding resolver export exists. This is the only condition that bridges schema and resolver worlds.

## Phase 6: Resolver Predicates and Conditions

Resolver predicates filter TypeScript resolver functions. Resolver conditions reuse body analysis.

| Predicate                      | Selects                                                |
| ------------------------------ | ------------------------------------------------------ |
| `resolveFieldReturning(regex)` | Resolver functions for fields returning matching types |

Conditions reuse the existing body analysis engine from plan 0011:

```typescript
// These are the same matchers used by classes() and functions()
import { call, newExpr, access } from '../helpers/matchers.js'

resolvers(p, 'src/resolvers/**')
  .that()
  .resolveFieldReturning(/^[A-Z]/)
  .should()
  .contain(call('loader.load')) // reuses body analysis
  .check()
```

No new condition types needed — `contain()`, `notContain()`, `useInsteadOf()` all work as-is because resolvers are regular TypeScript functions analyzed by ts-morph.

## Phase 7: Tests

### Fixtures

```
tests/fixtures/graphql/
├── tsconfig.json
├── schema/
│   ├── types.graphql          # UserCollection, PostCollection, User, Post
│   ├── queries.graphql        # Query type with list and single-object fields
│   └── mutations.graphql      # Mutation type
└── resolvers/
    ├── user.resolver.ts       # Uses DataLoader for relations
    ├── post.resolver.ts       # Missing DataLoader (intentional violation)
    └── query.resolver.ts      # Top-level query implementations
```

### Test inventory

| Area                | Tests                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| Schema loader       | 4 — parse single file, merge multiple, invalid SDL error, empty            |
| Schema predicates   | 6 — queries(), mutations(), typesNamed() match/miss, returnListOf()        |
| Schema conditions   | 6 — haveFields() pass/fail, acceptArgs() pass/fail, haveMatchingResolver() |
| Resolver predicates | 4 — resolveFieldReturning() match/miss                                     |
| Resolver conditions | 4 — contain(call()) pass/fail, reuse body analysis engine                  |

## Phase 8: Package.json & Build

Add the sub-path export and optional peer dependency:

```json
{
  "exports": {
    "./graphql": {
      "types": "./dist/graphql/index.d.ts",
      "import": "./dist/graphql/index.js"
    }
  },
  "peerDependencies": {
    "graphql": "^16.0.0"
  },
  "peerDependenciesMeta": {
    "graphql": { "optional": true }
  }
}
```

Add `graphql` as a devDependency for tests. The `graphql` package is NOT added to `dependencies` — it remains the user's responsibility.

## Files Changed

| File                                   | Change                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| `src/graphql/index.ts`                 | New — public API: schema(), resolvers()                    |
| `src/graphql/schema-loader.ts`         | New — parse .graphql files                                 |
| `src/graphql/schema-builder.ts`        | New — SchemaRuleBuilder fluent chain                       |
| `src/graphql/resolver-builder.ts`      | New — ResolverRuleBuilder fluent chain                     |
| `src/graphql/schema-predicates.ts`     | New — queries(), mutations(), typesNamed(), returnListOf() |
| `src/graphql/schema-conditions.ts`     | New — haveFields(), acceptArgs(), haveMatchingResolver()   |
| `src/graphql/resolver-predicates.ts`   | New — resolveFieldReturning()                              |
| `package.json`                         | Modified — add ./graphql export, peer dep                  |
| `tests/fixtures/graphql/`              | New — schema + resolver fixtures                           |
| `tests/graphql/schema-loader.test.ts`  | New                                                        |
| `tests/graphql/schema-rules.test.ts`   | New                                                        |
| `tests/graphql/resolver-rules.test.ts` | New                                                        |

## Out of Scope

- **Programmatic SDL (code-first)** — only `.graphql` file parsing. Code-first schemas (TypeGraphQL, Nexus) generate SDL that can be written to a file and then analyzed.
- **Subscription type** — only Query and Mutation root types get dedicated predicates. Subscriptions can be targeted via `typesNamed('Subscription')`.
- **Directive validation** — no predicates for custom directives. Can be added later.
- **Cross-file type resolution** — schema types are merged into one `GraphQLSchema`; no per-file type isolation.
- **Auto-detecting resolver convention** — the user provides the resolver glob explicitly. No magic detection of NestJS/Apollo/Mercurius resolver patterns.
