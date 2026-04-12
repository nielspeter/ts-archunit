# Proposal 004 — Detect Dynamic import() Consumers

**Status:** Implemented (Phase 1)
**Implemented:** 2026-04-12
**Summary:** Phase 1 (module-level detection) shipped in `src/conditions/reverse-dependency.ts`.
`getReverseImportGraph()` now scans `CallExpression` nodes with `ImportKeyword` for
string-literal and no-substitution template-literal specifiers. Resolves relative
paths with `.js→.ts` extension mapping. Pre-check confirmed `findReferencesAsNodes()`
already handles dynamic imports for `haveNoUnusedExports()`, so Phase 2 (export-level)
is not needed. Docs updated in `standard-rules.md`. 5 tests.

**Priority:** Medium
**Affects:** `beImported()` / `noDeadModules()` in `conditions/reverse-dependency`

## Problem

The reverse import graph in `src/conditions/reverse-dependency.ts` only
checks static import declarations (`import { Foo } from './file'`). It
misses dynamic imports:

```ts
// Lazy loading
const { ResendService } = await import('./resend-service.js')

// Test harness — loads modules lazily to avoid circular deps
const { resetConfig } = await import('../src/config.js')

// Conditional loading
if (useNewImpl) {
  const { NewHandler } = await import('./new-handler.js')
}
```

Exports consumed only via dynamic import are flagged as "unused" by
`noUnusedExports()` and as "dead" by `noDeadModules()`. Automated fixers
that trust these rules may incorrectly delete live code.

The codebase already documents this limitation at
`reverse-dependency.ts:82-84`: _"Only considers static import
declarations. Dynamic import() expressions and require() calls are not
resolved."_

## Pre-implementation Check (MANDATORY)

**This check must be completed before any implementation begins.** It
determines whether the scope is "fix one function" or "fix two systems."

Verify whether `findReferencesAsNodes()` (used by `haveNoUnusedExports()`
at `reverse-dependency.ts:219`) already resolves dynamic imports via the
TypeScript language service. Write a small test fixture with a dynamic
`import()` and check if `findReferencesAsNodes()` returns a reference
from the dynamic import site.

- **If yes:** only `beImported()` (the manual import graph at lines
  41-69) needs the fix. `haveNoUnusedExports()` already works correctly
  for dynamic imports. This halves the scope.
- **If no:** both systems need updating, but Phase 2 (below) handles
  `haveNoUnusedExports()` separately.

## Proposed Fix

### Phase 1: Module-level detection (for `beImported()` / `noDeadModules()`)

Add a second pass in `getReverseImportGraph()` that scans for
`SyntaxKind.ImportExpression` nodes and resolves the module specifier to
determine which file is targeted. This is sufficient for module-level
dead code detection — we only need to know "does any dynamic import
reference this file?"

**Detection:** Use `Node.isImportExpression()` (per ADR-002/005) — not
`ce.getExpression().getText() === 'import'`, which is fragile.

**Module specifier resolution is harder than static imports.** Dynamic
`import()` arguments can be arbitrary expressions, not just string
literals. Supported cases:

1. **String literals** (common): `await import('./module')` — resolve
   via ts-morph module resolution.
2. **Template literals with no substitutions**: ``await import(`./module`)``
   — extract the string value and resolve.
3. **Non-resolvable expressions** (variables, conditionals, template
   literals with substitutions): skip gracefully. Do not attempt to
   evaluate runtime expressions.

### Phase 2: Export-level detection (for `haveNoUnusedExports()`)

Only needed if the pre-implementation check shows `findReferencesAsNodes()`
does NOT resolve dynamic imports. Determines which specific exports are
consumed via destructuring or property access:

```ts
// Pattern 1: destructured
const { Foo } = await import('./module')

// Pattern 2: property access
const mod = await import('./module')
mod.Foo(
  // Pattern 3: inline
  await import('./module'),
).Foo
```

Phase 2 is significantly harder and less commonly needed. Ship Phase 1
first; Phase 2 can follow as a separate effort.

**Edge cases to consider:** re-exported dynamic imports
(`export const mod = await import('./x')`), `import()` inside
`Promise.all()`.

## Scope

Phase 1: Small-medium. A second pass in `getReverseImportGraph()` at
`reverse-dependency.ts:41-69` for `ImportExpression` nodes.

Phase 2: Medium-large. Export-level tracking requires understanding
destructuring and property-access patterns across the consuming file.
Defer until Phase 1 is shipped and demand is confirmed.

## Documentation

### `docs/standard-rules.md`

Remove the limitation note at line 214:

> **Limitation:** Only static `import` declarations are analyzed. Files
> loaded via dynamic `import()` or `require()` will be falsely reported.

Replace with:

> **Note:** Both static `import` declarations and dynamic `import()`
> expressions are analyzed. Only string-literal and plain template-literal
> specifiers are resolved — computed specifiers (variables, conditional
> expressions) are skipped. `require()` calls are not resolved.

### `docs/modules.md`

Update the `beImported()` condition row in the Available Conditions
table to note that dynamic imports are now counted.

### `src/conditions/reverse-dependency.ts`

Update the JSDoc limitation comments on `onlyBeImportedVia()` (line 84)
and `beImported()` (line 126) to reflect that dynamic imports are now
included, with the caveat about non-literal specifiers.

### `CHANGELOG.md`

Add under `### Fixed`:

- `beImported()` / `noDeadModules()` now detect dynamic `import()`
  consumers — modules loaded via `await import('./x')` are no longer
  falsely reported as dead.

## Workaround

Add dynamic-import consumers to `.excluding()`:

```ts
modules(p).should().satisfy(noUnusedExports()).excluding('ResendService', 'resetConfig').check()
```

Works but requires maintaining a manual list and doesn't detect when
the dynamic import is removed (the `.excluding()` stale-detection helps
but only at the violation level, not the reference level).
