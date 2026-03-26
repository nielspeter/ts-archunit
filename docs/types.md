# Type Rules

The `types()` entry point operates on interfaces and type aliases. Use it to enforce type-level conventions using the TypeScript type checker.

## When to Use

- Enforce that certain properties use typed unions, not bare `string`
- Check that API response types have required fields
- Verify that options types follow team conventions
- Distinguish between interfaces and type aliases

## Basic Usage

```typescript
import { project, types, notType, isString } from 'ts-archunit'

const p = project('tsconfig.json')

types(p)
  .that()
  .haveNameMatching(/Options$/)
  .and()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', notType(isString()))
  .check()
```

## Type Resolution

ts-archunit uses the TypeScript type checker to resolve types. This means:

- **Aliases are resolved** -- `type OrderBy = string` is recognized as `string`
- **Generics are resolved** -- `Partial<Order>` properties have their resolved types
- **Utility types work** -- `Pick<Order, 'id' | 'name'>` resolves to the picked properties
- **Non-nullable is available** -- `getNonNullableType` strips `null | undefined` for matching

## Available Predicates

All identity predicates (`haveNameMatching`, `resideInFolder`, `areExported`, etc.) work on types. In addition:

| Predicate                   | Description                              | Example                                      |
| --------------------------- | ---------------------------------------- | -------------------------------------------- |
| `areInterfaces`             | Type is an interface declaration         | `.that().areInterfaces()`                    |
| `areTypeAliases`            | Type is a type alias                     | `.that().areTypeAliases()`                   |
| `haveProperty(name)`        | Type has a property with the given name  | `.that().haveProperty('orderBy')`            |
| `havePropertyOfType(n, re)` | Property exists with type matching regex | `.that().havePropertyOfType('id', /string/)` |
| `extendType(name)`          | Interface extends the named type         | `.that().extendType('BaseEntity')`           |

## Available Conditions

| Condition                         | Description                          | Example                                                      |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `havePropertyType(name, matcher)` | Property must match the type matcher | `.should().havePropertyType('orderBy', notType(isString()))` |
| `notExist()`                      | No types should match the predicates | `.should().notExist()`                                       |
| `beExported()`                    | Type must be exported                | `.should().beExported()`                                     |

## Type Matchers

Type matchers are used with `havePropertyType()` to assert on resolved TypeScript types:

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
| `notType(matcher)`    | Negates a type matcher                 | `notType(isString())` |

## Real-World Examples

### Query Options Must Use Typed Unions

```typescript
types(p)
  .that()
  .haveNameMatching(/Options$/)
  .and()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', notType(isString()))
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
  .havePropertyType('id', notType(isString()))
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
