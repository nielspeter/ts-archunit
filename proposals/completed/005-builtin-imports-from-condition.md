# Proposal 005 — Built-in "Must Import From" Condition

**Status:** Implemented
**Implemented:** 2026-04-12
**Summary:** `dependOn(...globs)` condition shipped in `src/conditions/dependency.ts`.
Uses picomatch globs and supports `ImportOptions` (`{ ignoreTypeImports }`),
consistent with `onlyImportFrom` and `notImportFrom`. Exported from `src/index.ts`.
Docs updated in `modules.md`, `what-to-check.md`, `api-reference.md`. 8 tests.

**Priority:** Medium
**Affects:** Module-level rules

## Problem

The import-condition family in `src/conditions/dependency.ts` has two
members:

- `onlyImportFrom(...globs)` — **all** imports must match the globs
- `notImportFrom(...globs)` — **no** imports may match the globs

The logical third member is missing: **at least one** import must match.
This completes the set (`all`, `none`, `at least one`).

Teams need to enforce structural guarantees like:

- "The app entry point must import the security middleware"
- "Test setup files must import the assertion library"
- "Every service module must import from the logging package"

Without a built-in condition, users can compose existing primitives:

```ts
modules(p)
  .that()
  .resideInFile('**/server.ts')
  .and(not(importFrom('**/security-middleware/**')))
  .should()
  .satisfy(notExist())
  .check()
```

This works but reads backwards ("find modules that DON'T import X, then
assert they don't exist"). A direct condition is clearer.

## Proposed API

```ts
import { dependOn } from '@nielspeter/ts-archunit'

// Glob match (picomatch, consistent with onlyImportFrom/notImportFrom)
modules(p)
  .that()
  .resideInFile('**/server.ts')
  .should()
  .satisfy(dependOn('**/security-middleware/**'))
  .check()

// With ImportOptions (consistent with all other import conditions)
modules(p)
  .that()
  .resideInFile('**/server.ts')
  .should()
  .satisfy(dependOn(['**/logging/**'], { ignoreTypeImports: true }))
  .check()
```

**Naming:** `dependOn` rather than `importsFrom` — avoids a one-character
collision with the existing `importFrom` predicate
(`src/predicates/module.ts:34`). The predicate filters ("modules that
import from X"), the condition asserts ("modules should depend on X").
Different verbs for different roles.

**Matching semantics:** Uses picomatch globs against resolved absolute
paths, identical to `onlyImportFrom()` and `notImportFrom()`. This is
important for consistency — all three conditions in the family must use
the same matching model.

**`ImportOptions` support:** Accepts `{ ignoreTypeImports }` like every
other import condition/predicate (`onlyImportFrom`, `notImportFrom`,
`importFrom`, `notImportFrom` predicate). A `dependOn` without this
would be inconsistent — "must depend on logging" should let users
specify whether `import type { Logger }` counts.

**Overload signature** (matching existing pattern in `dependency.ts`):

```ts
export function dependOn(globs: string[], options: ImportOptions): Condition<SourceFile>
export function dependOn(...globs: string[]): Condition<SourceFile>
```

## Scope

Small — ~30 lines of condition code mirroring the existing patterns in
`conditions/dependency.ts`. Uses `resolveImportPath()` and
`importViolation()` already defined in that file. The condition checks
that at least one import resolves to a path matching any of the globs.

Lives in `conditions/dependency.ts` alongside `onlyImportFrom` /
`notImportFrom`. Exported from `src/index.ts`.

## Documentation

### `docs/modules.md`

Add `dependOn()` to the Available Conditions table:

| `dependOn(...globs)` | Module must import from at least one path matching a glob | `.should().satisfy(dependOn('**/logging/**'))` |

Add a "Required Dependencies" example in the Real-World Examples section:

```ts
// Every service must import from the logging package
modules(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(dependOn('**/logging/**'))
  .because('services must use structured logging')
  .check()
```

### `docs/recipes.md`

Add a "Required Dependencies" recipe under a new section or alongside
the existing boundary rules:

```ts
// Entry point must import security middleware
modules(p)
  .that()
  .resideInFile('**/server.ts')
  .should()
  .satisfy(dependOn('**/security-middleware/**'))
  .because('server must initialize security before handling requests')
  .check()
```

### `docs/what-to-check.md`

Add a one-liner:

```ts
// Server must depend on security middleware
modules(p).that().resideInFile('**/server.ts').should().satisfy(dependOn('**/security/**')).check()
```

### `docs/api-reference.md`

Add `dependOn` to the Dependency Conditions table:

| `dependOn` | `dependOn(...globs)` / `dependOn(globs[], options)` | Module must import from at least one path matching a glob. |

### `src/conditions/dependency.ts`

JSDoc on the function following the existing pattern (see `onlyImportFrom`
at line 47):

```ts
/**
 * Module must import from at least one path matching a glob.
 * Completes the import-condition family: onlyImportFrom (all),
 * notImportFrom (none), dependOn (at least one).
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('**/ services
/**')
 *   .should().satisfy(dependOn('**/ logging /**'))
 *   .check()
 */
```

### `CHANGELOG.md`

Add under `### Added`:

- `dependOn(...globs)` condition — assert that a module imports from at
  least one path matching the given globs. Completes the import-condition
  family alongside `onlyImportFrom` and `notImportFrom`.
