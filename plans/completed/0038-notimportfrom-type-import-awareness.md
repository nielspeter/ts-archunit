# Plan 0038: `notImportFrom` Type-Import Awareness

## Status

- **State:** Done
- **Priority:** P1 — False positives on isolation rules
- **Effort:** 0.5 day
- **Created:** 2026-03-28
- **Depends on:** 0007 (Module Entry Point & Dependency Conditions)

## Problem

`notImportFrom()` and `onlyImportFrom()` treat `import type { X }` the same as `import { X }`. Type-only imports are erased at runtime and create no actual dependency, but they trigger violations on isolation rules.

Real-world impact: a user had to exclude `/services\//` from BullMQ isolation rules because services use `import type { Queue }` for dependency injection typing. The import is safe — it's erased at compile time — but `notImportFrom` flags it.

`onlyHaveTypeImportsFrom()` already checks `decl.isTypeOnly()` (line 166 in `dependency.ts`), proving the pattern works. The gap is that the other import conditions don't have this awareness.

## Design

### Add `{ ignoreTypeImports?: boolean }` option to import conditions

Extend the existing conditions with an optional config parameter:

```ts
// Before (no way to exclude type imports)
notImportFrom('**/infra/**')

// After (opt-in to exclude type imports)
notImportFrom('**/infra/**', { ignoreTypeImports: true })
```

Default is `false` (current behavior) for backward compatibility.

### Affected conditions

| Condition                  | File                           | Change                               |
| -------------------------- | ------------------------------ | ------------------------------------ |
| `notImportFrom` condition  | `src/conditions/dependency.ts` | Add option, skip `decl.isTypeOnly()` |
| `onlyImportFrom` condition | `src/conditions/dependency.ts` | Add option, skip `decl.isTypeOnly()` |
| `notImportFrom` predicate  | `src/predicates/module.ts`     | Add option, filter type-only imports |
| `importFrom` predicate     | `src/predicates/module.ts`     | Add option, filter type-only imports |

### Why an option, not a new function?

- Adding `notImportValueFrom()` creates naming proliferation and a confusing matrix of import conditions.
- An options object is extensible — future flags (e.g., `{ ignoreSideEffectImports }`) can be added without new functions.
- The `ignoreTypeImports` name is self-documenting.

### ts-morph API

`ImportDeclaration.isTypeOnly()` returns `true` for `import type { X }`. It does NOT cover individual type-imported specifiers in mixed imports (`import { type X, Y }`). For mixed imports, each specifier must be checked via `ImportSpecifier.isTypeOnly()`. The implementation should handle both forms:

```ts
function isTypeOnlyImport(decl: ImportDeclaration): boolean {
  // Full type-only import: import type { X } from '...'
  if (decl.isTypeOnly()) return true
  // Mixed import where ALL specifiers are type-only: import { type X, type Y } from '...'
  const specifiers = decl.getNamedImports()
  return specifiers.length > 0 && specifiers.every((s) => s.isTypeOnly())
}
```

### Builder integration

The variadic rest + trailing options pattern (`...args: [...string[], Options]`) doesn't infer cleanly in TypeScript. Use a proper two-overload approach on the condition factories:

```ts
// Overload 1: existing variadic (backward compatible)
export function notImportFrom(...globs: string[]): Condition<SourceFile>
// Overload 2: array + options
export function notImportFrom(globs: string[], options: ImportOptions): Condition<SourceFile>
```

The implementation distinguishes by checking `Array.isArray(args[0])`. The builder methods follow the same pattern:

```ts
// In ModuleRuleBuilder
notImportFrom(...globs: string[]): this                              // existing
notImportFrom(globs: string[], options: ImportOptions): this         // new overload
```

Usage:

```ts
// Simple (existing, unchanged)
modules(p).should().notImportFrom('**/infra/**').check()

// With options (new)
modules(p).should().notImportFrom(['**/infra/**'], { ignoreTypeImports: true }).check()
```

### Relationship with `onlyHaveTypeImportsFrom`

These are complements, not duplicates. Document the distinction:

- `onlyHaveTypeImportsFrom('**/infra/**')` — "imports from infra MUST use `import type`" (enforcement: every import from these paths must be type-only)
- `notImportFrom(['**/infra/**'], { ignoreTypeImports: true })` — "no runtime imports from infra" (enforcement: type-only imports are allowed, value imports are forbidden)

Add this comparison to the docs and JSDoc.

### Mixed import limitation

`import { type X, Y }` (mixed: one type specifier, one runtime) is still flagged as a violation because it has a runtime import (`Y`). This is correct behavior — the import creates a runtime dependency. Document explicitly: "mixed imports with any runtime specifier are treated as runtime imports."

## Files changed

| File                                           | Change                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `src/conditions/dependency.ts`                 | Add `ignoreTypeImports` option to `notImportFrom`, `onlyImportFrom` |
| `src/predicates/module.ts`                     | Add `ignoreTypeImports` option to `importFrom`, `notImportFrom`     |
| `src/builders/module-rule-builder.ts`          | Update method signatures with overloads                             |
| `src/index.ts`                                 | Export `ImportOptions` type                                         |
| `tests/conditions/dependency.test.ts`          | Add tests for type-import filtering                                 |
| `tests/fixtures/modules/src/`                  | Add fixture with `import type` declarations                         |
| `tests/integration/module-entry-point.test.ts` | Integration test                                                    |
| `docs/api-reference.md`                        | Update condition signatures, add relationship note                  |

## Test inventory

- `notImportFrom('**/infra/**')` still flags `import type { X }` (default behavior preserved)
- `notImportFrom('**/infra/**', { ignoreTypeImports: true })` skips `import type { X }`
- Mixed import `import { type X, Y }` is NOT skipped (has runtime import `Y`)
- Mixed import `import { type X, type Y }` IS skipped (all specifiers are type-only)
- `onlyImportFrom` with `ignoreTypeImports` works symmetrically
- `importFrom` / `notImportFrom` predicates respect the option
- Existing tests pass unchanged (default is `false`)

## Out of scope

- Changing default behavior — would break existing rules
- Inline `import type` specifier granularity (flagging only the non-type specifiers in a mixed import) — complex, defer
- Slice conditions (`notDependOn`, `respectLayerOrder`) — these use their own import scanning, separate plan if needed

## Verification

```bash
npm run test
npm run typecheck
npm run lint
```
