# Plan 0003: Predicate Engine & Identity Predicates

**Status:** Not Started
**Priority:** P0 — Foundation layer, required by all rule builders
**Effort:** 1-2 days
**Created:** 2026-03-25
**Depends on:** Plan 0002 (Project Loader & Query Engine)

---

## Purpose

Implement the `Predicate<T>` interface and identity predicates shared across all entry points. Predicates are the core filtering mechanism — every rule starts with `.that(predicate)` to narrow the set of architectural elements before conditions are evaluated.

This plan delivers:

1. The `Predicate<T>` interface — the foundational building block for all filtering
2. Predicate combinators — `and()`, `or()`, `not()` for composing predicates
3. Identity predicates — name matching, file/folder matching, export checks — that work across all ts-morph node types (classes, functions, interfaces, types) via structural typing

After this plan, downstream plans (0004-0013) can define type-specific predicates that compose with these identity predicates using the combinators.

---

## Phase 1: Predicate Interface & Combinators

### `src/core/predicate.ts`

The `Predicate<T>` interface is intentionally minimal. The `description` field enables readable violation messages. The `test` method is a pure function — no side effects, no context required.

```typescript
/**
 * A predicate that tests whether an architectural element matches a condition.
 * Used in `.that()` clauses to filter elements before rule evaluation.
 */
export interface Predicate<T> {
  /** Human-readable description for violation messages, e.g. "have name matching /^parse/" */
  readonly description: string
  /** Returns true if the element matches this predicate. */
  test(element: T): boolean
}
```

Predicate combinators compose predicates while preserving readable descriptions:

```typescript
/**
 * Returns a predicate that matches when ALL given predicates match.
 * Description: "have name matching /foo/ and are exported"
 */
export function and<T>(...predicates: Predicate<T>[]): Predicate<T> {
  return {
    description: predicates.map((p) => p.description).join(' and '),
    test: (element) => predicates.every((p) => p.test(element)),
  }
}

/**
 * Returns a predicate that matches when ANY given predicate matches.
 * Description: "have name matching /foo/ or have name matching /bar/"
 */
export function or<T>(...predicates: Predicate<T>[]): Predicate<T> {
  return {
    description: predicates.map((p) => p.description).join(' or '),
    test: (element) => predicates.some((p) => p.test(element)),
  }
}

/**
 * Returns a predicate that matches when the given predicate does NOT match.
 * Description: "not (are exported)"
 */
export function not<T>(predicate: Predicate<T>): Predicate<T> {
  return {
    description: `not (${predicate.description})`,
    test: (element) => !predicate.test(element),
  }
}
```

---

## Phase 2: Structural Type Constraints

Identity predicates work across multiple ts-morph node types. Rather than importing concrete ts-morph types, we use TypeScript structural typing. This keeps the predicate layer decoupled from ts-morph internals and makes unit testing trivial (plain objects satisfy the interfaces).

### `src/predicates/identity.ts`

```typescript
import type { SourceFile } from 'ts-morph'

/** Types that have a name — ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, etc. */
export interface Named {
  getName(): string | undefined
}

/** Types that have a source file — any ts-morph Node. */
export interface Located {
  getSourceFile(): SourceFile
}

/** Types that can be exported — ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, etc. */
export interface Exportable {
  isExported(): boolean
}
```

These structural interfaces match the shapes that ts-morph node types already satisfy. No wrappers, no adapters — `ClassDeclaration` structurally satisfies all three.

---

## Phase 3: Name Predicates

Name predicates constrain `T extends Named`. They handle the `undefined` case (anonymous nodes) by returning `false`.

```typescript
import type { Predicate } from '../core/predicate.js'
import type { Named } from './identity.js'

/**
 * Matches elements whose name matches the given pattern.
 * - RegExp: tested against the name directly
 * - string: converted to RegExp (e.g. 'Service$' becomes /Service$/)
 */
export function haveNameMatching<T extends Named>(pattern: RegExp | string): Predicate<T> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return {
    description: `have name matching ${regex}`,
    test: (element) => {
      const name = element.getName()
      return name !== undefined && regex.test(name)
    },
  }
}

/**
 * Matches elements whose name starts with the given prefix.
 */
export function haveNameStartingWith<T extends Named>(prefix: string): Predicate<T> {
  return {
    description: `have name starting with "${prefix}"`,
    test: (element) => {
      const name = element.getName()
      return name !== undefined && name.startsWith(prefix)
    },
  }
}

/**
 * Matches elements whose name ends with the given suffix.
 */
export function haveNameEndingWith<T extends Named>(suffix: string): Predicate<T> {
  return {
    description: `have name ending with "${suffix}"`,
    test: (element) => {
      const name = element.getName()
      return name !== undefined && name.endsWith(suffix)
    },
  }
}
```

---

## Phase 4: File & Folder Predicates

File and folder predicates constrain `T extends Located`. They use picomatch for glob matching against absolute file paths. The `**/` prefix in glob patterns handles absolute path matching naturally — this is the same approach validated in the PoC (probe 1).

```typescript
import picomatch from 'picomatch'
import type { Predicate } from '../core/predicate.js'
import type { Located } from './identity.js'

/**
 * Matches elements that reside in a file matching the given glob.
 * The glob is matched against the absolute file path using picomatch.
 *
 * @example
 * resideInFile('** /routes.ts')   // matches /abs/path/src/routes.ts
 * resideInFile('** /src/*.ts')    // matches any .ts file directly in src/
 */
export function resideInFile<T extends Located>(glob: string): Predicate<T> {
  const isMatch = picomatch(glob)
  return {
    description: `reside in file matching "${glob}"`,
    test: (element) => isMatch(element.getSourceFile().getFilePath()),
  }
}

/**
 * Matches elements that reside in a folder matching the given glob.
 * The glob is matched against the directory portion of the absolute file path.
 *
 * @example
 * resideInFolder('** /routes/**')   // matches files anywhere under a routes/ folder
 * resideInFolder('** /src/services/**')
 */
export function resideInFolder<T extends Located>(glob: string): Predicate<T> {
  const isMatch = picomatch(glob)
  return {
    description: `reside in folder matching "${glob}"`,
    test: (element) => {
      const filePath = element.getSourceFile().getFilePath()
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'))
      return isMatch(dirPath)
    },
  }
}
```

Note: `resideInFolder` extracts the directory from the file path and matches the glob against that. This distinguishes "file is in this folder" from "file name matches this pattern".

---

## Phase 5: Export Predicates

Export predicates constrain `T extends Exportable`.

```typescript
import type { Predicate } from '../core/predicate.js'
import type { Exportable } from './identity.js'

/**
 * Matches elements that are exported from their module.
 */
export function areExported<T extends Exportable>(): Predicate<T> {
  return {
    description: 'are exported',
    test: (element) => element.isExported(),
  }
}

/**
 * Matches elements that are NOT exported from their module.
 */
export function areNotExported<T extends Exportable>(): Predicate<T> {
  return {
    description: 'are not exported',
    test: (element) => !element.isExported(),
  }
}
```

---

## Phase 6: Barrel Exports

### `src/predicates/index.ts`

Re-export all identity predicates and the structural type constraints:

```typescript
export type { Named, Located, Exportable } from './identity.js'
export {
  haveNameMatching,
  haveNameStartingWith,
  haveNameEndingWith,
  resideInFile,
  resideInFolder,
  areExported,
  areNotExported,
} from './identity.js'
```

### `src/core/index.ts`

Re-export the predicate interface and combinators:

```typescript
export type { Predicate } from './predicate.js'
export { and, or, not } from './predicate.js'
```

### `src/index.ts`

Update the public API barrel:

```typescript
// Core
export type { Predicate } from './core/index.js'
export { and, or, not } from './core/index.js'

// Identity predicates
export type { Named, Located, Exportable } from './predicates/index.js'
export {
  haveNameMatching,
  haveNameStartingWith,
  haveNameEndingWith,
  resideInFile,
  resideInFolder,
  areExported,
  areNotExported,
} from './predicates/index.js'
```

---

## Files Changed

| File                                | Change   | Purpose                                                                                  |
| ----------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `src/core/predicate.ts`             | New      | `Predicate<T>` interface, `and()`, `or()`, `not()` combinators                           |
| `src/core/index.ts`                 | New      | Barrel export for core module                                                            |
| `src/predicates/identity.ts`        | New      | `Named`, `Located`, `Exportable` interfaces + all 7 identity predicate factory functions |
| `src/predicates/index.ts`           | New      | Barrel export for predicates module                                                      |
| `src/index.ts`                      | Modified | Re-export public API from core + predicates                                              |
| `tests/predicates/identity.test.ts` | New      | Unit tests with mock objects + integration tests with ts-morph fixtures                  |

---

## Test Inventory

### `tests/predicates/identity.test.ts`

All tests grouped by category. Unit tests use plain objects satisfying the structural interfaces. Integration tests use the PoC fixtures at `tests/fixtures/poc/`.

#### Predicate interface & combinators

| #   | Test                                                              | Type |
| --- | ----------------------------------------------------------------- | ---- |
| 1   | `Predicate` — `test()` returns boolean, `description` is readable | Unit |
| 2   | `and()` — returns true only when all predicates match             | Unit |
| 3   | `and()` — description joins with " and "                          | Unit |
| 4   | `and()` — short-circuits on first false (verify with spy)         | Unit |
| 5   | `or()` — returns true when any predicate matches                  | Unit |
| 6   | `or()` — description joins with " or "                            | Unit |
| 7   | `not()` — inverts the predicate result                            | Unit |
| 8   | `not()` — description wraps with "not (...)"                      | Unit |
| 9   | Nested composition — `and(not(p1), or(p2, p3))` works correctly   | Unit |

#### `haveNameMatching`

| #   | Test                                                                | Type        |
| --- | ------------------------------------------------------------------- | ----------- |
| 10  | Matches class name with RegExp `/Service$/`                         | Unit        |
| 11  | Does not match class with non-matching name                         | Unit        |
| 12  | Handles string pattern — converts to RegExp                         | Unit        |
| 13  | Returns false for unnamed element (`getName()` returns `undefined`) | Unit        |
| 14  | Against ts-morph: matches `OrderService` from `good-service.ts`     | Integration |
| 15  | Against ts-morph: matches `parseFooOrder` function from `routes.ts` | Integration |

#### `haveNameStartingWith` / `haveNameEndingWith`

| #   | Test                                                                          | Type        |
| --- | ----------------------------------------------------------------------------- | ----------- |
| 16  | `haveNameStartingWith('parse')` matches `parseFooOrder`                       | Unit        |
| 17  | `haveNameStartingWith('parse')` does not match `listItems`                    | Unit        |
| 18  | `haveNameEndingWith('Service')` matches `OrderService`                        | Unit        |
| 19  | `haveNameEndingWith('Service')` does not match `DomainError`                  | Unit        |
| 20  | Both return false for unnamed elements                                        | Unit        |
| 21  | Against ts-morph: `haveNameEndingWith('Service')` finds all 4 service classes | Integration |

#### `resideInFile`

| #   | Test                                                                           | Type                          |
| --- | ------------------------------------------------------------------------------ | ----------------------------- |
| 22  | Matches file path with glob `**/routes.ts`                                     | Unit (mock `getSourceFile()`) |
| 23  | Does not match non-matching file path                                          | Unit                          |
| 24  | Against ts-morph: classes from `bad-service.ts` matched by `**/bad-service.ts` | Integration                   |
| 25  | Against ts-morph: `**/src/*.ts` matches all fixture source files               | Integration                   |

#### `resideInFolder`

| #   | Test                                                                                  | Type        |
| --- | ------------------------------------------------------------------------------------- | ----------- |
| 26  | Matches directory portion of file path                                                | Unit        |
| 27  | Does not match when file is in different folder                                       | Unit        |
| 28  | Glob `**/poc/src` matches fixture files in `tests/fixtures/poc/src/`                  | Integration |
| 29  | Glob `**/nonexistent/**` matches nothing                                              | Integration |
| 30  | Handles nested folders correctly — `**/fixtures/**` matches `tests/fixtures/poc/src/` | Integration |

#### `areExported` / `areNotExported`

| #   | Test                                                              | Type        |
| --- | ----------------------------------------------------------------- | ----------- |
| 31  | `areExported()` returns true for exported element                 | Unit        |
| 32  | `areExported()` returns false for non-exported element            | Unit        |
| 33  | `areNotExported()` inverts — true for non-exported                | Unit        |
| 34  | Against ts-morph: `OrderService` is exported                      | Integration |
| 35  | Against ts-morph: `StrictOptions` in `options.ts` is NOT exported | Integration |

#### Edge cases

| #   | Test                                                                                     | Type        |
| --- | ---------------------------------------------------------------------------------------- | ----------- |
| 36  | Anonymous class expression — `getName()` returns undefined, name predicates return false | Integration |
| 37  | Composing identity predicates: `and(haveNameEndingWith('Service'), areExported())`       | Integration |
| 38  | Composing with not: `not(areExported())` equivalent to `areNotExported()`                | Unit        |
| 39  | Empty predicate list: `and()` with no predicates returns true (vacuous truth)            | Unit        |
| 40  | Empty predicate list: `or()` with no predicates returns false                            | Unit        |

---

## Out of Scope

- **Type-specific predicates** — `extend()`, `implement()`, `areAsync()`, etc. are defined in their respective entry point plans (0008-0010)
- **Rule builder integration** — `.that(predicate)` is wired up in plan 0005
- **Condition interface** — `Condition<T>` is plan 0004
- **PredicateContext / project root** — not needed for identity predicates; file/folder matching uses picomatch with `**/` prefix against absolute paths (validated in PoC probe 1)
- **Custom predicates API** — `definePredicate()` is plan 0013
- **Memoization / caching** — predicate result caching is plan 0002's responsibility
- **SourceFile predicates** — `resideInFile`/`resideInFolder` on SourceFile nodes (where the element IS the file) will be addressed in plan 0007 (Module Entry Point)
