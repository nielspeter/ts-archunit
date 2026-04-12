# Proposal 008 — Vitest-Aware Test File Discovery in noDeadModules()

**Status:** Closed — use `.excluding()` + recipe
**Closed:** 2026-04-12
**Reason:** The existing `.excluding()` mechanism with test-file regexes
is sufficient (2-line user-side pattern). Option B (vitest config parsing)
couples a generic framework to a specific test runner — ts-archunit also
supports Jest, Mocha, node:test, etc. Option A (`skipTestFiles: true`)
hardcodes one set of patterns. If there is demand, publish a recipe in
docs and optionally export a `TEST_FILE_PATTERNS` constant users can
spread into `.excluding()`.

**Priority:** ~~Low~~ N/A
**Affects:** `noDeadModules()` in `rules/hygiene`
**Origin:** React app audit — false positives from co-located test files

## Problem

Projects that co-locate test files next to source files (e.g.,
`src/hooks/__tests__/useAssetPicker.test.ts`) have those files included
in the tsconfig but never imported by other source files. Vitest
discovers them via its own glob configuration, not via the import graph.

`noDeadModules()` flags these as orphaned because no module imports them.

## Evidence

A typical React app with co-located tests had 8 false positives:

```
src/hooks/__tests__/useBulkActions.test.tsx
src/hooks/__tests__/useBulkSelection.test.ts
src/hooks/__tests__/useReplaceAssetFile.test.ts
src/components/asset/__tests__/AssetFileUploadZone.test.tsx
src/components/pickers/__tests__/AssetPicker.test.tsx
src/components/pickers/__tests__/EntryPicker.test.tsx
src/utils/richtext/__tests__/converters.test.ts
src/test-setup.ts
```

All are valid test files loaded by vitest's glob config.

## Current Workaround

Exclude test patterns manually:

```ts
const EXCLUSIONS = [/__tests__\/.*\.test\.(ts|tsx)$/, /\/test-setup\.ts$/]
modules(p)
  .should()
  .satisfy(noDeadModules())
  .excluding(...EXCLUSIONS)
```

## Proposed Fix

### Option A: Built-in test file patterns

Add a `skipTestFiles` option that excludes common test patterns:

```ts
noDeadModules({ skipTestFiles: true })
// Skips: **/*.test.{ts,tsx}, **/*.spec.{ts,tsx}, **/test-setup.ts
```

### Option B: Vitest config integration

Read `vitest.config.ts` (or `vite.config.ts` with vitest plugin) and
extract the `include` / `exclude` patterns to auto-exclude test files:

```ts
noDeadModules({ vitestConfig: 'vitest.config.ts' })
```

Option A is simpler and framework-agnostic. Option B is more precise
but couples to vitest.

## Recommendation

Option A with sensible defaults. Most projects use `*.test.ts` and
`*.spec.ts` patterns, and `test-setup.ts` is nearly universal.
