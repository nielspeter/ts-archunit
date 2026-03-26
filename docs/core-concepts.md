# Core Concepts

## Before and After

Without ts-archunit, enforcing architecture means manual AST traversal with ts-morph:

```typescript
// WITHOUT ts-archunit: 12 lines of manual AST traversal
import { Project, SyntaxKind } from 'ts-morph'

const project = new Project({ tsConfigFilePath: 'tsconfig.json' })
const classes = project
  .getSourceFiles()
  .flatMap((sf) => sf.getClasses())
  .filter((cls) => cls.getExtends()?.getExpression().getText() === 'BaseService')
for (const cls of classes) {
  for (const method of cls.getMethods()) {
    const calls = method.getDescendantsOfKind(SyntaxKind.CallExpression)
    if (calls.some((c) => c.getExpression().getText() === 'parseInt')) {
      throw new Error(`${cls.getName()} calls parseInt`)
    }
  }
}
```

With ts-archunit, the same rule is one fluent chain:

```typescript
// WITH ts-archunit: 1 chain
classes(p).that().extend('BaseService').should().notContain(call('parseInt')).check()
```

The chain handles filtering, AST traversal, violation collection, code frame generation, and error formatting. You focus on _what_ to enforce, not _how_ to traverse the AST.

## Project

Everything starts with loading a TypeScript project:

```typescript
import { project } from 'ts-archunit'

const p = project('tsconfig.json')
```

The project is loaded once using [ts-morph](https://ts-morph.com/) and cached per path. Subsequent calls to `project('tsconfig.json')` return the same instance. This means multiple rules in the same test file share the same loaded project -- no duplicate parsing.

## Entry Points

Each entry point creates a rule builder for a specific kind of element:

| Entry Point    | Operates On                         | Use Case                                        |
| -------------- | ----------------------------------- | ----------------------------------------------- |
| `modules(p)`   | Source files                        | Import/dependency rules                         |
| `classes(p)`   | Class declarations                  | Inheritance, decorators, methods, body analysis |
| `functions(p)` | Functions, arrow functions, methods | Naming, parameters, body analysis               |
| `types(p)`     | Interfaces + type aliases           | Property types, type safety                     |
| `slices(p)`    | Groups of files                     | Cycles, layer ordering                          |
| `calls(p)`     | Call expressions                    | Framework-agnostic route/handler matching       |
| `within(sel)`  | Scoped callbacks                    | Rules inside matched call callbacks             |

## The Chain

Every rule follows the same pattern:

```
entryPoint(p).that().<predicates>.should().<conditions>.check()
```

Here's how each part works:

1. **`entryPoint(p)`** -- selects what kind of element to check
2. **`.that()`** -- starts the predicate phase (filtering)
3. **`.should()`** -- starts the condition phase (asserting)
4. **`.check()`** -- executes the rule and throws on violations

```typescript
classes(p) // 1. entry point: class declarations
  .that() // 2. start filtering
  .extend('BaseService') // 2. predicate: only classes extending BaseService
  .should() // 3. start asserting
  .notContain(call('parseInt')) // 3. condition: must not call parseInt
  .check() // 4. execute
```

## Predicates

Predicates filter which elements a rule applies to. They go between `.that()` and `.should()`.

### Identity Predicates

Available on all entry points:

| Predicate                 | Description              |
| ------------------------- | ------------------------ |
| `haveNameMatching(re)`    | Name matches a regex     |
| `haveNameStartingWith(s)` | Name starts with string  |
| `haveNameEndingWith(s)`   | Name ends with string    |
| `resideInFile(glob)`      | File path matches glob   |
| `resideInFolder(glob)`    | Folder path matches glob |
| `areExported`             | Element is exported      |
| `areNotExported`          | Element is not exported  |

### Type-Specific Predicates

Each entry point adds its own predicates. See the dedicated pages: [Classes](/classes), [Functions](/functions), [Types](/types), [Modules](/modules).

### Combining Predicates

Chain predicates with `.and()`:

```typescript
classes(p).that().extend('BaseRepository').and().resideInFolder('**/repositories/**').should()
// ...
```

Use combinators for complex logic:

```typescript
import { and, or, not } from 'ts-archunit'

const myPredicate = or(extend('BaseService'), extend('BaseRepository'))
classes(p).that().satisfy(myPredicate).should(). /* ... */
```

## Conditions

Conditions assert what must be true about the filtered elements. They go between `.should()` and `.check()`.

### Structural Conditions

| Condition              | Description                                  |
| ---------------------- | -------------------------------------------- |
| `notExist()`           | No elements should match the predicates      |
| `beExported()`         | All matched elements should be exported      |
| `haveNameMatching(re)` | All matched elements should match the regex  |
| `resideInFolder(glob)` | All matched elements should be in the folder |

### Chaining Conditions

Use `.andShould()` for multiple conditions on the same selection:

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .beExported()
  .andShould()
  .notContain(call('parseInt'))
  .check()
```

## Named Selections

Save a `.that()` chain and reuse it across rules:

```typescript
const repositories = classes(p).that().extend('BaseRepository')

// Multiple rules on the same selection
repositories.should().notContain(call('parseInt')).check()
repositories.should().notContain(newExpr('Error')).check()
repositories.should().beExported().check()
```

## `.check()` vs `.warn()`

- **`.check()`** -- throws `ArchRuleError` on violations (test fails, CI blocks)
- **`.warn()`** -- logs violations to stderr (test passes, advisory only)

```typescript
// Hard rule: blocks CI
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()

// Soft rule: advisory
classes(p).that().haveDecorator('Deprecated').should().notExist().warn()
```

## Rule Metadata

Attach context to any rule with `.rule()`:

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(call('parseInt'))
  .rule({
    id: 'repo/no-parseint',
    because: 'BaseRepository provides extractCount() which handles type coercion safely',
    suggestion: 'Replace parseInt(x, 10) with this.extractCount(result)',
    docs: 'https://example.com/adr/011',
  })
  .check()
```

All fields are optional. When present, they appear in violation output.

## Composing with Combinators

The `and()`, `or()`, and `not()` combinators work on both predicates and conditions:

```typescript
import { and, or, not, extend, implement, haveDecorator } from 'ts-archunit'

// Predicate combinators
const isService = or(extend('BaseService'), implement('IService'))
const isNotDeprecated = not(haveDecorator('Deprecated'))

classes(p).that().satisfy(and(isService, isNotDeprecated)).should().beExported().check()
```

## Baseline Mode

Adopt rules in existing codebases without fixing every pre-existing violation:

```typescript
import { withBaseline } from 'ts-archunit'

const baseline = withBaseline('arch-baseline.json')

// Only NEW violations fail -- existing ones are recorded in the baseline
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check({ baseline })
```

Generate a baseline from current violations:

```typescript
import { collectViolations, generateBaseline } from 'ts-archunit'

const violations = collectViolations(rule1, rule2, rule3)
generateBaseline(violations, 'arch-baseline.json')
```

## Diff-Aware Mode

Only report violations in files changed in the current PR:

```typescript
import { diffAware } from 'ts-archunit'

classes(p)
  .should()
  .notContain(call('eval'))
  .check({ diff: diffAware('main') })
```

## Next Steps

- [Module Rules](/modules) -- import and dependency enforcement
- [Class Rules](/classes) -- inheritance, decorators, body analysis
- [Function Rules](/functions) -- naming, parameters, async enforcement
- [Type Rules](/types) -- property types, type matchers
- [Body Analysis](/body-analysis) -- the signature feature
