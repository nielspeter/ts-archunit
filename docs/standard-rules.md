# Standard Rules

Ready-to-use rules via categorized sub-path imports. Each rule is a factory function returning a typed `Condition<T>` — plug it into `.satisfy()` after `.should()`.

Rules come in three flavors matching the entry point they target:

- **Class variants** (`noEval()`) — for `classes(p).should().satisfy(...)`
- **Function variants** (`functionNoEval()`) — for `functions(p).should().satisfy(...)`
- **Module variants** (`moduleNoEval()`) — for `modules(p).should().satisfy(...)`

Most users want function or module variants. Class variants exist for backwards compatibility and for class-specific rules like `classMustCall`.

## TypeScript (`ts-archunit/rules/typescript`)

TypeScript's type system only helps if you actually use it. These rules catch the three most common ways teams silently opt out of type safety: `any` types on class properties (defeats the entire type system for that value), `as` type assertions in method bodies (tells the compiler "trust me" instead of proving correctness), and `!` non-null assertions (ignoring possible null/undefined). ESLint can catch some of these, but ts-archunit checks them architecturally — you can scope enforcement to specific layers or class hierarchies.

```typescript
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from '@nielspeter/ts-archunit/rules/typescript'
```

| Rule                    | Target  | What it checks                                                |
| ----------------------- | ------- | ------------------------------------------------------------- |
| `noAnyProperties()`     | classes | Class properties must not be typed as `any`                   |
| `noTypeAssertions()`    | classes | Method bodies must not contain `as` casts (allows `as const`) |
| `noNonNullAssertions()` | classes | Method bodies must not contain `!` non-null assertions        |

`noTypeAssertions` allows `as const` since that narrows types rather than widening them. All three rules target class declarations — use them with `classes(p)` and scope to the layers where type safety matters most:

```typescript
classes(p)
  .that()
  .areExported()
  .should()
  .satisfy(noAnyProperties())
  .because('any bypasses the type checker')
  .check()
```

## Security (`ts-archunit/rules/security`)

The security category is the most complete — every rule has class, function, and module variants. Use function variants for standalone functions and arrow functions. Use module variants when you want to scan an entire file regardless of how code is structured.

```typescript
import {
  // Class variants (original)
  noEval,
  noFunctionConstructor,
  noProcessEnv,
  noConsoleLog,
  noConsole,
  noJsonParse,
  // Function variants — same rules, target ArchFunction
  functionNoEval,
  functionNoFunctionConstructor,
  functionNoProcessEnv,
  functionNoConsoleLog,
  functionNoConsole,
  functionNoJsonParse,
  // Module variants — scan entire file
  moduleNoEval,
  moduleNoProcessEnv,
  moduleNoConsoleLog,
} from '@nielspeter/ts-archunit/rules/security'
```

| Rule                    | Variants                | What it checks                                                     |
| ----------------------- | ----------------------- | ------------------------------------------------------------------ |
| `noEval`                | class, function, module | No `eval()` calls                                                  |
| `noFunctionConstructor` | class, function         | No `new Function()` (equivalent to eval)                           |
| `noProcessEnv`          | class, function, module | No direct `process.env` access                                     |
| `noConsoleLog`          | class, function, module | No `console.log` calls                                             |
| `noConsole`             | class, function         | No console access at all (`log`, `warn`, `error`, `debug`, `info`) |
| `noJsonParse`           | class, function         | No `JSON.parse` calls — centralize deserialization                 |

### When to use which variant

**Module variants** are the broadest — they catch violations anywhere in a file, including top-level code, class methods, and nested functions. Use when you want a blanket ban:

```typescript
// No eval anywhere in the domain layer
modules(p).that().resideInFolder('**/domain/**').should().satisfy(moduleNoEval()).check()
```

**Function variants** are more precise — they only check inside function bodies. Use when you want per-function rules or when filtering by function predicates:

```typescript
// Exported functions must not access process.env
functions(p)
  .that()
  .areExported()
  .should()
  .satisfy(functionNoProcessEnv())
  .because('use Config injection instead')
  .check()
```

**`noConsole` vs `noConsoleLog`**: `noConsoleLog` only catches `console.log`. `noConsole` catches all console methods — `console.warn`, `console.error`, `console.debug`, `console.info`, etc. Use `noConsole` when you want to enforce a logger abstraction:

```typescript
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(functionNoConsole())
  .because('use Logger.info() / Logger.error() instead')
  .check()
```

## Error Handling (`ts-archunit/rules/errors`)

```typescript
import {
  noGenericErrors,
  noTypeErrors,
  noSilentCatch,
  functionNoGenericErrors,
  functionNoTypeErrors,
  functionNoSilentCatch,
  moduleNoSilentCatch,
} from '@nielspeter/ts-archunit/rules/errors'
```

| Rule              | Variants                | What it checks                                     |
| ----------------- | ----------------------- | -------------------------------------------------- |
| `noGenericErrors` | class, function         | No `new Error()` — use typed domain errors         |
| `noTypeErrors`    | class, function         | No `new TypeError()` — usually a programming error |
| `noSilentCatch`   | class, function, module | Catch blocks must reference the caught error       |

### Typed errors

The rule matches exact constructor names. `new Error()` is caught, but `new NotFoundError()` or `new ValidationError()` pass. This is by design — the goal is to force developers to use typed errors that can be caught and handled specifically:

```typescript
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(functionNoGenericErrors())
  .rule({
    id: 'error/typed-errors',
    suggestion: 'throw new NotFoundError(...) or new ValidationError(...)',
  })
  .check()
```

### Silent catch detection

`noSilentCatch()` flags catch blocks where the caught error is never referenced — no logging, no rethrowing, no passing to another function. Silent catches are a common source of hidden production bugs:

```typescript
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(functionNoSilentCatch())
  .rule({
    id: 'error/no-silent-catch',
    because: 'Swallowed errors hide production failures',
    suggestion: 'Log the error, rethrow it, or pass it to an error handler',
  })
  .check()
```

## Architecture (`ts-archunit/rules/architecture`)

Positive body assertions — "this function MUST call something matching a pattern". The inverse of `notContain` conditions.

```typescript
import { mustCall, classMustCall } from '@nielspeter/ts-archunit/rules/architecture'
```

| Rule                     | Target    | What it checks                                         |
| ------------------------ | --------- | ------------------------------------------------------ |
| `mustCall(pattern)`      | functions | Function body must contain a call matching the regex   |
| `classMustCall(pattern)` | classes   | At least one class method must contain a matching call |

Use to enforce delegation patterns — e.g., services must call a repository, handlers must call a validator:

```typescript
// Every service function must call something with "Repository" in the name
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(mustCall(/Repository/))
  .because('services must delegate to the data layer')
  .check()

// Handler classes must call a validation function
classes(p)
  .that()
  .resideInFolder('**/handlers/**')
  .should()
  .satisfy(classMustCall(/validate/))
  .check()
```

The pattern is a plain `RegExp` — you control exactly what it matches. `mustCall(/findById/)` requires that specific method name. `mustCall(/Repository/)` is looser — any call containing "Repository" in the function name satisfies it.

## Hygiene (`ts-archunit/rules/hygiene`)

Dead code, unused exports, stubs, and empty bodies. These are unambiguous violations — code that compiles but does nothing useful.

```typescript
import {
  noDeadModules,
  noUnusedExports,
  noStubComments,
  noEmptyBodies,
} from '@nielspeter/ts-archunit/rules/hygiene'
```

| Rule                       | Target    | What it checks                                       |
| -------------------------- | --------- | ---------------------------------------------------- |
| `noDeadModules()`          | modules   | File must be imported by at least one other file     |
| `noUnusedExports()`        | modules   | Every named export must be referenced elsewhere      |
| `noStubComments(pattern?)` | functions | No TODO/FIXME/HACK/STUB/PLACEHOLDER comments in body |
| `noEmptyBodies()`          | functions | Functions must have at least one statement           |

### Dead module detection

`noDeadModules()` checks the reverse import graph. A file with zero importers is flagged. Entry points (`index.ts`, `main.ts`, config files) should be excluded:

```typescript
modules(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .satisfy(noDeadModules())
  .excluding('index.ts', 'main.ts', 'config.ts')
  .check()
```

**Note:** Both static `import` declarations and dynamic `import()` expressions with string-literal specifiers are resolved. Only `require()` calls and dynamic imports with computed specifiers (variables, template literals with substitutions) are not resolved.

**Monorepo note:** In a multi-workspace project, exports consumed by sibling workspaces are invisible to a single `project()` call. Use `workspace()` to unify the import graph across workspaces. See [Getting Started — Monorepo Setup](/getting-started#monorepo-setup).

### Unused export detection

`noUnusedExports()` checks each named export for external references using ts-morph's language service. More expensive than file-level checks — scope with predicates:

```typescript
modules(p).that().resideInFolder('src/**').should().satisfy(noUnusedExports()).check()
```

### Stub detection

`noStubComments()` catches common stub markers inside function bodies: TODO, FIXME, HACK, XXX, STUB, DEFERRED, PLACEHOLDER, "not implemented", "coming soon". Pass a custom regex to narrow the scope:

```typescript
// Default — catches all common markers
functions(p).that().resideInFolder('src/**').should().satisfy(noStubComments()).check()

// Custom — only catch TODO and FIXME
functions(p)
  .that()
  .resideInFolder('src/**')
  .should()
  .satisfy(noStubComments(/\b(TODO|FIXME)\b/i))
  .check()
```

Note: comments _above_ a function (leading trivia) are not checked — only comments _inside_ the function body.

### Empty body detection

`noEmptyBodies()` catches functions with zero statements. Expression-bodied arrows (`() => expr`) always pass — they have content by definition:

```typescript
functions(p).that().resideInFolder('src/**').should().satisfy(noEmptyBodies()).check()
```

## Naming (`ts-archunit/rules/naming`)

Naming conventions keep a codebase navigable. When every controller ends with `Controller` and every repository ends with `Repository`, developers find code by convention instead of searching. These rules enforce class naming patterns — apply them to specific folders so classes in each layer follow predictable names.

```typescript
import { mustMatchName, mustNotEndWith } from '@nielspeter/ts-archunit/rules/naming'
```

| Rule                     | What it checks                                 |
| ------------------------ | ---------------------------------------------- |
| `mustMatchName(pattern)` | Class name must match a regex pattern          |
| `mustNotEndWith(suffix)` | Class name must not end with a specific suffix |

`mustMatchName` takes a regex — use anchored patterns like `/Controller$/` to enforce suffixes, or `/^Base/` to enforce prefixes. `mustNotEndWith` is the inverse — use it to ban anti-patterns like classes named `...Manager` or `...Helper` that tend to become God objects:

```typescript
// Controllers must be named *Controller
classes(p)
  .that()
  .resideInFolder('**/controllers/**')
  .should()
  .satisfy(mustMatchName(/Controller$/))
  .check()

// Domain objects should not have "Entity" suffix (that's an ORM concern)
classes(p).that().resideInFolder('**/domain/**').should().satisfy(mustNotEndWith('Entity')).check()
```

## Dependencies (`ts-archunit/rules/dependencies`)

Dependency rules enforce which modules are allowed to import from where. This is the core of architecture enforcement — preventing a service from importing directly from a database driver, or a UI component from reaching into server code. These rules work at the module (file) level, checking every `import` statement.

The difference between these standard rules and the fluent API methods (`.onlyImportFrom()`, `.notImportFrom()`) is packaging: standard rules return a `Condition<SourceFile>` you pass to `.satisfy()`, making them composable with other conditions in the same chain. Use whichever reads better for your team.

```typescript
import {
  onlyDependOn,
  mustNotDependOn,
  typeOnlyFrom,
} from '@nielspeter/ts-archunit/rules/dependencies'
```

| Rule                        | What it checks                                 |
| --------------------------- | ---------------------------------------------- |
| `onlyDependOn(...globs)`    | Module may only import from listed paths       |
| `mustNotDependOn(...globs)` | Module must not import from listed paths       |
| `typeOnlyFrom(...globs)`    | Imports from these paths must be `import type` |

`onlyDependOn` is an allowlist — every import must resolve to one of the listed paths. `mustNotDependOn` is a blocklist — any import matching the pattern is a violation. `typeOnlyFrom` is a middle ground: you can reference types from a layer (for function signatures, generics) but cannot take a runtime dependency on it:

```typescript
// Domain layer: only import from domain and shared — nothing else
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(onlyDependOn('**/domain/**', '**/shared/**'))
  .check()

// Services: no direct imports from the legacy layer
modules(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(mustNotDependOn('**/legacy/**'))
  .check()

// Services can reference repository types but not call repository code
modules(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(typeOnlyFrom('**/repositories/**'))
  .because('services should only use repository types, not implementations')
  .check()
```

## Code Quality (`ts-archunit/rules/code-quality`)

Structural code quality rules that go beyond what a linter catches. These check properties of the class as a whole — whether public methods are documented, whether mutable state is exposed, whether magic numbers are scattered through method bodies. Use `.warn()` for gradual adoption on existing codebases, `.check()` for strict enforcement on new code.

```typescript
import {
  requireJsDocOnPublicMethods,
  noPublicFields,
  noMagicNumbers,
} from '@nielspeter/ts-archunit/rules/code-quality'
```

| Rule                            | What it checks                                                   |
| ------------------------------- | ---------------------------------------------------------------- |
| `requireJsDocOnPublicMethods()` | All public methods must have JSDoc comments                      |
| `noPublicFields()`              | No public mutable fields (allows static readonly)                |
| `noMagicNumbers(options?)`      | No numeric literals in method bodies (configurable allowed list) |

`requireJsDocOnPublicMethods` enforces that every public API surface is documented. This is especially useful for library code and shared packages where consumers rely on JSDoc for IDE hints. `noPublicFields` enforces encapsulation — state should be accessed through methods, not exposed directly (static readonly constants are allowed). `noMagicNumbers` catches unexplained numeric literals in method bodies; pass an `allowed` array for numbers that are self-explanatory (0, 1, -1, HTTP status codes):

```typescript
// Public API must be documented
classes(p)
  .that()
  .areExported()
  .should()
  .satisfy(requireJsDocOnPublicMethods())
  .because('public API must be documented for consumers')
  .warn()

// Domain objects should encapsulate state
classes(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .satisfy(noPublicFields())
  .because('encapsulate state behind methods')
  .check()

// No magic numbers — allow common constants
classes(p)
  .should()
  .satisfy(noMagicNumbers({ allowed: [0, 1, -1, 200, 404, 500] }))
  .warn()
```

## Metrics (`ts-archunit/rules/metrics`)

Metric rules enforce quantitative limits on code complexity and size. Cyclomatic complexity measures how many independent paths exist through a function — high values mean the function is hard to test and reason about. Line counts and method counts catch classes that have grown too large and need splitting. Parameter counts flag functions with too many arguments (a sign they need a parameter object or decomposition).

Class-level rules check every method, constructor, getter, and setter in the class. Function-level rules check standalone functions, arrow functions, and class methods individually. Use the function variants for more granular control.

```typescript
import {
  maxCyclomaticComplexity,
  maxClassLines,
  maxMethodLines,
  maxMethods,
  maxParameters,
  maxFunctionComplexity,
  maxFunctionLines,
  maxFunctionParameters,
} from '@nielspeter/ts-archunit/rules/metrics'
```

| Rule                         | Target    | What it checks                         |
| ---------------------------- | --------- | -------------------------------------- |
| `maxCyclomaticComplexity(n)` | classes   | No method exceeds complexity N         |
| `maxClassLines(n)`           | classes   | Class spans no more than N lines       |
| `maxMethodLines(n)`          | classes   | No method exceeds N lines              |
| `maxMethods(n)`              | classes   | Class has no more than N methods       |
| `maxParameters(n)`           | classes   | No method has more than N parameters   |
| `maxFunctionComplexity(n)`   | functions | Function complexity does not exceed N  |
| `maxFunctionLines(n)`        | functions | Function spans no more than N lines    |
| `maxFunctionParameters(n)`   | functions | Function has no more than N parameters |

Start with generous limits and tighten over time. Common starting points: complexity 15, method lines 40, class lines 300, parameters 4. Use `.warn()` for soft limits and `.check()` for hard limits:

```typescript
// Hard limits — fail CI
classes(p).should().satisfy(maxCyclomaticComplexity(15)).check()
classes(p).should().satisfy(maxParameters(4)).check()
functions(p).should().satisfy(maxFunctionComplexity(15)).check()

// Soft limits — warn but don't block
classes(p).should().satisfy(maxClassLines(300)).warn()
classes(p).should().satisfy(maxMethods(15)).warn()
functions(p).should().satisfy(maxFunctionLines(40)).warn()
```

See [Metrics](/metrics) for full documentation including predicates for filtering by complexity threshold.

## Writing Your Own

Standard rules are factory functions that return a typed `Condition<T>`. You can write your own using `defineCondition()` or by directly implementing the `Condition` interface — any object with a `description` string and an `evaluate(elements, context)` method works. See [Custom Rules](/custom-rules) for the full guide.
