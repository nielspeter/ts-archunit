# Cleanup: Remove pure-alias rules/dependencies.ts

**Type:** Cleanup
**Date:** 2026-03-27
**Severity:** Low — no user impact, internal hygiene

## Problem

`src/rules/dependencies.ts` exports three functions that are pure aliases of existing primitives:

- `onlyDependOn` = `onlyImportFrom`
- `mustNotDependOn` = `notImportFrom`
- `typeOnlyFrom` = `onlyHaveTypeImportsFrom`

These add zero logic — they just rename existing bricks. This violates the project principle that every API should be a composable primitive, not a duplicate name for one. Two names for one brick increases API surface for no composability gain.

## Fix

1. Remove `src/rules/dependencies.ts`
2. Remove its sub-path export from `package.json`
3. Update any tests that import from `ts-archunit/rules/dependencies`

## Related

Identified during a codebase audit against the "testing framework, not opinions" principle. All other `src/rules/` files are acceptable — they're thin opinionated presets correctly isolated behind sub-path exports per ADR-006.

## Secondary consideration

Consider renaming "standard rules" to "opinionated presets" in documentation to keep the identity distinction sharp between the core primitives layer and the convenience presets layer.

## Resolution

**Status:** Fixed
**Fixed by:** Direct cleanup (impl-0007)

Removed `src/rules/dependencies.ts`, its tests, sub-path export from `package.json`, and all documentation references. Users should use the core primitives directly: `onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom`.
