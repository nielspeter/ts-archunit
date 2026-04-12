# Proposal 006 — Silent Exclusions Option

**Status:** Implemented
**Implemented:** 2026-04-12
**Summary:** `silent()` wrapper shipped in `src/core/silent-exclusion.ts`. Both
`RuleBuilder.excluding()` and `TerminalBuilder.excluding()` accept `SilentExclusion`.
Stale-exclusion warning in `execute-rule.ts` skips silent-indexed patterns. Exported
from `src/index.ts`. Docs updated in `api-reference.md`. 5 tests.

**Priority:** Low (re-evaluate after Proposal 001 ships)
**Affects:** `.excluding()` API on all rule builders

## Problem

When `.excluding()` patterns are shared across multiple workspaces or
configurations, some patterns legitimately match zero violations in
certain contexts. ts-archunit logs a warning for each:

```
[ts-archunit] Unused exclusion '/\.d\.ts$/' in rule 'hygiene/no-dead-modules'.
It matched zero violations — it may be stale after a rename.
```

In a monorepo running the same rule across 10+ workspaces with shared
exclusions (e.g., `.d.ts`, `__tests__`, `test-setup.ts`), this produces
dozens of spurious "unused exclusion" warnings per test run. The warnings
are correct for each individual workspace (some don't have `.d.ts` files)
but wrong for the exclusion's intent (it's shared across all workspaces).

## Proposed API

A `silent()` wrapper function — composable, unambiguous, consistent with
the framework's primitives philosophy:

```ts
import { silent } from '@nielspeter/ts-archunit'

modules(p)
  .should()
  .satisfy(noDeadModules())
  .excluding(silent(/\.d\.ts$/), 'index.ts')
  .check()
```

`silent()` wraps a single pattern and marks it as intentionally broad.
The stale-exclusion warning is suppressed for that specific pattern while
all other patterns retain stale detection.

There is no ambiguity about which pattern is silent — the wrapper makes
it explicit per-pattern.

## Implementation

### `silent()` helper

```ts
// src/core/silent-exclusion.ts
const SILENT = Symbol('silent-exclusion')

interface SilentExclusion {
  readonly pattern: string | RegExp
  readonly [SILENT]: true
}

export function silent(pattern: string | RegExp): SilentExclusion {
  return { pattern, [SILENT]: true }
}

export function isSilent(value: unknown): value is SilentExclusion {
  return typeof value === 'object' && value !== null && SILENT in value
}
```

### `.excluding()` signature update

```ts
// In RuleBuilder:
excluding(...patterns: (string | RegExp | SilentExclusion)[]): this {
  for (const p of patterns) {
    if (isSilent(p)) {
      this._exclusions.push(p.pattern)
      this._silentIndices.add(this._exclusions.length - 1)
    } else {
      this._exclusions.push(p)
    }
  }
  return this
}
```

### Stale-detection update

In `src/core/execute-rule.ts:56-64`, skip the stale-exclusion warning
for indices in the `_silentIndices` set:

```ts
exclusions.forEach((pattern, index) => {
  if (!matchedPatterns.has(index) && !silentIndices.has(index)) {
    console.warn(...)
  }
})
```

## Why Not Other API Shapes

**Rejected: positional options in variadic args**

```ts
.excluding(/\.d\.ts$/, { silent: true })
```

Ambiguous — does `{ silent: true }` apply to the preceding pattern, all
preceding patterns, or all patterns? Custom parsing of mixed-type
variadic args is fragile and surprising in TypeScript APIs.

**Rejected: separate method**

```ts
.excludingSilent(/\.d\.ts$/)
```

Works, but adds a second exclusion method to the base RuleBuilder. The
`silent()` wrapper is additive (one new export) without touching the
RuleBuilder API surface — cleaner for a feature with uncertain demand.

## Backwards Compatibility

Fully backward compatible. The current `(string | RegExp)[]` calls
continue to work unchanged. `SilentExclusion` is a new union member.

## Dependency Note

If Proposal 001 (workspace support) ships, many shared exclusions
disappear because cross-workspace imports become visible. The primary
`.d.ts` example also dissolves if teams use the `.excluding(/\.d\.ts$/)`
recipe (see closed Proposal 003). Re-evaluate remaining demand after 001
ships before implementing.

## Documentation

### `docs/recipes.md`

Add a "Shared Exclusions Across Workspaces" recipe showing the pattern:

```ts
import { silent } from '@nielspeter/ts-archunit'

// Shared exclusions — some workspaces have .d.ts files, some don't
modules(p)
  .should()
  .satisfy(noDeadModules())
  .excluding(silent(/\.d\.ts$/), 'index.ts', 'main.ts')
  .check()
```

### `docs/core-concepts.md` or `docs/violation-reporting.md`

Add a note in the exclusions section explaining `silent()` and when to
use it (intentionally broad patterns shared across configurations).

### `docs/api-reference.md`

Add `silent` to the helpers table:

| `silent` | `silent(pattern)` | Wrap an exclusion pattern to suppress the "unused exclusion" warning. |

### `CHANGELOG.md`

Add under `### Added`:

- `silent()` wrapper for `.excluding()` patterns — suppresses the
  "unused exclusion" warning for intentionally broad patterns shared
  across workspaces.

## Workaround

Ignore the stderr output. The warnings are non-fatal and don't affect
the exit code. But they reduce signal-to-noise in test output.
