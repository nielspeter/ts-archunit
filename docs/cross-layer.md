# Cross-Layer Validation

The `crossLayer()` entry point checks consistency between layers of your application. Use it to verify that every route has a matching schema, every schema has a matching SDK method, or any other pairwise relationship between file groups.

## What It Solves

In a typical backend project, related concepts are spread across multiple layers:

- `src/routes/user-route.ts` defines the HTTP endpoint
- `src/schemas/user-schema.ts` defines the request/response schema
- `src/sdk/user-client.ts` exposes the typed client method

When someone adds a new route but forgets the schema, the API documentation silently falls out of sync. Cross-layer validation catches this drift automatically.

## Basic Usage

```typescript
import { project, crossLayer, haveMatchingCounterpart } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

const layers = crossLayer(p).layer('routes', 'src/routes/**').layer('schemas', 'src/schemas/**')

const resolved = layers.mapping(
  (a, b) => a.getBaseName().replace('-route.ts', '') === b.getBaseName().replace('-schema.ts', ''),
)

resolved
  .forEachPair()
  .should(haveMatchingCounterpart(/* pass resolved layers */))
  .because('every route must have a matching schema')
  .check()
```

## Builder Chain

The cross-layer builder uses a sequential chain different from the standard `.that().should()` grammar:

```
crossLayer(p)
  .layer(name, glob)      // define a layer (at least 2 required)
  .layer(name, glob)
  .mapping(fn)            // how to pair elements across layers
  .forEachPair()          // iterate matched pairs
  .should(condition)      // attach a pair condition
  .check()                // terminal: throw on violations
```

### `.layer(name, glob)`

Define a named layer by glob pattern. Call at least twice before `.mapping()`. Each layer resolves to the source files matching its glob.

```typescript
crossLayer(p)
  .layer('routes', 'src/routes/**')
  .layer('schemas', 'src/schemas/**')
  .layer('sdk', 'src/sdk/**')
```

### `.mapping(fn)`

Provide a function that determines whether two files form a pair. The function receives one `SourceFile` from each layer and returns `true` if they should be matched.

```typescript
.mapping((a, b) =>
  a.getBaseName().replace('-route.ts', '') ===
  b.getBaseName().replace('-schema.ts', '')
)
```

For 3+ layers, pairs are computed between consecutive layers: `routes <-> schemas`, `schemas <-> sdk`.

### `.forEachPair()`

Returns a builder for attaching conditions to the matched pairs.

### `.should(condition)`

Attach a `PairCondition` to evaluate against each matched pair. Returns a terminal builder supporting `.because()`, `.rule()`, `.check()`, and `.warn()`.

## Built-In Pair Conditions

### `haveMatchingCounterpart(layers)`

Every element in the left layer must have at least one match in the right layer. Produces a violation for each unmatched left-layer file.

```typescript
import { haveMatchingCounterpart } from '@nielspeter/ts-archunit'

// layers must be the resolved Layer[] — typically from the builder internals
resolved.forEachPair().should(haveMatchingCounterpart(layers)).check()
```

When a route file has no matching schema:

```
Architecture Violation [cross-layer]

  File "billing-route.ts" in layer "routes" has no matching counterpart in layer "schemas"
```

### `haveConsistentExports(extractLeft, extractRight)`

Every exported symbol name from the left file must appear in the right file. You provide two extractor functions that pull symbol names from each side.

```typescript
import { haveConsistentExports } from '@nielspeter/ts-archunit'

resolved
  .forEachPair()
  .should(
    haveConsistentExports(
      (file) => file.getExportedDeclarations().keys().toArray(),
      (file) => file.getExportedDeclarations().keys().toArray(),
    ),
  )
  .because('layers must export matching symbol names')
  .check()
```

### `satisfyPairCondition(description, fn)`

Write a fully custom pair condition inline. The function receives a `LayerPair` and returns an `ArchViolation` or `null`.

```typescript
import { satisfyPairCondition } from '@nielspeter/ts-archunit'

resolved
  .forEachPair()
  .should(
    satisfyPairCondition('have matching HTTP method exports', (pair) => {
      const routeText = pair.left.getText()
      const schemaText = pair.right.getText()
      const routeMethods = routeText.match(/\.(get|post|put|delete)\(/g) ?? []
      const schemaMethods = schemaText.match(/export.*Schema/g) ?? []

      if (routeMethods.length !== schemaMethods.length) {
        return {
          rule: 'cross-layer method count',
          element: pair.left.getBaseName(),
          file: pair.left.getFilePath(),
          line: 1,
          message: `${pair.left.getBaseName()} has ${String(routeMethods.length)} methods but ${pair.right.getBaseName()} has ${String(schemaMethods.length)} schemas`,
        }
      }
      return null
    }),
  )
  .check()
```

## Terminal Methods

| Method             | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `.because(reason)` | Attach a human-readable rationale to the rule.                |
| `.rule(metadata)`  | Attach rich metadata (`id`, `because`, `suggestion`, `docs`). |
| `.check(options?)` | Throw `ArchRuleError` if any violations are found.            |
| `.warn(options?)`  | Log violations to stderr without throwing.                    |
| `.severity(level)` | `'error'` calls `.check()`, `'warn'` calls `.warn()`.         |

Check options support `baseline`, `diff`, and `format` -- the same as all other rule builders.

## Real-World Examples

### Every Route Has a Matching OpenAPI Schema

```typescript
crossLayer(p)
  .layer('routes', 'src/routes/**')
  .layer('schemas', 'src/openapi/**')
  .mapping((route, schema) => {
    const routeName = route.getBaseName().replace('.route.ts', '')
    const schemaName = schema.getBaseName().replace('.schema.ts', '')
    return routeName === schemaName
  })
  .forEachPair()
  .should(haveMatchingCounterpart(layers))
  .rule({
    id: 'api/route-schema-sync',
    because: 'Undocumented routes cause client SDK generation failures',
    suggestion: 'Create a matching schema file in src/openapi/',
  })
  .check()
```

### Schema and SDK Client Consistency

```typescript
crossLayer(p)
  .layer('schemas', 'src/schemas/**')
  .layer('sdk', 'src/sdk/**')
  .mapping((schema, client) => {
    const name = schema.getBaseName().replace('-schema.ts', '')
    return client.getBaseName() === `${name}-client.ts`
  })
  .forEachPair()
  .should(
    haveConsistentExports(
      (file) => file.getExportedDeclarations().keys().toArray(),
      (file) => file.getExportedDeclarations().keys().toArray(),
    ),
  )
  .because('SDK clients must expose every type defined in the schema')
  .check()
```

### Three-Layer Alignment: Routes, Schemas, SDK

```typescript
crossLayer(p)
  .layer('routes', 'src/routes/**')
  .layer('schemas', 'src/schemas/**')
  .layer('sdk', 'src/sdk/**')
  .mapping((a, b) => {
    const normalize = (f: SourceFile) =>
      f
        .getBaseName()
        .replace(/-route|-schema|-client/, '')
        .replace('.ts', '')
    return normalize(a) === normalize(b)
  })
  .forEachPair()
  .should(haveMatchingCounterpart(layers))
  .because('all three layers must stay in sync')
  .check()
```
