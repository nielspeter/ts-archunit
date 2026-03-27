# Class Rules

The `classes()` entry point operates on class declarations. Use it for inheritance, decorators, methods, properties, and body analysis.

## When to Use

- Enforce inheritance patterns (repositories extend BaseRepository)
- Check decorators on classes and methods
- Verify naming conventions for classes
- Inspect method bodies (see [Body Analysis](/body-analysis))
- Enforce export rules

## Basic Usage

```typescript
import { project, classes } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

classes(p).that().extend('BaseRepository').should().beExported().check()
```

## Available Predicates

All identity predicates (`haveNameMatching`, `resideInFolder`, `areExported`, etc.) work on classes. In addition:

| Predicate                   | Description                           | Example                                 |
| --------------------------- | ------------------------------------- | --------------------------------------- |
| `extend(name)`              | Class extends the given base class    | `.that().extend('BaseRepository')`      |
| `implement(name)`           | Class implements the given interface  | `.that().implement('Serializable')`     |
| `haveDecorator(name)`       | Class has the given decorator         | `.that().haveDecorator('Injectable')`   |
| `haveDecoratorMatching(re)` | Class has a decorator matching regex  | `.that().haveDecoratorMatching(/^Api/)` |
| `areAbstract`               | Class is abstract                     | `.that().areAbstract()`                 |
| `haveMethodNamed(name)`     | Class has a method with the name      | `.that().haveMethodNamed('execute')`    |
| `haveMethodMatching(re)`    | Class has a method matching the regex | `.that().haveMethodMatching(/^handle/)` |
| `havePropertyNamed(name)`   | Class has a property with the name    | `.that().havePropertyNamed('logger')`   |

## Available Conditions

### Structural Conditions

| Condition                       | Description                            |
| ------------------------------- | -------------------------------------- |
| `beExported()`                  | Class must be exported                 |
| `notExist()`                    | No classes should match the predicates |
| `conditionHaveNameMatching(re)` | Class name must match the regex        |

### Class-Specific Conditions

| Condition                              | Description                                | Example                                                          |
| -------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `shouldExtend(name)`                   | Class must extend the named base class     | `.should().shouldExtend('BaseRepository')`                       |
| `shouldImplement(name)`                | Class must implement the named interface   | `.should().shouldImplement('Disposable')`                        |
| `shouldHaveMethodNamed(name)`          | Class must have a method with the name     | `.should().shouldHaveMethodNamed('dispose')`                     |
| `shouldNotHaveMethodMatching(re)`      | Class must not have methods matching regex | `.should().shouldNotHaveMethodMatching(/^_/)`                    |
| `shouldHavePropertyNamed(...names)`    | All named properties must exist            | `.should().shouldHavePropertyNamed('logger')`                    |
| `shouldNotHavePropertyNamed(...names)` | None of the named properties may exist     | `.should().shouldNotHavePropertyNamed('offset')`                 |
| `havePropertyMatching(pattern)`        | At least one property matches regex        | `.should().havePropertyMatching(/^id$/)`                         |
| `notHavePropertyMatching(pattern)`     | No property matches regex                  | `.should().notHavePropertyMatching(/^data$/)`                    |
| `haveOnlyReadonlyProperties()`         | All properties must be readonly            | `.should().haveOnlyReadonlyProperties()`                         |
| `maxProperties(n)`                     | Property count must not exceed n           | `.should().maxProperties(10)`                                    |
| `acceptParameterOfType(matcher)`       | At least one parameter matches TypeMatcher | `.should().acceptParameterOfType(matching(/DatabaseClient/))`    |
| `notAcceptParameterOfType(matcher)`    | No parameter matches TypeMatcher           | `.should().notAcceptParameterOfType(matching(/DatabaseClient/))` |

### Body Analysis Conditions

| Condition                           | Description                                   |
| ----------------------------------- | --------------------------------------------- |
| `contain(matcher)`                  | Class methods must contain the expression     |
| `notContain(matcher)`               | Class methods must not contain the expression |
| `useInsteadOf(banned, replacement)` | Replace banned expression with an alternative |

See [Body Analysis](/body-analysis) for full details on matchers and conditions.

## Real-World Examples

### Repositories Must Extend BaseRepository

```typescript
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .and()
  .resideInFolder('**/repositories/**')
  .should()
  .shouldExtend('BaseRepository')
  .rule({
    id: 'repo/extend-base',
    because: 'BaseRepository provides transaction support and shared query helpers',
    suggestion: 'Add `extends BaseRepository` to the class declaration',
  })
  .check()
```

### Controllers Must End with Controller

```typescript
classes(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .conditionHaveNameMatching(/Controller$/)
  .rule({
    id: 'naming/controller-suffix',
    because: 'Consistent naming makes the codebase navigable',
  })
  .check()
```

### No `any`-Typed Properties

```typescript
import { noAnyProperties } from '@nielspeter/ts-archunit/rules/typescript'

classes(p)
  .that()
  .areExported()
  .should()
  .satisfy(noAnyProperties())
  .because('any bypasses the type checker')
  .check()
```

### No Type Assertions in Services

```typescript
import { noTypeAssertions } from '@nielspeter/ts-archunit/rules/typescript'

classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .satisfy(noTypeAssertions())
  .because('use type guards instead of as casts')
  .check()
```

### Services Must Use Typed Errors

```typescript
classes(p)
  .that()
  .extend('BaseService')
  .should()
  .notContain(newExpr('Error'))
  .rule({
    id: 'error/typed-errors',
    because: 'Generic Error loses context and prevents consistent API error responses',
    suggestion: 'Use NotFoundError, ValidationError, or DomainError instead',
  })
  .check()
```

### Domain Entities Must Be Exported

```typescript
classes(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .beExported()
  .because('domain entities are used by application layer')
  .check()
```

### Named Selections for Reuse

```typescript
const repositories = classes(p).that().extend('BaseRepository')

repositories.should().notContain(call('parseInt')).check()
repositories.should().notContain(newExpr('Error')).check()
repositories.should().beExported().check()
```

## Property Conditions

Property conditions assert on the properties of class declarations. The `should` prefix is used on `shouldHavePropertyNamed` and `shouldNotHavePropertyNamed` to avoid collision with the `havePropertyNamed` predicate.

### Forbidden Properties on Classes

```typescript
import { project, classes } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .shouldNotHavePropertyNamed('offset', 'pageSize')
  .because('services should not handle raw pagination parameters')
  .check()
```

### Immutable Value Objects

```typescript
classes(p)
  .that()
  .resideInFolder('**/domain/values/**')
  .should()
  .haveOnlyReadonlyProperties()
  .because('value objects must be immutable')
  .check()
```

### Property Count Limits

```typescript
classes(p)
  .should()
  .maxProperties(10)
  .because('classes with many properties indicate a missing abstraction')
  .check()
```

## Parameter Type Conditions

Parameter type conditions scan constructor parameters, method parameters, and setter parameters to enforce DI boundaries. They compose with the existing `TypeMatcher` system.

### Services Must Not Accept Database Client

```typescript
import { project, classes, matching } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .notAcceptParameterOfType(matching(/Knex/))
  .rule({
    id: 'di/no-direct-db-in-services',
    because: 'Services should depend on repositories, not database clients',
    suggestion: 'Inject a repository instead of Knex',
  })
  .check()
```

### Repositories Must Accept Database Client

```typescript
classes(p)
  .that()
  .haveNameEndingWith('Repository')
  .should()
  .acceptParameterOfType(matching(/DatabaseClient/))
  .because('repositories are the database access layer')
  .check()
```

## Standard Rules

Pre-built class conditions from sub-path imports:

```typescript
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from '@nielspeter/ts-archunit/rules/typescript'
import {
  noEval,
  noFunctionConstructor,
  noConsoleLog,
  noProcessEnv,
} from '@nielspeter/ts-archunit/rules/security'
import { noGenericErrors, noTypeErrors } from '@nielspeter/ts-archunit/rules/errors'
import { mustMatchName } from '@nielspeter/ts-archunit/rules/naming'

classes(p).should().satisfy(noEval()).check()
classes(p).should().satisfy(noGenericErrors()).check()
classes(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .satisfy(mustMatchName(/Controller$/))
  .check()
```
