# ADR-003: Fluent Builder Pattern for the Rule DSL

## Status

**Accepted** (March 2026)

## Context

ts-archunit needs a developer-facing API for expressing architecture rules. The API must:

1. Be readable — rules should read like English sentences describing architectural intent
2. Be discoverable — IDE autocomplete should guide users through valid rule construction
3. Be composable — predicates and conditions combine naturally
4. Be type-safe — invalid rule chains should fail at compile time, not runtime
5. Map to Java ArchUnit's proven API — developers familiar with ArchUnit should feel at home

The API design directly determines adoption. A good rule reads like documentation; a bad one reads like configuration boilerplate.

## Decision

**We will use a fluent builder pattern with method chaining.**

```typescript
// The shape: entry(project).that().<predicate>.should().<condition>.check()
classes(p)
  .that().extend('BaseRepository')
  .and().resideInFolder('src/repositories/**')
  .should().notContain(call('parseInt'))
  .andShould().contain(call('this.extractCount'))
  .because('use this.extractCount() from BaseRepository')
  .check()
```

The chain has a fixed grammar:

```
entry(project)         → SubjectBuilder     (what are we querying?)
  .that()              → PredicateBuilder   (filter: which elements?)
  .and()               → PredicateBuilder   (narrow further)
  .should()            → ConditionBuilder   (assert: what must be true?)
  .andShould()         → ConditionBuilder   (additional assertions)
  .orShould()          → ConditionBuilder   (alternative assertions)
  .because(reason)     → FinalBuilder       (human rationale)
  .check()             → void (throws)      (execute and throw on violations)
  .warn()              → void               (execute and log, don't throw)
```

Each transition returns a different builder type, so the IDE only shows valid next methods:

```typescript
// After .that() — only predicates are available
classes(p).that().extend(...)        // ✅
classes(p).that().check()            // ❌ TypeScript error

// After .should() — only conditions are available
classes(p).that().extend('Base').should().notContain(...)   // ✅
classes(p).that().extend('Base').should().extend(...)       // ❌ TypeScript error (extend is a predicate, not a condition)

// After .check() — nothing (terminal)
classes(p).that().extend('Base').should().notContain(call('x')).check().something()  // ❌ void
```

## Consequences

### Positive

**Reads like English:**
```typescript
// "Classes that extend BaseRepository should not contain calls to parseInt"
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()

// "Types that have property orderBy should have property type not string"
types(p).that().haveProperty('orderBy').should().havePropertyType('orderBy', not(isString())).check()

// "Functions that have name matching parseXxxOrder and reside in routes should not exist"
functions(p).that().haveNameMatching(/^parse\w+Order$/).and().resideInFolder('src/routes/**').should().notExist().check()
```

**Direct mapping from Java ArchUnit:**
```java
// Java ArchUnit
classes().that().resideInAnyPackage("..repository..")
  .should().onlyBeAccessed().byAnyPackage("..service..", "..config..")
  .check(classes);

// ts-archunit — same structure, TypeScript idioms
classes(p).that().resideInFolder('src/repositories/**')
  .should().onlyBeAccessedBy('src/services/**', 'src/config/**')
  .check()
```

Developers who've used Java ArchUnit (like the mimer project's 80+ rules) can transfer their mental model directly.

**IDE-guided discovery:**
- After typing `classes(p).that().`, autocomplete shows: `extend`, `implement`, `haveDecorator`, `haveNameMatching`, `resideInFolder`, etc.
- After typing `.should().`, autocomplete shows: `notContain`, `contain`, `resideInFile`, `haveNameMatching`, `notExist`, etc.
- Invalid chains are compile-time errors, not runtime surprises

**Named selections for reuse:**
```typescript
// Save a predicate chain — no .should() yet, so it's a reusable query
const repositories = classes(p).that().extend('BaseRepository')

// Use in multiple rules
repositories.should().notContain(call('parseInt')).check()
repositories.should().notContain(newExpr('Error')).check()
```

This is natural with the builder pattern — the intermediate builder object IS the named selection.

**Composable with custom predicates:**
```typescript
const isRouteHandler = definePredicate<FunctionDeclaration>(
  'is a route handler',
  (fn) => fn.getDecorators().some(d => d.getName() === 'Get')
)

// .satisfy() plugs in seamlessly
functions(p).that().satisfy(isRouteHandler).should().contain(call('handleError')).check()
```

### Negative

**TypeScript generics complexity:**
- The builder types need careful generic threading to ensure type safety across chains
- `ClassRuleBuilder` → `ClassPredicateBuilder` → `ClassConditionBuilder` — each with the right method set
- Mitigation: this complexity is internal. Users see clean method chains.

**Long chains can be hard to read:**
```typescript
// This is pushing it
classes(p)
  .that().extend('BaseRepository')
  .and().resideInFolder('src/repositories/**')
  .and().haveNameEndingWith('Repository')
  .and().areNotAbstract()
  .should().notContain(call('parseInt'))
  .andShould().contain(call('this.extractCount'))
  .andShould().notContain(newExpr('Error'))
  .because('repositories must use shared helpers')
  .check()
```
- Mitigation: named selections break long chains. Also, this is a feature — the chain IS the specification.

**Method explosion:**
- Each entry point (classes, functions, types, modules, calls, slices) needs its own builder with its own predicate/condition methods
- 6 entry points × ~10 predicates × ~10 conditions = ~200 methods total
- Mitigation: shared base classes (identity predicates), good code organization (spec Section 13)

## Alternatives Considered

### Alternative 1: Configuration Objects

```typescript
checkRule({
  entry: 'classes',
  predicates: [
    { type: 'extend', value: 'BaseRepository' },
    { type: 'resideInFolder', value: 'src/repositories/**' }
  ],
  conditions: [
    { type: 'notContain', value: call('parseInt') }
  ],
  because: 'use this.extractCount()',
  severity: 'error'
})
```

**Pros:**
- Easy to serialize (JSON-compatible)
- Easy to generate programmatically
- No builder type complexity

**Cons:**
- No IDE autocomplete for valid predicate/condition combinations
- No compile-time safety — typo in `'notContian'` is a runtime error
- Reads like configuration, not like a specification
- Ugly compared to fluent chain
- No direct mapping from Java ArchUnit

**Rejected because:** The whole point is that rules should read like architectural specifications, not like JSON config. IDE discoverability is critical for adoption.

### Alternative 2: Tagged Template Literals

```typescript
arch`
  classes extending BaseRepository
  in folder src/repositories/**
  should not contain call(parseInt)
  because "use this.extractCount()"
`
```

**Pros:**
- Most readable — literally English
- Compact

**Cons:**
- No IDE autocomplete or type safety inside template literals
- Requires a custom parser for the template DSL
- Error messages for invalid rules are terrible ("parse error at position 47")
- Can't compose with TypeScript functions (`definePredicate` wouldn't work)
- Regex/glob arguments need escaping rules
- Completely different from Java ArchUnit

**Rejected because:** Trading type safety and IDE support for slightly prettier syntax is the wrong tradeoff for a developer tool. The fluent builder is almost as readable AND gives full TypeScript support.

### Alternative 3: Function Composition (pipe-based)

```typescript
pipe(
  classes(p),
  where(extend('BaseRepository')),
  where(resideInFolder('src/repositories/**')),
  assert(notContain(call('parseInt'))),
  because('use this.extractCount()'),
  check
)
```

**Pros:**
- Functional style — no mutable builder state
- Each function is independently testable
- Tree-shakeable

**Cons:**
- Less readable than method chaining for this use case
- Requires importing many small functions
- No natural place for `.and()` vs `.or()` semantics
- Unfamiliar to Java ArchUnit users
- IDE autocomplete for pipe arguments is weaker than method chains

**Rejected because:** The fluent builder is more natural for expressing rule chains. Pipe composition works great for data transformation but feels forced for declarative rule specification.

## Notes

- The `.that()` and `.should()` methods exist purely for readability — they could be omitted (`classes(p).extend('Base').notContain(call('parseInt')).check()`) but the explicit transition markers make rules self-documenting
- `.because()` is optional but strongly encouraged — violation messages include the rationale
- `.check()` vs `.warn()` is the terminal method — everything before it is lazy (no evaluation until terminal)
- Named selections are lazy — the predicate chain is evaluated when `.check()` is called, not when the selection is defined
