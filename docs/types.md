# Type Rules

The `types()` entry point operates on interfaces and type aliases. Use it to enforce type-level conventions using the TypeScript type checker.

## When to Use

- Enforce that certain properties use typed unions, not bare `string`
- Check that API response types have required fields
- Verify that options types follow team conventions
- Distinguish between interfaces and type aliases

## Basic Usage

A type rule selects interfaces or type aliases with predicates, then asserts a condition. This example enforces that any `Options` type with an `orderBy` property uses a typed union instead of a bare `string`, preventing SQL injection and typo bugs.

```typescript
import { project, types, not, isString } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

types(p)
  .that()
  .haveNameMatching(/Options$/)
  .and()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', not(isString()))
  .check()
```

## Type Resolution

ts-archunit uses the TypeScript type checker to resolve types. This means:

- **Aliases are resolved** -- `type OrderBy = string` is recognized as `string`
- **Generics are resolved** -- `Partial<Order>` properties have their resolved types
- **Utility types work** -- `Pick<Order, 'id' | 'name'>` resolves to the picked properties
- **Non-nullable is available** -- `getNonNullableType` strips `null | undefined` for matching

## Available Predicates

Predicates narrow which interfaces and type aliases a rule applies to. Use `areInterfaces` or `areTypeAliases` to distinguish between the two, and property predicates to filter by shape. All identity predicates (`haveNameMatching`, `resideInFolder`, `areExported`, etc.) work on types. In addition:

| Predicate                   | Description                              | Example                                      |
| --------------------------- | ---------------------------------------- | -------------------------------------------- |
| `areInterfaces`             | Type is an interface declaration         | `.that().areInterfaces()`                    |
| `areTypeAliases`            | Type is a type alias                     | `.that().areTypeAliases()`                   |
| `haveProperty(name)`        | Type has a property with the given name  | `.that().haveProperty('orderBy')`            |
| `havePropertyOfType(n, re)` | Property exists with type matching regex | `.that().havePropertyOfType('id', /string/)` |
| `extendType(name)`          | Interface extends the named type         | `.that().extendType('BaseEntity')`           |

## Available Conditions

Conditions define what matched types must satisfy. They cover property existence, naming patterns, immutability, and type-level assertions via `havePropertyType()` combined with type matchers.

| Condition                          | Description                            | Example                                                  |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------- |
| `havePropertyType(name, matcher)`  | Property must match the type matcher   | `.should().havePropertyType('orderBy', not(isString()))` |
| `notExist()`                       | No types should match the predicates   | `.should().notExist()`                                   |
| `beExported()`                     | Type must be exported                  | `.should().beExported()`                                 |
| `havePropertyNamed(...names)`      | All named properties must exist        | `.should().havePropertyNamed('version')`                 |
| `notHavePropertyNamed(...names)`   | None of the named properties may exist | `.should().notHavePropertyNamed('offset')`               |
| `havePropertyMatching(pattern)`    | At least one property matches regex    | `.should().havePropertyMatching(/^id$/)`                 |
| `notHavePropertyMatching(pattern)` | No property matches regex              | `.should().notHavePropertyMatching(/^data$/)`            |
| `haveOnlyReadonlyProperties()`     | All properties must be readonly        | `.should().haveOnlyReadonlyProperties()`                 |
| `maxProperties(n)`                 | Property count must not exceed n       | `.should().maxProperties(15)`                            |

## Type Matchers

Type matchers are composable predicates that assert on resolved TypeScript types. Pass them to `havePropertyType()` to check what a property's type resolves to after alias expansion and generic instantiation. Combine matchers with `not()` and `arrayOf()` to express complex constraints without custom code.

| Matcher               | Description                            | Example               |
| --------------------- | -------------------------------------- | --------------------- |
| `isString()`          | Type is `string`                       | `isString()`          |
| `isNumber()`          | Type is `number`                       | `isNumber()`          |
| `isBoolean()`         | Type is `boolean`                      | `isBoolean()`         |
| `isUnionOfLiterals()` | Type is a union of literal types       | `isUnionOfLiterals()` |
| `isStringLiteral()`   | Type is a string literal               | `isStringLiteral()`   |
| `arrayOf(matcher)`    | Type is an array whose element matches | `arrayOf(isString())` |
| `matching(re)`        | Type text matches a regex              | `matching(/^Order/)`  |
| `exactly(text)`       | Type text matches exactly              | `exactly('number')`   |
| `not(matcher)`        | Negates a type matcher                 | `not(isString())`     |

## Real-World Examples

### Query Options Must Use Typed Unions

```typescript
types(p)
  .that()
  .haveNameMatching(/Options$/)
  .and()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', not(isString()))
  .rule({
    id: 'type/no-bare-string-orderby',
    because: 'Bare string orderBy passed to .orderBy() is a SQL injection surface',
    suggestion: "Use a union type: orderBy?: 'created_at' | 'updated_at' | 'name'",
  })
  .check()
```

### API Response Types Must Use Typed Unions for Status

```typescript
types(p)
  .that()
  .haveNameMatching(/Response$/)
  .and()
  .haveProperty('status')
  .should()
  .havePropertyType('status', isUnionOfLiterals())
  .because('status should be a discriminated union, not a bare string')
  .check()
```

### Entity IDs Should Not Be Bare String

```typescript
types(p)
  .that()
  .haveNameMatching(/Entity$/)
  .and()
  .haveProperty('id')
  .should()
  .havePropertyType('id', not(isString()))
  .because('use branded types or numeric IDs to prevent mixing entity IDs')
  .check()
```

### All Exported Types Must Be Exported

```typescript
types(p)
  .that()
  .resideInFolder('**/api/**')
  .should()
  .beExported()
  .because('API types must be importable by consumers')
  .check()
```

### Only Interfaces in Domain Layer

```typescript
types(p)
  .that()
  .resideInFolder('**/domain/**')
  .and()
  .areTypeAliases()
  .should()
  .notExist()
  .because('domain layer uses interfaces for extensibility')
  .check()
```

## Property Conditions

Property conditions let you assert on the properties of interfaces, type aliases, and classes without writing custom `defineCondition` boilerplate.

### `havePropertyNamed(...names)`

Assert that ALL named properties exist. Violation per missing name.

```typescript
import { project, types } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

types(p)
  .that()
  .haveNameMatching(/Config$/)
  .should()
  .havePropertyNamed('version', 'name')
  .because('all config types must declare version and name')
  .check()
```

### `notHavePropertyNamed(...names)`

Assert that NONE of the named properties exist. Violation per forbidden name found.

```typescript
types(p)
  .that()
  .resideInFolder('**/api/**')
  .should()
  .notHavePropertyNamed('offset', 'pageSize', 'page', 'size')
  .because('use skip/limit for pagination')
  .check()
```

### `havePropertyMatching(pattern)`

Assert at least one property name matches the regex.

```typescript
types(p)
  .that()
  .haveNameMatching(/Entity$/)
  .should()
  .havePropertyMatching(/^id$/)
  .because('all entities must have an id field')
  .check()
```

### `notHavePropertyMatching(pattern)`

Assert no property name matches the regex.

```typescript
types(p)
  .should()
  .notHavePropertyMatching(/^(data|info|stuff|item)$/)
  .because('vague property names reduce code clarity')
  .check()
```

### `haveOnlyReadonlyProperties()`

Assert all properties are readonly -- enforces immutability.

```typescript
types(p)
  .that()
  .resideInFolder('**/state/**')
  .should()
  .haveOnlyReadonlyProperties()
  .because('state objects must be immutable')
  .check()
```

### `maxProperties(n)`

Assert property count does not exceed the maximum -- detects god objects.

```typescript
types(p)
  .should()
  .maxProperties(15)
  .because('large interfaces indicate a missing abstraction')
  .check()
```
