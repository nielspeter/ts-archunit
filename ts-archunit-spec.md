# ts-archunit — Architecture Testing for TypeScript

**Status:** Design Spec (Draft)
**Created:** 2026-03-25

---

## 1. Problem

Architecture decisions rot. Teams document conventions in wikis, enforce them in code review, and discover violations months later during costly manual audits.

### 1.1 What Happens Without Architecture Tests

A real-world API codebase with ~40 repositories, ~30 route files, and a GraphQL layer grew organically over 18 months. A routine feature addition revealed that list endpoints had diverged into incompatible patterns. It took a **433-line audit plan** just to catalog the inconsistencies — before writing a single line of fix code.

Here is what the audit found:

**The same operation implemented three different ways across three route files:**

```typescript
// File A — manual Number(), no limit cap
const skip = Number(request.query.skip) || 0
const limit = Number(request.query.limit) || 100

// File B — manual Number() with Math.min cap
const skip = Number(request.query.skip) || 0
const limit = Math.min(Number(request.query.limit) || 100, 1000)

// File C — conditional Number(), no cap
skip: skip !== undefined ? Number(skip) : undefined,
limit: limit !== undefined ? Number(limit) : undefined,
```

A shared utility `normalizePagination()` existed in the codebase. Some endpoints used it; most didn't.

**Copy-pasted order parsing with identical logic, different names:**

```typescript
// webhooks.ts
function parseWebhookOrder(order: string | undefined): {
  orderBy: WebhookOrderByColumn; orderDirection: 'asc' | 'desc'
} {
  let orderBy: WebhookOrderByColumn = 'created_at'
  let orderDirection: 'asc' | 'desc' = 'desc'
  if (order) {
    const isDesc = order.startsWith('-')
    const field = isDesc ? order.slice(1) : order
    const mapped = webhookOrderMap[field]
    if (mapped) { orderBy = mapped; orderDirection = isDesc ? 'desc' : 'asc' }
  }
  return { orderBy, orderDirection }
}

// content-types.ts — identical logic, different variable names
function parseContentTypeOrder(order: string | undefined): {
  orderBy: ContentTypeOrderByColumn; orderDirection: 'asc' | 'desc'
} {
  // ... exact same implementation with different map and defaults
}
```

**Repository layer — four different patterns for the same count operation:**

```typescript
// Repository A — inline, no null guard
const total = typeof countResult.count === 'string'
  ? parseInt(countResult.count, 10) : countResult.count

// Repository B — inline, with null guard + throw
if (!countResult) throw new Error('Count query returned no results')
const total = typeof countResult.count === 'string'
  ? parseInt(countResult.count, 10) : countResult.count

// Repository C — same as A (copy-pasted)
const total = typeof countResult.count === 'string'
  ? parseInt(countResult.count, 10) : countResult.count

// Repository D — uses the shared base class helper (the correct way!)
return this.extractCount(result) > 0
```

The base class provided `extractCount()`. One repository out of 40+ used it.

**Type safety gaps hiding in plain sight:**

```typescript
// Repository A — typed column union (safe)
export interface WebhookQueryOptions {
  orderBy?: 'created_at' | 'updated_at' | 'name'  // only valid columns
}

// Repository B — bare string (SQL injection surface)
export interface RoleQueryOptions {
  orderBy?: string  // accepts anything, passed to .orderBy()
}
```

**Inconsistent error handling across repositories:**

```typescript
// Repository A — generic Error
throw new Error(`Webhook '${webhookId}' not found`)

// Repository B — typed domain error (correct)
throw new NotFoundError('Role', cmlessId)

// Repository C — generic Error
throw new Error(`Tag '${tagId}' not found`)
```

### 1.2 The Cost

Each inconsistency was introduced by a single PR that looked correct in isolation. Code review didn't catch them because no reviewer holds the full pattern inventory in their head. The inconsistencies compound:

- **Security gaps:** Untyped `orderBy: string` passed to SQL query builders.
- **Behavioral surprises:** Some endpoints cap at 1000 items, some return unlimited results.
- **Maintenance burden:** Bug fix in one pattern must be manually replicated across all copies.
- **Onboarding friction:** New developers don't know which pattern to copy.

The audit plan itself — just documenting what's wrong — took longer than fixing the actual code.

### 1.3 What Existing Tools Cannot Do

| Tool | What it checks | What it misses |
|---|---|---|
| **dependency-cruiser** | Import paths between modules | Everything inside function bodies |
| **eslint-plugin-boundaries** | Which modules can import which | Type shapes, call patterns, class inheritance |
| **Nx module boundaries** | Cross-library imports in monorepos | Same as above |
| **ts-arch** (npm) | Basic dependency rules | Body analysis, type checking, custom predicates |
| **ESLint rules** | Syntax-level patterns | Architectural relationships, cross-file analysis |

None of these can express: "Every class extending `BaseRepository` must call `this.extractCount()` instead of inline `parseInt`." That requires **body analysis** — inspecting what happens _inside_ a function, not just its signature or imports.

### 1.4 What ts-archunit Does

ts-archunit expresses architectural rules as executable tests using a fluent DSL:

```typescript
// This single rule prevents all four count-parsing variants from ever diverging again
classes(p)
  .that().extend('BaseRepository')
  .should().useInsteadOf(call('parseInt'), call('this.extractCount'))
  .because('use this.extractCount() from BaseRepository')
  .check();
```

Rules run in your test suite (vitest/jest). CI catches violations on the PR that introduces them — not 18 months later during an audit.

---

## 2. Design Principles

1. **DSL-first, framework-agnostic.** The core DSL operates on raw TypeScript constructs — functions, classes, types, decorators, call expressions, AST patterns. No framework knowledge is baked in. The same primitives work whether your project uses NestJS, Fastify, Express, Hono, tRPC, or no framework at all. Framework-specific convenience layers are optional sugar built from the same primitives via `definePredicate()` / `defineCondition()`.

2. **Rules are tests.** Rules run in vitest/jest. A failing rule is a failing test. CI catches violations before code review.

3. **ts-morph all the way down.** Every DSL primitive maps to a ts-morph operation. No custom parser, no intermediate representation. The TypeScript compiler _is_ the source of truth.

4. **TypeScript 7 assumed.** The Go-based compiler eliminates performance concerns. No need for lighter parser fallbacks. Full type checking is always available.

5. **Composable predicates.** Rules are built by chaining predicates (`.that()`) and conditions (`.should()`). Custom predicates are first-class — same interface as built-in ones. Users encode their team's conventions with the same tools the library uses internally.

6. **Semantic over textual.** Prefer AST-level matchers over string matching. `call('parseInt')` matches the function call node regardless of formatting or whitespace. String-based `expression()` exists as an escape hatch for edge cases, not as a primary matching mechanism.

7. **Query engine mindset.** Internally, this is a semantic query engine over a TypeScript codebase, not a naive AST walker. Pre-indexed queries, memoized predicate results, and rule batching enable performance at scale. Think closer to CodeQL (but developer-friendly) than to ESLint.

---

## 3. Non-Goals and Scope

### 3.1 Out of Scope (v1)

- **Auto-fixing.** ts-archunit detects violations. It does not fix them. Fixes require human judgment about which direction to standardize toward.
- **Runtime checking.** This is a static analysis tool. It does not instrument running code.
- **ESLint plugin.** The DSL is richer than ESLint's rule model. Integration with ESLint is a future consideration, not a v1 goal.
- **JavaScript-only projects.** The tool requires TypeScript source files and a `tsconfig.json`. Mixed JS/TS projects are supported (TypeScript compiles `.js` files), but pure JS projects are not targeted.
- **Framework-specific adapters in core.** The core package ships zero framework knowledge. Framework presets may be published as separate packages or user-defined predicate libraries.
- **Code generation.** ts-archunit does not generate code, scaffolds, or boilerplate.
- **Full data-flow analysis.** Cross-function taint tracking is out of scope. Data-flow-lite rules (same function scope) are in scope (see Section 6.3).

### 3.2 Explicitly In Scope

- **Any TypeScript project.** Backend, frontend, CLI tools, libraries, monorepos.
- **Any framework or none.** The DSL is framework-agnostic by design.
- **Custom rules.** Teams define their own predicates and conditions using the same API as built-in ones.
- **GraphQL schemas.** Separate entry point using the `graphql` parser (Phase 3). Extension, not core dependency.
- **Diff-aware mode.** Evaluate full project, report only on changed files in a PR (see Section 11.4).
- **Baseline mode.** Gradual adoption — record existing violations, only fail on new ones (see Section 11.5).
- **Rule severity levels.** Not everything needs to fail CI (see Section 6.9).

---

## 4. Core Concepts

### 4.1 Architectural Units

TypeScript has multiple levels of architectural structure. Unlike Java where the class is king, TypeScript code mixes paradigms — classes, functions, modules, types. The DSL must work across all of them.

| Unit | What it represents | ts-morph type |
|---|---|---|
| **Module** | A source file (`.ts`/`.tsx`) | `SourceFile` |
| **Class** | A class declaration | `ClassDeclaration` |
| **Function** | A function declaration or const arrow function | `FunctionDeclaration`, `VariableDeclaration` with arrow |
| **Type** | An interface or type alias | `InterfaceDeclaration`, `TypeAliasDeclaration` |
| **Enum** | An enum declaration | `EnumDeclaration` |
| **Call** | A call expression (e.g., `router.get(...)`, `app.use(...)`) | `CallExpression` |
| **Slice** | A logical grouping of modules by path pattern | Custom (set of `SourceFile`) |

### 4.2 Entry Points

Each architectural unit has a top-level entry function that returns a rule builder:

```typescript
import { project, modules, classes, functions, types, calls, slices } from 'ts-archunit';

const p = project('tsconfig.json');

modules(p)      // → ModuleRuleBuilder
classes(p)      // → ClassRuleBuilder
functions(p)    // → FunctionRuleBuilder
types(p)        // → TypeRuleBuilder
calls(p)        // → CallRuleBuilder
slices(p)       // → SliceRuleBuilder
```

### 4.3 Rule Structure

Every rule follows the same shape:

```
<entry>(project)
  .that().<predicate>()          // filter: which elements does this rule apply to?
  [.and().<predicate>()]         // optional: narrow further
  .should().<condition>()        // assert: what must be true?
  [.andShould().<condition>()]   // optional: additional assertions
  [.because('reason')]           // optional: human-readable rationale
  .check()                       // execute and throw on violations
```

### 4.4 Named Selections (Reusable Queries)

Predicate chains can be saved and reused across multiple rules. This prevents re-encoding "what is a route handler" or "what is a repository" in every rule:

```typescript
// Define once
const repositories = classes(p).that().extend('BaseRepository');
const routes = calls(p).that().onObject('app').and().withMethod(/^(get|post|put|delete|patch)$/);

// Use in multiple rules
repositories.should().notContain(call('parseInt')).check();
repositories.should().notContain(newExpr('Error')).check();
repositories.should().notHaveMethodMatching(/^query$/).check();

routes.should().haveCallbackContaining(call('handleError')).check();
routes.should().haveCallbackContaining(call('normalizePagination')).check();
```

Named selections are lazy — the predicate chain is evaluated when `.check()` is called, not when the selection is defined. This means they always reflect the current state of the project.

#### Scoped Rules with `within()`

Named selections can also scope rules to a context — "within route handlers, enforce X":

```typescript
const routeHandlers = calls(p)
  .that().onObject('app')
  .and().withMethod(/^(get|post|put|delete|patch)$/);

// Rules scoped to route handler callbacks
within(routeHandlers)
  .functions().should().contain(call('handleError')).check();

within(routeHandlers)
  .functions().should().contain(call('normalizePagination')).check();
```

`within()` restricts the search space. Instead of scanning all functions in the project, it only looks at functions that are callbacks inside the matched call expressions. This is both a correctness improvement (the rule only applies where it should) and a performance improvement (smaller search space).

---

## 5. Predicate Reference

Predicates filter which architectural elements a rule applies to. They follow the `.that()` and `.and()` chains.

### 5.1 Identity Predicates

Available on all entry points.

| Predicate | Description | Applies to |
|---|---|---|
| `haveNameMatching(pattern)` | Name matches regex or glob | all |
| `haveNameStartingWith(prefix)` | Name starts with string | all |
| `haveNameEndingWith(suffix)` | Name ends with string | all |
| `resideInFile(glob)` | Source file path matches glob | all |
| `resideInFolder(glob)` | Source file's directory matches glob | all |
| `areExported()` | Has `export` keyword | all except Call |
| `areNotExported()` | No `export` keyword | all except Call |

```typescript
classes(p).that().haveNameEndingWith('Repository')
functions(p).that().resideInFolder('src/routes/**')
types(p).that().haveNameMatching(/QueryOptions$/)
modules(p).that().resideInFile('**/index.ts')
```

### 5.2 Class Predicates

| Predicate | Description |
|---|---|
| `extend(className)` | Extends a specific base class |
| `implement(interfaceName)` | Has explicit `implements` clause |
| `structurallyMatch(interfaceName)` | Satisfies interface structurally (type checker) |
| `haveDecorator(name)` | Has decorator with given name |
| `haveDecoratorMatching(regex)` | Has decorator matching pattern |
| `areAbstract()` | Is abstract class |
| `haveMethodNamed(name)` | Has a method with the given name |
| `haveMethodMatching(regex)` | Has a method whose name matches |
| `havePropertyNamed(name)` | Has a property with the given name |

```typescript
classes(p).that().extend('BaseRepository')
classes(p).that().haveDecorator('Injectable')
classes(p).that().implement('EventHandler')
```

### 5.3 Function Predicates

| Predicate | Description |
|---|---|
| `areAsync()` | Is async function |
| `haveParameterCount(n)` | Has exactly n parameters |
| `haveParameterCountGreaterThan(n)` | Has more than n parameters |
| `haveParameterNamed(name)` | Has a parameter with given name |
| `haveReturnType(typePattern)` | Return type matches (string or structural) |
| `haveDecorator(name)` | Has decorator (for class methods selected as functions) |

```typescript
functions(p).that().areAsync().and().haveParameterCount(3)
functions(p).that().haveReturnType(/Promise/)
```

### 5.4 Type Predicates

| Predicate | Description |
|---|---|
| `areInterfaces()` | Is an `interface`, not a `type` alias |
| `areTypeAliases()` | Is a `type` alias, not an `interface` |
| `haveProperty(name)` | Has a property with given name |
| `havePropertyOfType(name, typePattern)` | Has a property whose type matches |
| `extendType(name)` | Extends another interface/type |

```typescript
types(p).that().haveNameMatching(/QueryOptions$/).and().haveProperty('orderBy')
types(p).that().areInterfaces().and().extendType('BaseOptions')
```

### 5.5 Call Predicates

Call predicates select call expressions. This is critical for any framework that registers behavior via function calls rather than decorators — which includes most of the TypeScript ecosystem (Express `router.get()`, Fastify `app.get()`, Hono `app.route()`, tRPC `router()`, Elysia `.get()`, etc.).

| Predicate | Description |
|---|---|
| `onObject(name)` | Call is on object named `name` (e.g., `app`, `router`) |
| `withMethod(nameOrRegex)` | Method name matches (e.g., `get`, `/^(get\|post\|put\|delete)$/`) |
| `withArgMatching(index, pattern)` | Argument at position matches pattern |
| `withStringArg(index, glob)` | String literal argument matches glob |
| `haveCallbackContaining(predicate)` | The callback argument contains... |

```typescript
// Select route registrations (works for any framework using this call pattern)
calls(p)
  .that().onObject('app')
  .and().withMethod(/^(get|post|put|delete|patch)$/)

// Select specific routes by path pattern
calls(p)
  .that().onObject('router')
  .and().withMethod('get')
  .and().withStringArg(0, '/api/users/**')
```

### 5.6 Module Predicates

| Predicate | Description |
|---|---|
| `importFrom(glob)` | Has an import from a path matching glob |
| `notImportFrom(glob)` | Has no imports from path matching glob |
| `exportSymbolNamed(name)` | Exports a symbol with given name |
| `havePathMatching(glob)` | Module file path matches |

### 5.7 Slice Predicates

| Predicate | Description |
|---|---|
| `matching(glob)` | Each directory matching the glob is a slice |
| `assignedFrom(definition)` | Slices are defined by a name-to-glob map |

```typescript
const layers = {
  presentation: 'src/controllers/**',
  application: 'src/services/**',
  persistence: 'src/repositories/**',
  domain: 'src/domain/**',
};

slices(p).assignedFrom(layers)
slices(p).matching('src/features/*/')
```

---

## 6. Condition Reference

Conditions assert what must be true about the filtered elements. They follow `.should()` and `.andShould()`.

### 6.1 Structural Conditions

| Condition | Description | Applies to |
|---|---|---|
| `resideInFile(glob)` | Must be in a file matching glob | all |
| `resideInFolder(glob)` | Must be in a folder matching glob | all |
| `haveNameMatching(regex)` | Name must match | all |
| `beExported()` | Must be exported | all |
| `notExist()` | No elements should match (the predicate set must be empty) | all |

```typescript
// "Helper functions with this naming pattern should not exist"
functions(p)
  .that().haveNameMatching(/^parse\w+Order$/)
  .and().resideInFolder('src/routes/**')
  .should().notExist()
  .because('use the shared parseOrder() utility')
  .check();
```

### 6.2 Dependency Conditions

| Condition | Description | Applies to |
|---|---|---|
| `onlyImportFrom(...globs)` | May only import from listed paths | Module |
| `notImportFrom(...globs)` | Must not import from listed paths | Module |
| `onlyHaveTypeImportsFrom(...globs)` | Imports from these paths must be `import type` | Module |
| `notReference(name)` | Must not reference this identifier anywhere | Class, Function, Module |
| `notReferenceType(name)` | Must not reference this type | Class, Function |

```typescript
modules(p)
  .that().resideInFolder('src/domain/**')
  .should().notImportFrom('src/repositories/**', 'src/controllers/**')
  .check();

classes(p)
  .that().resideInFolder('src/wrappers/**')
  .should().notReference('URLSearchParams')
  .because('use the shared buildQueryString() utility')
  .check();
```

### 6.3 Body Analysis Conditions

These inspect the contents of function/method bodies. This is where ts-archunit goes beyond import-path checking — it can assert what happens _inside_ a function.

**Important design note:** Body analysis operates at the **AST level**, not string matching. `call('parseInt')` matches the call expression node for `parseInt(...)` regardless of whitespace, formatting, or surrounding code. The `expression()` helper (Section 6.3.3) is the only string-based matcher and is explicitly labeled as an escape hatch.

| Condition | Description | Applies to |
|---|---|---|
| `contain(call(name))` | Body must contain a call to `name` | Function, Class (any method) |
| `contain(call(regex))` | Body must contain a call matching regex | Function, Class |
| `notContain(call(name))` | Body must NOT contain a call to `name` | Function, Class |
| `contain(access(chain))` | Body accesses a property chain | Function, Class |
| `contain(newExpr(name))` | Body contains `new Name(...)` | Function, Class |
| `notContain(newExpr(name))` | Body must NOT contain `new Name(...)` | Function, Class |
| `useInsteadOf(bad, good)` | Must NOT contain `bad` AND must contain `good` | Function, Class |

#### 6.3.1 `call()` helper

The primary matching mechanism. Operates on AST `CallExpression` nodes.

```typescript
call('normalizePagination')       // exact function name
call('parseOrder')                // exact function name
call(/^parse\w+Order$/)           // regex match on function name
call('Math.min')                  // method call on object
call('JSON.stringify')            // method call on global
call('this.extractCount')         // method call on this
```

**Advanced:** `call()` also accepts a predicate function for full AST-level matching:

```typescript
call(c => c.getArguments().length === 2)   // calls with exactly 2 args
call('parseInt').withArgument(access('countResult.count'))  // parseInt(countResult.count)
```

**Symbol-aware matching (optional):** For cases where functions are aliased, destructured, or re-exported, string-based name matching can miss calls. Symbol-aware matching uses the TypeScript type checker to resolve the actual symbol:

```typescript
// Matches even if extractCount is destructured: const { extractCount } = this
call(symbolOf('BaseRepository.extractCount'))

// Matches even if imported under a different name
call(resolvesTo('parseOrder'))   // traces through imports/re-exports
```

`symbolOf()` and `resolvesTo()` are Phase 2 additions. Phase 1 uses name-based matching only, which covers the majority of real-world cases (most codebases call `this.extractCount()`, not a destructured alias).

**Implementation:** Walks all `CallExpression` descendants. For `foo()`, checks the identifier text. For `a.b()`, checks the `PropertyAccessExpression` chain. This is AST-level, not string matching — it works regardless of formatting.

#### 6.3.2 `access()` helper

```typescript
access('request.query.order')     // property access chain
access('this.db')                 // access on this
```

**Implementation:** Walks `PropertyAccessExpression` chains and matches against the dotted path.

#### 6.3.3 `expression()` — escape hatch

**Warning: `expression()` uses string matching and is fragile.** It exists for edge cases where AST-level matchers are insufficient. Prefer `call()`, `access()`, and `newExpr()` for all standard cases.

```typescript
// AVOID when possible — fragile, breaks on formatting changes
expression('Number(')
expression("typeof countResult")

// PREFER — AST-level, formatting-independent
call('Number')
call('parseInt')
call('this.extractCount')
```

`expression()` matches against the `.getText()` of AST expression nodes. It is a substring/regex check. Variable renames, formatting changes, and logically equivalent code can break these rules silently.

**Runtime warning:** When `expression()` is used, the tool emits a warning to stderr on every invocation:

```
⚠ Rule "repositories must not inline count parsing" uses expression() — a fragile string matcher.
  Consider replacing with call(), access(), or newExpr() for AST-level matching.
```

This warning is suppressible via `.expression('...', { acknowledged: true })` for cases where string matching is genuinely the best option. The warning ensures teams don't silently accumulate fragile rules.

#### 6.3.4 `useInsteadOf()` — migration intent

Encodes both prohibition AND required replacement in a single condition:

```typescript
// Instead of writing two separate conditions:
//   .should().notContain(call('parseInt'))
//   .andShould().contain(call('this.extractCount'))

// Write:
.should().useInsteadOf(call('parseInt'), call('this.extractCount'))
```

This produces better violation messages ("use X instead of Y" vs just "don't use Y") and makes the migration intent explicit.

#### 6.3.5 Argument-level matching: `call().withArgument()`

Instead of data-flow tracing (which is ambiguous and hard to get right), ts-archunit uses **argument-level matching** — asserting that a specific value is passed as an argument to a specific function:

```typescript
// "request.query.order must be passed to parseOrder()"
.should().contain(
  call('parseOrder').withArgument(access('request.query.order'))
)
```

This is unambiguous. It checks that `parseOrder(request.query.order)` or `parseOrder(order)` where `order = request.query.order` appears in the function body. It does NOT attempt statement-order analysis or data-flow tracing.

For cases where the value is destructured or aliased before being passed, the simpler form is sufficient:

```typescript
// Simpler: just check that both access and call exist in the same scope
.should().contain(call('parseOrder'))
.andShould().contain(access('request.query.order'))
```

**Design rationale:** Earlier drafts included `ensureValueIsProcessedBy()` which attempted same-scope data-flow analysis. This was dropped because the semantics are ambiguous (what counts as "processed"? what about intermediate variables? what about calls that happen after the value is used?). Argument matching is precise, predictable, and sufficient for the real-world rules that motivated this feature.

### 6.4 Type-Level Conditions

| Condition | Description | Applies to |
|---|---|---|
| `havePropertyType(name, matcher)` | Property's type must match | Type |
| `returnTypeMatches(shape)` | Return type must match structural shape | Function |
| `implementShape(shape)` | Must structurally match a shape | Class |

#### Semantic Type Matchers

Type matchers operate on the TypeScript type checker, not on string representations. They handle unions, aliases, generics, and `undefined` correctly.

```typescript
not(isString())                   // any type except string (handles string | undefined)
exactly(isNumber())               // exactly number
isUnionOfLiterals()               // must be a union of string/number literals
isStringLiteral()                 // a specific string literal type
shapeOf({ skip: 'number', limit: 'number', total: 'number' })
arrayOf(isString())               // string[]
matching(/Promise</)              // regex on type text (escape hatch)
```

**Implementation:** Uses `type.isString()`, `type.isUnion()`, `type.getUnionTypes()`, `type.isStringLiteral()` etc. from the TypeScript type checker via ts-morph. These are semantic checks, not string comparisons — they correctly handle type aliases, `Partial<>`, `Pick<>`, and other type-level operations.

```typescript
// "QueryOptions.orderBy must be a typed union, never bare string"
types(p)
  .that().haveNameMatching(/QueryOptions$/)
  .and().haveProperty('orderBy')
  .should().havePropertyType('orderBy', not(isString()))
  .because('bare string orderBy passed to .orderBy() is a SQL injection surface')
  .check();

// "Pagination options must use number literals for defaults"
types(p)
  .that().haveProperty('limit')
  .should().havePropertyType('limit', isNumber())
  .check();
```

### 6.5 Class-Specific Conditions

| Condition | Description |
|---|---|
| `extend(className)` | Must extend this class |
| `implement(interfaceName)` | Must explicitly implement |
| `haveMethodNamed(name)` | Must have this method |
| `notHaveMethodMatching(regex)` | Must not have methods matching |

### 6.6 Slice Conditions

| Condition | Description |
|---|---|
| `beFreeOfCycles()` | No circular dependencies between slices |
| `respectLayerOrder(...layers)` | Layer A may depend on B, but B not on A |
| `notDependOn(...sliceNames)` | Named slices must not depend on listed slices |

```typescript
slices(p).assignedFrom(layers)
  .should().respectLayerOrder('presentation', 'application', 'persistence', 'domain')
  .because('dependencies point inward')
  .check();
```

### 6.7 Quantifier Conditions

| Condition | Description |
|---|---|
| `allMatch(condition)` | Every element must satisfy |
| `noneMatch(condition)` | No element may satisfy |
| `atLeastOne(condition)` | At least one element must satisfy |

### 6.8 Logical Combinators

| Combinator | Description |
|---|---|
| `.andShould()` | Both conditions must hold (AND) |
| `.orShould()` | At least one condition must hold (OR) |
| `haveAtLeastOneOf(c1, c2)` | At least one of the listed conditions |
| `haveAllOf(c1, c2)` | All listed conditions |

### 6.9 Rule Severity

Not every rule should fail CI. Rules can specify severity levels:

```typescript
// Fails CI (default)
classes(p).that().extend('BaseRepository')
  .should().notContain(call('parseInt'))
  .check();

// Warns but does not fail
classes(p).that().extend('BaseRepository')
  .should().notHaveMethodMatching(/^query$/)
  .warn();    // instead of .check()
```

| Method | Behavior |
|---|---|
| `.check()` | Throws on violations (fails CI) |
| `.warn()` | Prints violations but does not throw |
| `.severity('error')` | Same as `.check()` |
| `.severity('warn')` | Same as `.warn()` |

---

## 7. Custom Predicates and Conditions

Users define their own predicates and conditions using the same interface as built-in ones. This is the primary extensibility mechanism — it replaces framework-specific adapters.

### 7.1 Custom Predicate

```typescript
import { definePredicate } from 'ts-archunit';

// Example: define what a "route handler" means in YOUR framework
const isRouteRegistration = definePredicate<CallExpression>(
  'is a route registration',
  (call) => {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return false;
    const method = expr.getName();
    return ['get', 'post', 'put', 'delete', 'patch'].includes(method);
  }
);

// Now use it like any built-in predicate
calls(p).that().satisfy(isRouteRegistration)
  .should().haveCallbackContaining(call('handleError'))
  .check();
```

### 7.2 Custom Condition

```typescript
import { defineCondition } from 'ts-archunit';

const useSharedCountHelper = defineCondition<ClassDeclaration>(
  'use shared count helper instead of inline parsing',
  (cls) => {
    const violations = [];
    for (const method of cls.getMethods()) {
      const body = method.getBody();
      if (!body) continue;
      const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
      const usesParseInt = calls.some(c => c.getExpression().getText() === 'parseInt');
      if (usesParseInt) {
        violations.push({
          element: method,
          message: `${method.getName()} calls parseInt() — use this.extractCount() instead`
        });
      }
    }
    return violations;
  }
);

classes(p).that().extend('BaseRepository')
  .should().satisfy(useSharedCountHelper)
  .check();
```

### 7.3 Pattern Templates

Reusable architectural patterns that encode team conventions:

```typescript
import { definePattern } from 'ts-archunit';

const paginatedCollection = definePattern('paginated-collection', {
  returnShape: {
    total: 'number',
    skip: 'number',
    limit: 'number',
    items: 'T[]',
  },
});

functions(p)
  .that().resideInFolder('src/routes/**')
  .and().haveReturnType(/Promise/)
  .should().followPattern(paginatedCollection)
  .check();
```

---

## 8. Built-in Smell Detectors

Beyond user-defined rules, ts-archunit ships detectors for common architectural smells. These are opt-in and run alongside custom rules.

### 8.1 Duplicate Function Bodies

Detects functions with near-identical AST structure across the codebase (like the `parseWebhookOrder` / `parseContentTypeOrder` copy-paste from Section 1.1):

```typescript
import { smells } from 'ts-archunit';

smells.duplicateBodies(p)
  .inFolder('src/routes/**')
  .withMinSimilarity(0.9)        // AST similarity threshold
  .check();
```

### 8.2 Inconsistent Sibling Patterns

Detects when files in the same folder follow different patterns. "All repositories do X except this one" — the odd one out is flagged:

```typescript
smells.inconsistentSiblings(p)
  .inFolder('src/repositories/**')
  .forPattern(call('this.extractCount'))   // most siblings use this
  .check();
```

### 8.3 Guardrails

Smell detectors are powerful but noisy without tuning. They ship with configurable filters to prevent false positives and distrust:

```typescript
smells.duplicateBodies(p)
  .inFolder('src/**')
  .minLines(10)               // ignore trivially small functions
  .ignoreTests()              // exclude test files
  .ignorePaths('**/*.d.ts')   // exclude type declarations
  .groupByFolder()            // group results by directory for readability
  .withMinSimilarity(0.85)    // AST similarity threshold
  .warn();                    // warn, don't fail CI — smells are advisory
```

**Default behavior:** Smell detectors default to `.warn()`, not `.check()`. They are advisory by design. Teams that want to enforce zero duplication can opt in with `.check()`.

### 8.4 Implementation

Smell detectors are built on the same predicate/condition engine. They are syntactic sugar for common multi-step queries. Users can achieve the same results with raw predicates — smells just make common checks convenient.

---

## 9. Extension: GraphQL Schema Rules

GraphQL schemas (`.graphql` files or programmatic SDL) are not TypeScript and need a separate parser. This is an extension module with its own entry points, shipped as `ts-archunit/graphql`. It is **not part of the core** and is delivered in Phase 3.

### 9.1 Entry Points

```typescript
import { schema, resolvers } from 'ts-archunit/graphql';

const s = schema(p, 'src/**/*.graphql');
const r = resolvers(p, 'src/resolvers/**');
```

### 9.2 Schema Predicates and Conditions

| Predicate / Condition | Description |
|---|---|
| `queries()` | Select Query type fields |
| `mutations()` | Select Mutation type fields |
| `typesNamed(regex)` | Select types by name |
| `returnListOf(any())` | Fields returning a list |
| `acceptArgs(...names)` | Must accept these arguments |
| `haveFields(...names)` | Type must have these fields |
| `haveMatchingResolver()` | A resolver implementation must exist |

### 9.3 Resolver Conditions

Resolver conditions reuse the same body analysis engine as function conditions:

```typescript
// "Collection types must have standard pagination fields"
schema.typesNamed(/Collection$/)
  .should().haveFields('total', 'skip', 'limit', 'items')
  .check();

// "Resolvers for relation fields must use DataLoader"
resolvers
  .that().resolveFieldReturning(/^[A-Z]/)
  .should().contain(call('loader.load'))
  .because('prevent N+1 queries')
  .check();
```

---

## 10. Extension: Cross-Layer Validation

Cross-layer validation ensures consistency across architectural boundaries (e.g., API routes match SDK types match OpenAPI schemas). This is the hardest extension and is delivered in Phase 4.

The first version uses explicit user-provided mappings:

```typescript
import { crossLayer } from 'ts-archunit';

crossLayer(p)
  .layer('routes', 'src/routes/**')
  .layer('schemas', 'src/schemas/**')
  .mapping((route, schema) => /* user-defined matching logic */)
  .forEachPair()
  .should(/* consistency condition */)
  .check();
```

Automatic matching (by name convention or path) is a later optimization.

---

## 11. Test Integration and CLI

### 11.1 vitest / jest

Rules are organized using the test runner's native grouping mechanisms. No new concepts — use `describe()` and `it()` as you already do:

```typescript
// arch.test.ts
import { describe, it } from 'vitest';
import { project, classes, functions, types, modules, slices, calls } from 'ts-archunit';

const p = project('tsconfig.json');

// ─── Named selections (define once, reuse across rules) ───
const repositories = classes(p).that().extend('BaseRepository');
const routes = calls(p).that().onObject('app').and().withMethod(/^(get|post|put|delete|patch)$/);

// ─── Rules grouped by architectural concern ───
describe('Repository Standards', () => {
  it('must use extractCount()', () => {
    repositories
      .should().useInsteadOf(call('parseInt'), call('this.extractCount'))
      .check();
  });

  it('must use typed errors', () => {
    repositories
      .should().notContain(newExpr('Error'))
      .because('use NotFoundError/ValidationError')
      .check();
  });

  it('QueryOptions.orderBy must be typed', () => {
    types(p)
      .that().haveNameMatching(/QueryOptions$/)
      .and().haveProperty('orderBy')
      .should().havePropertyType('orderBy', not(isString()))
      .check();
  });
});

describe('Route Consistency', () => {
  it('must use normalizePagination()', () => {
    within(routes)
      .functions().should().contain(call('normalizePagination'))
      .check();
  });

  it('no per-resource order parsers', () => {
    functions(p)
      .that().haveNameMatching(/^parse\w+Order$/)
      .and().resideInFolder('src/routes/**')
      .should().notExist()
      .check();
  });
});

describe('Layer Dependencies', () => {
  it('domain must not depend on infrastructure', () => {
    modules(p)
      .that().resideInFolder('src/domain/**')
      .should().notImportFrom('src/repositories/**')
      .check();
  });

  it('no cycles between feature modules', () => {
    slices(p).matching('src/features/*/')
      .should().beFreeOfCycles()
      .check();
  });
});
```

**Rule organization philosophy:** ts-archunit does NOT introduce its own grouping mechanism (`group()`, `ruleset()`, etc.). Test runners already solve this problem with `describe()`, `it()`, and file-level organization. Adding another layer would create confusion. Use your test runner's features — nested describes, `.skip`, `.only`, tags, file patterns — they all work.

### 11.2 CLI

```bash
# Standalone execution without test runner
npx ts-archunit check arch.rules.ts

# Watch mode
npx ts-archunit check --watch
```

### 11.3 Config File (optional)

```typescript
// ts-archunit.config.ts
import { defineConfig, layers } from 'ts-archunit';

export default defineConfig({
  project: 'tsconfig.json',
  rules: [
    layers({
      controllers: 'src/controllers/**',
      services: 'src/services/**',
      repositories: 'src/repositories/**',
    }).respectOrder('controllers', 'services', 'repositories'),
  ],
});
```

### 11.4 Diff-Aware Mode

Run rules on the full project but only report violations in files changed in the current branch. This makes adoption realistic for large codebases — teams don't need to fix every legacy violation before turning rules on:

```bash
# Only report violations in changed files (CI mode for PRs)
npx ts-archunit check --changed

# Compare against specific base branch
npx ts-archunit check --changed --base main
```

**Important distinction — evaluation scope vs reporting scope:**
- **Evaluation scope: full project.** Rules always analyze the complete codebase. This is necessary because rules like "inconsistent siblings" or "no cycles" need full context to produce correct results.
- **Reporting scope: changed files only.** Violations are only surfaced for files that appear in `git diff --name-only <base>...HEAD`. Existing violations in untouched files are silently ignored.

This means a developer adding a new repository won't be blocked by existing violations in old repositories — but their new file must comply.

### 11.5 Baseline Mode (Gradual Adoption)

For teams adopting ts-archunit into an existing codebase with many pre-existing violations:

```bash
# Generate a baseline of current violations
npx ts-archunit baseline --output arch-baseline.json

# Check against baseline — only NEW violations fail
npx ts-archunit check --baseline arch-baseline.json
```

The baseline file records all known violations (file, line, rule). On subsequent runs, only violations **not in the baseline** are reported. As teams fix legacy code, they regenerate the baseline to ratchet down.

```typescript
// Programmatic API
import { project, classes, withBaseline } from 'ts-archunit';

const p = project('tsconfig.json');

// Load baseline — only new violations fail
const baseline = withBaseline('arch-baseline.json');

classes(p)
  .that().extend('BaseRepository')
  .should().useInsteadOf(call('parseInt'), call('this.extractCount'))
  .check({ baseline });
```

**Baseline file format:** JSON array of `{ rule, file, line }` objects. Line numbers are fuzzy-matched (within a small window) to handle code movement from unrelated changes.

---

## 12. Violation Reporting

When a rule fails, the error message must be actionable: what failed, where, why, and what to do about it.

### 12.1 Violation Structure

```typescript
interface ArchViolation {
  rule: string;           // the rule description
  element: string;        // e.g., "WebhookRepository.query()"
  file: string;           // absolute file path
  line: number;           // line number
  message: string;        // human-readable violation description
  because?: string;       // the .because() rationale
  codeFrame?: string;     // source code snippet around the violation
  suggestion?: string;    // what to use instead (from useInsteadOf, etc.)
}
```

### 12.2 Example Output

```
Architecture Violation [1 of 3]:
Rule: "Repositories must use extractCount()"

  webhook.repository.ts:56 — WebhookRepository.query()

    54 |     const countResult = await baseQuery.clone().count('* as count').first()
    55 |     const total =
  > 56 |       typeof countResult.count === 'string' ? parseInt(countResult.count, 10) : countResult.count
    57 |

  Use instead: this.extractCount(countResult)
  Reason: use this.extractCount() from BaseRepository

Architecture Violation [2 of 3]:
Rule: "QueryOptions.orderBy must be typed"

  role.repository.ts:18 — RoleQueryOptions.orderBy

    17 | export interface RoleQueryOptions {
  > 18 |   orderBy?: string
    19 |   orderDirection?: 'asc' | 'desc'

  Property type is 'string' — expected a typed union of valid column names.
  Reason: bare string orderBy is a SQL injection surface
```

### 12.3 Output Formats

| Format | Use case |
|---|---|
| **terminal** (default) | Human-readable with code frames and colors |
| **json** | Machine-readable for CI integration |
| **github** | GitHub Actions annotations (inline PR comments) |

```bash
npx ts-archunit check --format github
```

---

## 13. Implementation Architecture

```
ts-archunit/
├── src/
│   ├── core/
│   │   ├── project.ts              # ts-morph project loader + caching
│   │   ├── query-engine.ts         # Indexed query engine (pre-scanned AST)
│   │   ├── rule-builder.ts         # Base fluent builder
│   │   ├── predicate.ts            # Predicate interface + combinators
│   │   ├── condition.ts            # Condition interface + combinators
│   │   └── violation.ts            # Violation model + formatting + code frames
│   │
│   ├── builders/
│   │   ├── module-rule-builder.ts  # modules() entry point
│   │   ├── class-rule-builder.ts   # classes() entry point
│   │   ├── function-rule-builder.ts# functions() entry point
│   │   ├── type-rule-builder.ts    # types() entry point
│   │   ├── call-rule-builder.ts    # calls() entry point
│   │   └── slice-rule-builder.ts   # slices() entry point
│   │
│   ├── predicates/
│   │   ├── identity.ts             # haveNameMatching, resideInFolder, etc.
│   │   ├── class.ts                # extend, implement, haveDecorator, etc.
│   │   ├── function.ts             # areAsync, haveParameterCount, etc.
│   │   ├── type.ts                 # haveProperty, havePropertyOfType, etc.
│   │   └── call.ts                 # onObject, withMethod, withStringArg, etc.
│   │
│   ├── conditions/
│   │   ├── structural.ts           # resideInFile, haveNameMatching, notExist
│   │   ├── dependency.ts           # onlyImportFrom, notImportFrom, notReference
│   │   ├── body-analysis.ts        # contain(call()), useInsteadOf(), ensureValueIsProcessedBy()
│   │   ├── type-level.ts           # havePropertyType, returnTypeMatches
│   │   └── slice.ts                # beFreeOfCycles, respectLayerOrder
│   │
│   ├── helpers/
│   │   ├── call.ts                 # call() helper — AST-level call matching
│   │   ├── expression.ts           # expression() escape hatch — string-based
│   │   ├── access.ts               # access() helper for property chains
│   │   ├── type-matchers.ts        # not(), isString(), isUnionOfLiterals(), shapeOf()
│   │   ├── within.ts               # within() scoped rules
│   │   ├── baseline.ts             # Baseline loading/comparison
│   │   └── pattern.ts              # definePattern, followPattern
│   │
│   ├── smells/                     # Built-in smell detectors
│   │   ├── duplicate-bodies.ts
│   │   └── inconsistent-siblings.ts
│   │
│   └── index.ts                    # Public API
│
├── graphql/                        # Extension (Phase 3, separate entry point)
│   ├── schema-loader.ts
│   ├── schema-rule-builder.ts
│   ├── resolver-rule-builder.ts
│   └── index.ts
│
├── package.json
└── tsconfig.json
```

### 13.1 Query Engine

The query engine is the internal backbone. On first use of `project()`, it:

1. Loads the ts-morph `Project` from `tsconfig.json`.
2. **Pre-indexes** all source files: builds lookup tables for classes, functions, types, call expressions, imports, and exports.
3. **Memoizes** predicate results: if two rules both query `classes that extend BaseRepository`, the predicate evaluation runs once.
4. **Batches** rule execution: all `.check()` calls within a single test file are batched to share the same indexed project.

This is what makes the tool a query engine, not a naive walker. The first rule in a test file pays the indexing cost; subsequent rules are fast lookups.

### 13.2 ts-morph Mapping

Every predicate/condition ultimately calls ts-morph APIs:

| DSL operation | ts-morph call |
|---|---|
| `haveDecorator('X')` | `node.getDecorators().some(d => d.getName() === 'X')` |
| `extend('Base')` | `cls.getExtends()?.getExpression().getText()` |
| `resideInFolder(glob)` | `sourceFile.getFilePath()` matched against glob |
| `contain(call('foo'))` | `node.getDescendantsOfKind(SyntaxKind.CallExpression)` filtered by identifier |
| `havePropertyType('x', ...)` | `iface.getProperty('x')?.getType()` → type checker methods |
| `returnTypeMatches(shape)` | `checker.isTypeAssignableTo(returnType, shapeType)` |
| `onlyImportFrom(globs)` | `sourceFile.getImportDeclarations()` filtered and checked |
| `beFreeOfCycles()` | Build directed graph from imports, run Tarjan's SCC algorithm |
| `onObject('app')` | `callExpr.getExpression()` → check `PropertyAccessExpression` object name |

### 13.3 Two-Tier Analysis: AST-Only vs Type-Checked

Not every rule needs the type checker. Most predicates and conditions operate on AST structure alone (names, decorators, call expressions, imports). Only a subset requires type resolution (`havePropertyType`, `returnTypeMatches`, `structurallyMatch`, `symbolOf`).

The query engine tracks which rules require type checking and which don't:

- **AST-only rules** (majority): Fast. Operate on parsed syntax trees. No type resolution overhead.
- **Type-checked rules**: Slower. Trigger the TypeScript type checker on demand. Results are memoized per-type to avoid cascading re-evaluations.

Type checking is **lazy** — it is not triggered during project loading or indexing. It is only invoked when a rule's condition actually needs a type. This prevents rules like `contain(call('parseInt'))` (pure AST) from paying for the cost of rules like `havePropertyType('orderBy', not(isString()))` (type checker).

### 13.4 Caching and Lazy Loading

1. **Lazy AST loading:** In large monorepos (5000+ files), loading every file's AST upfront is prohibitive. The query engine uses **lazy loading** — source files are parsed on first access, not on project creation. Predicate filters like `resideInFolder('src/repositories/**')` narrow the file set before any AST is parsed.

2. **In-process memoization:** The ts-morph `Project` instance and query indexes are cached across rules in a single test run (singleton per tsconfig path). Predicate results are memoized — if two rules both query `classes that extend BaseRepository`, the scan runs once.

3. **On-disk cache (optional):** Pre-indexed data (class names, function names, import graphs) can be cached to disk keyed by file content hashes. This avoids re-parsing unchanged files across CI runs.

### 13.5 Performance Budget

| Codebase size | Target | Strategy |
|---|---|---|
| Small (< 500 files) | < 3 seconds for 50 rules | Full project in memory, no special handling |
| Medium (500–2000 files) | < 10 seconds for 50 rules | Lazy AST loading, memoized predicates |
| Large monorepo (2000–10000 files) | < 30 seconds for 50 rules | Lazy loading + on-disk cache + file-set narrowing via `resideInFolder` |

The query engine indexing is a one-time cost per test run; rule evaluation is fast index lookups. With TS7's compiler speed, these targets should be achievable. If a specific codebase exceeds these budgets, the first optimization is narrowing the file set — most rules don't need to scan the entire project.

---

## 14. Testing Strategy for the Tool Itself

### 14.1 Fixture-Based Tests

Each predicate and condition is tested against small, self-contained TypeScript fixture files:

```
tests/
├── fixtures/
│   ├── classes/
│   │   ├── extends-base.ts         # class Foo extends Base {}
│   │   ├── with-decorator.ts       # @Injectable() class Bar {}
│   │   └── no-decorator.ts         # class Baz {}
│   ├── functions/
│   │   ├── async-function.ts       # export async function foo() {}
│   │   ├── calls-target.ts         # function bar() { doSomething() }
│   │   └── no-calls.ts             # function baz() { return 1 }
│   ├── types/
│   │   ├── typed-property.ts       # interface Opts { orderBy: 'a' | 'b' }
│   │   └── untyped-property.ts     # interface Opts { orderBy: string }
│   └── modules/
│       ├── imports-from-domain.ts   # import { Foo } from '../domain/foo'
│       └── clean-imports.ts         # import { Bar } from '../utils/bar'
├── predicates/
│   ├── identity.test.ts
│   ├── class.test.ts
│   ├── function.test.ts
│   ├── type.test.ts
│   └── call.test.ts
├── conditions/
│   ├── structural.test.ts
│   ├── dependency.test.ts
│   ├── body-analysis.test.ts
│   ├── type-level.test.ts
│   └── slice.test.ts
└── integration/
    ├── full-rule-chain.test.ts     # end-to-end: project -> predicate -> condition -> check
    └── violation-reporting.test.ts  # verify violation messages, code frames, suggestions
```

### 14.2 Testing Principles

- **Each predicate has positive and negative fixtures.** `extend('Base')` must match `class Foo extends Base` and must NOT match `class Bar extends Other`.
- **Each condition has passing and violating fixtures.** `notContain(call('parseInt'))` must pass on a fixture without `parseInt` and fail on one with it.
- **Violation messages are asserted.** The test checks not just that a violation occurred, but that the file path, line number, message, code frame, and suggestion are correct.
- **Integration tests use realistic multi-file fixtures** that mimic real project structures.
- **No mocking of ts-morph.** Tests use real ts-morph `Project` instances pointed at fixture files. This ensures the DSL works against real TypeScript, not a simplified model.

---

## 15. Phased Delivery

### Phase 1: Core (MVP)

- Project loader + query engine (ts-morph)
- Entry points: `modules()`, `classes()`, `functions()`, `types()`
- Named selections (reusable queries)
- Identity predicates: `haveNameMatching`, `resideInFolder`, `areExported`
- Class predicates: `extend`, `haveDecorator`
- Dependency conditions: `onlyImportFrom`, `notImportFrom`, `notReference`
- Body analysis (AST-level): `contain(call())`, `notContain(call())`, `useInsteadOf()`
- `expression()` as labeled escape hatch
- Slice conditions: `beFreeOfCycles`, `respectLayerOrder`
- Semantic type conditions: `havePropertyType` with `not(isString())`, `isUnionOfLiterals()`
- Rule severity: `.check()` vs `.warn()`
- Violation reporting with code frames and suggestions
- vitest integration
- Custom predicates/conditions via `definePredicate` / `defineCondition`
- Baseline mode (`--baseline`) for gradual adoption

### Phase 2: Call Expressions + Patterns + Smells

- Entry point: `calls()`
- Call predicates: `onObject`, `withMethod`, `withStringArg`, `haveCallbackContaining`
- Scoped rules: `within()` for context-scoped enforcement
- Argument-level matching: `call('foo').withArgument(access('x.y'))`
- Symbol-aware matching: `symbolOf()`, `resolvesTo()` (type-checker-backed)
- Pattern templates: `definePattern`, `followPattern`
- Built-in smell detectors with guardrails: duplicate bodies, inconsistent siblings
- Diff-aware mode (`--changed` with full evaluation / filtered reporting)
- Output formats: terminal, JSON, GitHub annotations

### Phase 3: GraphQL Extension

- Schema loader (`.graphql` files + programmatic SDL)
- Schema predicates and conditions
- Resolver-to-schema cross-referencing
- Shipped as `ts-archunit/graphql` (separate entry point, optional dependency on `graphql` package)

### Phase 4: Cross-Layer + Ecosystem

- Cross-layer validation
- CLI standalone runner
- Watch mode

---

## 16. Dependencies

| Package | Purpose | Required in |
|---|---|---|
| `ts-morph` | TypeScript AST analysis, type checker | Core |
| `picomatch` | Glob pattern matching | Core |
| `graphql` | GraphQL schema parsing | Phase 3 (optional peer dep) |
| `vitest` / `jest` | Test runner integration | Core (peer dep) |

No runtime dependencies beyond ts-morph and a glob matcher. The tool is a dev dependency.

---

## 17. Name

**ts-archunit** — clear lineage from Java's ArchUnit, instantly communicates purpose. If the project outgrows the ArchUnit comparison (which the GraphQL and cross-layer features suggest), consider renaming.
