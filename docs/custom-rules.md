# Custom Rules

ts-archunit provides `definePredicate()` and `defineCondition()` for encoding team-specific conventions that aren't covered by built-in rules.

## Why Custom Rules

Built-in predicates and conditions cover common patterns. But every team has conventions unique to their codebase:

- "Services must have a logger field"
- "Controllers must not return entity types directly"
- "All exported functions must have JSDoc"
- "No magic numbers in service methods"

Custom rules let you encode these using the same interface as built-in rules.

## `definePredicate()`

Create a custom predicate to filter elements with arbitrary logic:

```typescript
import { definePredicate, classes } from '@nielspeter/ts-archunit'
import type { ClassDeclaration } from 'ts-morph'

const hasTooManyMethods = definePredicate<ClassDeclaration>(
  'has more than 10 methods',
  (cls) => cls.getMethods().length > 10,
)

// Use with .that().satisfy()
classes(p)
  .that()
  .satisfy(hasTooManyMethods)
  .should()
  .notExist()
  .because('split large classes into focused services')
  .check()
```

### Parameterized Predicates

Create factory functions for reusable predicates:

```typescript
const hasManyMethods = (max: number) =>
  definePredicate<ClassDeclaration>(
    `has more than ${max} methods`,
    (cls) => cls.getMethods().length > max,
  )

classes(p).that().satisfy(hasManyMethods(15)).should().notExist().check()
classes(p).that().satisfy(hasManyMethods(20)).should().notExist().warn()
```

### Predicates on ArchFunction

Custom predicates work on any element type, including `ArchFunction`:

```typescript
import type { ArchFunction } from '@nielspeter/ts-archunit'

const isToplevelExport = definePredicate<ArchFunction>('is a top-level export', (fn) =>
  fn.isExported(),
)

functions(p)
  .that()
  .satisfy(isToplevelExport)
  .and()
  .resideInFolder('**/handlers/**')
  .should()
  .beAsync()
  .check()
```

## `defineCondition()`

Create a custom condition to assert with arbitrary logic. Conditions receive all matched elements and return an array of violations:

```typescript
import { defineCondition, createViolation, classes } from '@nielspeter/ts-archunit'
import type { ClassDeclaration } from 'ts-morph'
import type { ArchViolation, ConditionContext } from '@nielspeter/ts-archunit'

const haveJsDocOnPublicMethods = defineCondition<ClassDeclaration>(
  'have JSDoc on all public methods',
  (elements: ClassDeclaration[], context: ConditionContext): ArchViolation[] => {
    const violations: ArchViolation[] = []
    for (const cls of elements) {
      for (const method of cls.getMethods()) {
        const isPublic = method.getScope() === undefined || method.getScope() === 'public'
        if (isPublic && method.getJsDocs().length === 0) {
          violations.push(
            createViolation(
              method,
              `${cls.getName() ?? 'anonymous'}.${method.getName()} is public but has no JSDoc`,
              context,
            ),
          )
        }
      }
    }
    return violations
  },
)

classes(p)
  .that()
  .areExported()
  .should()
  .satisfy(haveJsDocOnPublicMethods)
  .because('public API must be documented')
  .check()
```

### `createViolation()`

The `createViolation()` helper creates an `ArchViolation` with all the context needed for rich error output (file path, line number, code frame):

```typescript
createViolation(
  node, // ts-morph Node -- used for file, line, code frame
  message, // Human-readable description of the violation
  context, // ConditionContext passed to the condition's evaluate function
)
```

## `.satisfy()`

Plug custom predicates and conditions into the fluent chain:

```typescript
// Custom predicate in .that()
classes(p).that().satisfy(hasTooManyMethods).should().notExist().check()

// Custom condition in .should()
classes(p).that().areExported().should().satisfy(haveJsDocOnPublicMethods).check()
```

## Composing with Built-in Combinators

Use `and()`, `or()`, and `not()` to compose custom predicates with built-in ones:

```typescript
import { and, or, not, extend, implement, haveDecorator } from '@nielspeter/ts-archunit'

const isService = or(extend('BaseService'), implement('IService'))
const isNotDeprecated = not(haveDecorator('Deprecated'))

classes(p).that().satisfy(and(isService, isNotDeprecated)).should().beExported().check()
```

## Real-World Examples

### Services Must Have a Logger Field

```typescript
const haveLoggerField = defineCondition<ClassDeclaration>(
  'have a logger field',
  (elements, context) => {
    const violations: ArchViolation[] = []
    for (const cls of elements) {
      const hasLogger = cls.getProperties().some((p) => p.getName() === 'logger')
      if (!hasLogger) {
        violations.push(createViolation(cls, `${cls.getName()} has no logger field`, context))
      }
    }
    return violations
  },
)

classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .satisfy(haveLoggerField)
  .because('all services must use structured logging')
  .check()
```

### No Public Fields (Use Getters/Setters)

```typescript
const noPublicFields = defineCondition<ClassDeclaration>(
  'have no public fields',
  (elements, context) => {
    const violations: ArchViolation[] = []
    for (const cls of elements) {
      for (const prop of cls.getProperties()) {
        const scope = prop.getScope()
        if (scope === undefined || scope === 'public') {
          if (prop.isStatic() && prop.isReadonly()) continue // allow constants
          violations.push(
            createViolation(
              prop,
              `${cls.getName()}.${prop.getName()} is a public field -- use private + getter/setter`,
              context,
            ),
          )
        }
      }
    }
    return violations
  },
)

classes(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(noPublicFields)
  .because('encapsulate state behind methods')
  .check()
```

### No Magic Numbers in Service Methods

```typescript
import { SyntaxKind } from 'ts-morph'

const noMagicNumbers = defineCondition<ClassDeclaration>(
  'have no magic numbers in method bodies',
  (elements, context) => {
    const violations: ArchViolation[] = []
    const allowed = new Set([0, 1, -1, 2, 10, 100])

    for (const cls of elements) {
      for (const method of cls.getMethods()) {
        const body = method.getBody()
        if (!body) continue
        for (const lit of body.getDescendantsOfKind(SyntaxKind.NumericLiteral)) {
          const value = Number(lit.getText())
          if (!allowed.has(value)) {
            violations.push(
              createViolation(
                lit,
                `${cls.getName()}.${method.getName()} contains magic number ${value}`,
                context,
              ),
            )
          }
        }
      }
    }
    return violations
  },
)

classes(p)
  .that()
  .haveNameEndingWith('Service')
  .should()
  .satisfy(noMagicNumbers)
  .because('extract constants for readability')
  .warn()
```
