# BUG-0007: not() matcher crashes with haveReturnTypeMatching

**Type:** Bug
**Date:** 2026-03-27
**Version:** 0.3.0
**Status:** Fixed

## Problem

`haveReturnTypeMatching(not(matching(/void/)))` throws `TypeError: matcher is not a function`.

The `not()` type matcher composes correctly with `acceptParameterOfType` but fails with `haveReturnTypeMatching`.

## Reproduction

```typescript
import { functions, matching, not } from '@nielspeter/ts-archunit'

functions(p)
  .that()
  .haveNameMatching(/^create\w+/)
  .should()
  .haveReturnTypeMatching(not(matching(/void/))) // TypeError: matcher is not a function
  .check()
```

## Expected

`not(matching(/void/))` should return a `TypeMatcher` that `haveReturnTypeMatching` accepts — same as it works with `acceptParameterOfType`.

## Root Cause

The public API exported two different `not` functions:

- `not` from `core/predicate.ts` — takes a `Predicate<T>` object (has `.description` and `.test()`), returns a `Predicate<T>`
- `not` from `helpers/type-matchers.ts` — takes a `TypeMatcher` function `(type: Type) => boolean`, returns a `TypeMatcher`

The public `not` resolved to the predicate combinator. When a user wrote `not(matching(/void/))`, the predicate `not` wrapped the TypeMatcher function into a Predicate object. `haveReturnTypeMatching` then tried to call that object as a function → `TypeError`.

The same issue affected `and` and `or` — any combinator from the public API only worked with Predicates, not TypeMatchers.

## Fix

Created `src/core/combinators.ts` with unified `not`, `and`, `or` that dispatch based on input type:

- Given a `TypeMatcher` (function) → returns a `TypeMatcher`
- Given a `Predicate<T>` (object) → returns a `Predicate<T>`

The public API now exports these unified versions. Removed the `notType` alias.

## Files Changed

- `src/core/combinators.ts` — new: unified `not`, `and`, `or`
- `src/index.ts` — exports from combinators.ts, removed `notType`
- `tests/integration/function-rules.test.ts` — imports from public API, added `and`/`or` tests
- `tests/integration/class-entry-point.test.ts` — imports from public API, added combinator tests
- `tests/integration/class-type-predicates.test.ts` — imports from public API
- `tests/integration/coverage-gaps.test.ts` — imports from public API
