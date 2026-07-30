# Custom Rules

::: warning A hand-written dependency condition sees static imports only
The built-in dependency conditions were widened in v0.28.0 to see `export … from`,
`import()` and `type X = import(…).Y` as well as static imports. A condition you write
with `defineCondition()` does **not** get that for free: if it calls
`sourceFile.getImportDeclarations()`, it reproduces the gap
([bug 0022](https://github.com/nielspeter/ts-archunit/blob/main/bugs/fixed/0022-forward-import-conditions-are-blind-to-reexports-and-dynamic-imports.md))
inside your repository, where no fix of ours reaches.

`ModuleEdge` is not exported yet — deliberately, for one release — so the interim
answer is to be aware of it rather than to work around it. If this affects you, say so
on the issue tracker; that is the signal that decides whether it ships in 0.29.
:::

ts-archunit provides `definePredicate()` and `defineCondition()` for encoding team-specific conventions that aren't covered by built-in rules.

## Why Custom Rules

Built-in predicates and conditions cover common patterns -- naming, imports, body analysis, metrics. But every team has domain-specific conventions that no library can anticipate out of the box:

- "Services must have a logger field"
- "Controllers must not return entity types directly"
- "All exported functions must have JSDoc"
- "No magic numbers in service methods"

Rather than requesting upstream features for each of these, `definePredicate()` and `defineCondition()` let you encode them yourself using the same fluent interface and violation reporting as built-in rules.

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

### Declaring a glob

If a custom predicate matches paths against a glob, **declare it**. Otherwise `doctor`
cannot see it, and a typo narrows the selection to nothing while the run stays green and
`doctor` exits 0 — the rule checks nothing and nothing says so.

```typescript
import picomatch from 'picomatch'
import { definePredicate, globNode } from '@nielspeter/ts-archunit'

const GENERATED = '**/generated/**'

const inGenerated = definePredicate<SourceFile>(
  `reside in '${GENERATED}'`,
  (file) => picomatch(GENERATED)(file.getFilePath()),
  globNode({ glob: GENERATED, kind: 'file-path' }), // <- the third argument
)
```

With the glob declared, `doctor` reports it when it can never match — and exits non-zero,
because an agent reads `exit 0` as "nothing to do":

```
  rules/arch.rules.ts
    that reside in '**/generated/**' should not import from "**/banned/**"
    reside in '**/generated/**'  [selector]
    no-match: these are anchored but matched no file. Common causes: the glob names a
    directory rather than the files inside it (append "/**"), a path segment is
    misspelled, or the directory holds no source files
```

Without the third argument that report does not exist: the rule selects nothing, passes, and
`doctor` exits 0.

`defineCondition` takes the same third argument. The difference is what happens next: a
**condition** glob that matches nothing is deliberately _not_ reported, because a denylist
glob matching nothing is indistinguishable from a ban being respected. Declaring it makes it
visible to `explain`; it does not make it a finding.

#### Choosing the `kind`

The `kind` says what the glob is really matched against, and it selects which paths are
checked for satisfiability. **A declared kind is believed**, so a wrong one costs you
something in each direction.

| `kind`          | matched against                                | note                                                                   |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `file-path`     | an **absolute** file path                      | Anchor the glob — `'**/src/**'`, not `'src/**'`, which matches nothing |
| `parent-dir`    | a file's immediate parent directory            |                                                                        |
| `import-target` | a resolved module path **or a bare specifier** | Has no path universe by design, so `'fastify'` is never reported dead  |
| `specifier`     | a string in the source, not a path             |                                                                        |
| `literal`       | a literal value in the source                  |                                                                        |

Declaring a bare specifier as `file-path` earns a **false** dead-glob report. Declaring a real
path as `import-target` silently exempts it from checking. When unsure, declare nothing — that
is exactly the behaviour you had before the argument existed.

For more than one glob, use `globAnyOf(globs, kind)`: a set is dead only when **every** glob in
it is dead, which is what `any` means.

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

#### Keep coordinates and counts out of your message

`withBaseline()` identifies a violation by its rule, element and message, so
whatever you interpolate into the message becomes part of its identity. Three
things look natural in a message and quietly break the baseline:

| In the message        | What happens                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| An absolute file path | Identity encodes the checkout directory, so the baseline never matches in CI |
| A line number         | Editing anything above the finding changes its identity                      |
| A derived count       | `"3 of 5 files ..."` changes when an unrelated sibling is added              |

Absolute paths are handled for you — they are normalised against the repository
root before hashing. Line numbers and counts are not, because they are not
paths. When your message needs one, set `identity` to a canonical form:

```typescript
violations.push({
  ...createViolation(node, `${name} logs at line ${String(node.getStartLineNumber())}`, context),
  // Identity replaces element AND message in the hash, so it must be unique
  // per finding within the rule — two findings sharing one identity are one
  // violation to the baseline, and accepting either accepts both.
  identity: `no-console::${node.getSourceFile().getFilePath()}::${name}#${String(occurrence)}`,
})
```

The rendered output is unaffected; this is identity only.

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
