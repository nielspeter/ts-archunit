# GraphQL Rules

Enforce consistency across your GraphQL schema and resolvers. Shipped as a separate entry point with an optional peer dependency on the `graphql` package.

```bash
npm install -D graphql  # required for ts-archunit/graphql
```

```typescript
import { schema, schemaFromSDL, resolvers } from '@nielspeter/ts-archunit/graphql'
```

## Schema Rules

Schema rules let you enforce structural conventions on your GraphQL types, queries, and mutations -- for example, requiring that all collection types carry pagination fields, or that every query field has a matching resolver. You start by loading your schema from `.graphql` files or inline SDL, then chain predicates and conditions just like any other ts-archunit rule.

### Load from files

Use `schema()` to load `.graphql` files from disk via a glob pattern. This is the typical approach when your schema is split across multiple files in the repository.

```typescript
import { schema } from '@nielspeter/ts-archunit/graphql'
import { project } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')
const s = schema(p, 'src/graphql/**/*.graphql')
```

### Load from inline SDL

Use `schemaFromSDL()` when you want to test against a schema defined directly in your test file. This is useful for unit-testing pattern templates or for projects that build their schema programmatically rather than from `.graphql` files.

```typescript
import { schemaFromSDL } from '@nielspeter/ts-archunit/graphql'

const s = schemaFromSDL(`
  type User {
    id: ID!
    name: String!
    email: String!
  }

  type UserCollection {
    items: [User!]!
    total: Int!
    skip: Int!
    limit: Int!
  }

  type Query {
    users: UserCollection!
    user(id: ID!): User
  }
`)
```

### Schema predicates

Predicates narrow the schema elements your rule targets. Use them to select specific categories -- all Query fields, all Mutation fields, types matching a name pattern, or fields that return lists. Without predicates, the rule applies to every element in the schema.

```typescript
// Select all Query fields
s.that().queries()

// Select all Mutation fields
s.that().mutations()

// Select types by name pattern
s.that().typesNamed(/Collection$/)

// Select fields that return a list
s.that().returnListOf()
```

### Schema conditions

Conditions define the assertions enforced on schema elements that pass the predicate filter. They let you require specific fields on types, mandate pagination arguments on list queries, or verify that every query field has a corresponding resolver implementation.

```typescript
// Collection types must have pagination fields
s.that()
  .typesNamed(/Collection$/)
  .should()
  .haveFields('items', 'total', 'skip', 'limit')
  .because('all collections use standard pagination envelope')
  .check()

// List queries must accept pagination arguments
s.that()
  .queries()
  .and()
  .returnListOf()
  .should()
  .acceptArgs('skip', 'limit')
  .because('list endpoints must support pagination')
  .check()

// Every Query field must have a matching resolver
s.that()
  .queries()
  .should()
  .haveMatchingResolver('src/resolvers/**')
  .because('unresolved query fields return null at runtime')
  .check()
```

## Resolver Rules

Resolver rules let you enforce patterns inside your GraphQL resolver functions -- for example, requiring DataLoader usage for relation fields or banning direct database calls. They use the same body analysis engine as `classes()` and `functions()`, so you get access to `call()`, `access()`, `newExpr()`, and all other expression matchers.

```typescript
import { resolvers } from '@nielspeter/ts-archunit/graphql'
import { call } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')
const r = resolvers(p, 'src/resolvers/**')
```

### Resolver predicates

```typescript
// Select resolvers for fields that return object types
r.that().resolveFieldReturning(/^[A-Z]/)
```

### Resolver conditions

Resolver conditions reuse `call()`, `newExpr()`, `access()` from the body analysis engine:

```typescript
// Resolvers for relation fields must use DataLoader
r.that()
  .resolveFieldReturning(/^[A-Z]/)
  .should()
  .contain(call('loader.load'))
  .because('prevent N+1 queries')
  .check()

// Resolvers must not call database directly
r.should().notContain(call('db.query')).because('resolvers delegate to services').check()
```

## Real-World Examples

### Consistent pagination

```typescript
const s = schema(p, 'src/graphql/**/*.graphql')

// All collection types must have the standard envelope
s.that()
  .typesNamed(/Collection$/)
  .should()
  .haveFields('items', 'total', 'skip', 'limit')
  .check()

// All list queries must accept pagination args
s.that().queries().and().returnListOf().should().acceptArgs('skip', 'limit').check()
```

### DataLoader enforcement

```typescript
const r = resolvers(p, 'src/resolvers/**')

// Relation resolvers must use DataLoader to prevent N+1
r.that()
  .resolveFieldReturning(/^[A-Z]/)
  .should()
  .contain(call('loader.load'))
  .rule({
    id: 'graphql/use-dataloader',
    because: 'Direct DB calls in resolvers cause N+1 query problems',
    suggestion: 'Inject a DataLoader and call loader.load(id) instead',
  })
  .check()
```

### Schema-resolver sync

```typescript
// Every query field must have a resolver implementation
s.that()
  .queries()
  .should()
  .haveMatchingResolver('src/resolvers/**')
  .rule({
    id: 'graphql/resolver-coverage',
    because: 'Unresolved query fields return null at runtime with no error',
  })
  .check()
```

## Requirements

- `graphql` package installed as a peer dependency (`npm install -D graphql`)
- `.graphql` schema files or inline SDL strings
- Resolver files as standard TypeScript (analyzed via ts-morph)

The `graphql` package is optional — ts-archunit core works without it. Only install it if you use `ts-archunit/graphql`.
