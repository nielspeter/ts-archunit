# Plan 0040: Architecture Presets

## Status

- **State:** COMPLETED 2026-03-30
- **Priority:** P1 — The library's core value proposition
- **Effort:** 1.5 days
- **Created:** 2026-03-28
- **Updated:** 2026-03-30 (post-review: 4 presets → 3, apiArchitecture deferred to separate package)
- **Depends on:** 0041 (Architecture Rule Primitives), 0042 (Standard Architecture Rules)

## Context

ts-archunit has 28 standard code-level rules (noAny, noTypeAssertions, maxCyclomaticComplexity) — all duplicated by JetBrains/SonarQube. The library's unique value is architecture enforcement, but users must assemble every architecture rule from scratch using low-level primitives.

**Validated by real usage:** The cmless project (2 apps, 4 packages) has 50+ arch rules. 70% are framework-agnostic. The patterns repeat identically across both apps — proving they're generic, not app-specific.

**Goal:** Three parameterized architecture presets extracted from real production patterns. Only rules no other tool can enforce.

### What changed after review

The original draft had four presets. `apiArchitecture` was removed after architectural review:

- `route-schema-pairing` assumes a 1:1 file convention (many projects use inline schemas, co-located schemas, or auto-generated schemas)
- `response-pattern` with `{ items: T[], total: number }` is a cmless convention, not universal
- The generic parts (forbidden calls, forbidden imports) are already expressible as one-liners via `layeredArchitecture` options
- Per ADR-006, REST-specific rules belong in `@ts-archunit/rest`, not core

`dataLayerIsolation` was refocused as a companion to `layeredArchitecture` — it only adds rules that `layeredArchitecture` does not cover (DB package restriction, base class enforcement, typed errors). No duplicated layer ordering or cycle detection.

## Three presets

### 1. `layeredArchitecture(p, options)` — Layer direction and isolation

The most universal pattern. Both cmless apps enforce identical layer rules (ADR-011).

```ts
import { layeredArchitecture } from '@nielspeter/ts-archunit/presets'

layeredArchitecture(p, {
  layers: {
    routes: 'src/routes/**',
    services: 'src/services/**',
    repositories: 'src/repositories/**',
  },
  shared: ['src/shared/**', 'src/utils/**'],
  strict: true,
  typeImportsAllowed: ['**/services/**'],
  restrictedPackages: {
    // Only repositories may import these packages (value imports)
    'src/repositories/**': ['knex', 'prisma', 'drizzle-orm'],
  },
})
```

**Rules generated:**

| Rule ID                              | What it enforces                                                | Default |
| ------------------------------------ | --------------------------------------------------------------- | ------- |
| `preset/layered/layer-order`         | Dependencies flow inward only (routes→services→repos)           | error   |
| `preset/layered/no-cycles`           | No circular dependencies between layers                         | error   |
| `preset/layered/innermost-isolation` | Innermost layer imports only from itself + shared (strict mode) | error   |
| `preset/layered/type-imports-only`   | Cross-layer type imports allowed, value imports forbidden       | warn    |
| `preset/layered/restricted-packages` | Only specified layers may import restricted packages            | error   |

Uses: `slices().respectLayerOrder()`, `slices().beFreeOfCycles()`, `modules().onlyImportFrom()`, `modules().onlyHaveTypeImportsFrom()`, `modules().notImportFrom()`

The `restrictedPackages` option absorbs what was previously `dataLayerIsolation`'s DB package restriction. It is generic — not limited to DB packages.

**Semantics: exclusive access.** The key is the ONLY layer allowed to import the listed packages. All other modules in the project must NOT import them. If multiple keys list the same package, the union of those layers may import it.

```ts
restrictedPackages: {
  // Only infra layer may import AWS SDK — all other layers get violations
  'src/infra/**': ['@aws-sdk/*'],
  // Only auth layer may import JWT — all other layers get violations
  'src/auth/**': ['jsonwebtoken'],
  // Both repos and services may import knex — everyone else gets violations
  'src/repositories/**': ['knex'],
  'src/services/**': ['knex'],
}
```

Generated rule: for each package, `modules(p).that().not().resideInFolder(allowedLayers).should().notImportFrom(package)`. The direction is: "who is EXCLUDED from importing", not "what the allowed layer may import".

### 2. `dataLayerIsolation(p, options)` — Repository pattern enforcement

**Companion to `layeredArchitecture`.** Only adds rules that `layeredArchitecture` does not cover. Does NOT duplicate layer ordering, cycles, or import direction — those are `layeredArchitecture`'s job.

```ts
import { dataLayerIsolation } from '@nielspeter/ts-archunit/presets'

dataLayerIsolation(p, {
  repositories: 'src/repositories/**',
  baseClass: 'BaseRepository',
  requireTypedErrors: true,
})
```

**Rules generated:**

| Rule ID                    | What it enforces                                                               | Default |
| -------------------------- | ------------------------------------------------------------------------------ | ------- |
| `preset/data/extend-base`  | Repositories extend the base class (if `baseClass` specified)                  | error   |
| `preset/data/typed-errors` | Repositories throw typed errors, not generic `Error` (if `requireTypedErrors`) | error   |

Uses: `classes().extend()`, `classes().notContain(newExpr('Error'))`

This preset is small by design. Layer ordering and DB package restrictions are handled by `layeredArchitecture`. Users who just want "only repos touch the DB" use `layeredArchitecture` with `restrictedPackages`. Users who also want base class and typed error enforcement add `dataLayerIsolation`.

### 3. `strictBoundaries(p, options)` — Module boundary hygiene

Universal for any project with distinct feature areas. Prevents cross-contamination.

```ts
import { strictBoundaries } from '@nielspeter/ts-archunit/presets'

strictBoundaries(p, {
  folders: 'src/features/*',
  shared: ['src/shared/**', 'src/lib/**'],
  isolateTests: true,
  noCopyPaste: true,
})
```

**Rules generated:**

| Rule ID                                 | What it enforces                                     | Default |
| --------------------------------------- | ---------------------------------------------------- | ------- |
| `preset/boundaries/no-cycles`           | No circular deps between boundary folders            | error   |
| `preset/boundaries/no-cross-boundary`   | Each boundary imports only from itself + shared      | error   |
| `preset/boundaries/shared-isolation`    | Shared folders don't import from boundaries          | error   |
| `preset/boundaries/test-isolation`      | Test files don't import from other boundaries' tests | error   |
| `preset/boundaries/no-duplicate-bodies` | No copy-pasted function bodies across boundaries     | warn    |

Uses: `slices().beFreeOfCycles()`, `modules().onlyImportFrom()`, `modules().notImportFrom()`, `smells.duplicateBodies()`

## Shared infrastructure

### Preset options and severity

```ts
// src/presets/shared.ts
export type RuleSeverity = 'error' | 'warn' | 'off'

export interface PresetBaseOptions {
  overrides?: Record<string, RuleSeverity>
}
```

All presets accept `overrides` to set individual rules to `'error'`, `'warn'`, or `'off'`:

```ts
layeredArchitecture(p, {
  layers: { ... },
  overrides: {
    'preset/layered/type-imports-only': 'off',  // disable one rule
  },
})
```

### Aggregated error reporting

Each preset collects violations from all rules and throws a single `ArchRuleError` at the end, not on first failure. This requires a mechanism to run a rule and get violations without throwing.

**New terminal method: `.violations()`** on both `RuleBuilder` and `TerminalBuilder`:

The codebase has two parallel builder hierarchies:

- `RuleBuilder<T>` — used by `modules()`, `classes()`, `functions()`, `types()`, `calls()`
- `TerminalBuilder` — used by `slices()`, `smells`, `crossLayer()`, schema/resolver builders

Presets need to dispatch both (e.g., `layeredArchitecture` uses `slices().respectLayerOrder()` AND `modules().onlyImportFrom()`). Add `.violations()` to both:

```ts
// src/core/rule-builder.ts — new public terminal
// evaluate() stays private — .violations() is the public accessor
violations(): ArchViolation[] {
  const raw = this.evaluate()
  return applyExclusions(raw, this._exclusions, this._metadata)
}

// src/core/terminal-builder.ts — same pattern
// detect()/evaluate() stays abstract/private — .violations() is the public accessor
violations(): ArchViolation[] {
  const raw = this.collectViolations()  // internal method, varies by subclass
  return applyExclusions(raw, this._exclusions, this._metadata)
}
```

No `CheckOptions` parameter — `.violations()` returns raw violations after exclusions only. Baseline/diff filtering is the caller's responsibility (presets handle this at the aggregate level if needed).

The preset dispatch helper accepts both hierarchies:

```ts
// src/presets/shared.ts
type Dispatchable = { rule(m: RuleMetadata): Dispatchable; violations(): ArchViolation[] }

export function dispatchRule(
  builder: Dispatchable,
  ruleId: string,
  severity: RuleSeverity,
  overrides: Record<string, RuleSeverity> | undefined,
): ArchViolation[] {
  const effective = overrides?.[ruleId] ?? severity
  if (effective === 'off') return []
  const violations = builder.rule({ id: ruleId }).violations()
  if (effective === 'warn') {
    executeWarn(violations, { metadata: { id: ruleId } })
    return []
  }
  return violations
}
```

Each preset calls `dispatchRule()` for each of its rules, collects all error-level violations, then throws a single `ArchRuleError` with all violations if any exist. Unrecognized override keys emit a warning ("override key 'foo' does not match any rule in this preset").

## Why these three (validated by real usage)

From cmless's 50+ arch rules:

| Preset                | cmless rules it replaces             | Generic?                            |
| --------------------- | ------------------------------------ | ----------------------------------- |
| `layeredArchitecture` | 6 layer rules + 5 DB isolation rules | Any layered project                 |
| `dataLayerIsolation`  | 2 repository pattern rules           | Any project with repository pattern |
| `strictBoundaries`    | 10 package isolation rules           | Any project with modules/features   |

Total: ~23 of 50+ cmless rules replaced by 3 preset calls. The remaining rules are either Fastify-specific, GraphQL-specific (those belong in framework packages per ADR-006), or one-off project rules.

## Files

| File                                 | Type                                       |
| ------------------------------------ | ------------------------------------------ |
| `src/presets/shared.ts`              | New — types, `dispatchRule`, aggregation   |
| `src/presets/layered.ts`             | New — `layeredArchitecture()`              |
| `src/presets/data-layer.ts`          | New — `dataLayerIsolation()`               |
| `src/presets/boundaries.ts`          | New — `strictBoundaries()`                 |
| `src/presets/index.ts`               | New — re-exports all presets               |
| `src/core/rule-builder.ts`           | Modified — add `.violations()` terminal    |
| `src/core/terminal-builder.ts`       | Modified — add `.violations()` terminal    |
| `package.json`                       | Modified — add `./presets` sub-path export |
| `tests/presets/layered.test.ts`      | New                                        |
| `tests/presets/data-layer.test.ts`   | New                                        |
| `tests/presets/boundaries.test.ts`   | New                                        |
| `tests/fixtures/presets/layered/`    | New — fixture project                      |
| `tests/fixtures/presets/data-layer/` | New — fixture project                      |
| `tests/fixtures/presets/boundaries/` | New — fixture project                      |

### Sub-path export

Single entry point for all presets (no per-preset sub-paths — tree-shaking is not a concern for dev dependencies):

```jsonc
"./presets": {
  "types": "./dist/presets/index.d.ts",
  "import": "./dist/presets/index.js"
}
```

## Implementation phases

1. **Shared + layered** (0.5 day) — validates the preset function pattern + `dispatchRule` + `.violations()` + aggregation + `restrictedPackages`
2. **dataLayerIsolation** (0.25 day) — small companion, base class + typed errors
3. **strictBoundaries** (0.5 day) — dynamic boundary discovery + copy-paste detection
4. **Docs** (0.25 day) — VitePress presets page

## Test strategy

~8–12 tests per preset:

- Correct architecture passes (no throw)
- Each rule catches its target violation
- Override to 'off' suppresses a known violation
- Override to 'warn' does not throw
- Optional rules skip when config absent (e.g., `baseClass` not provided → `extend-base` skipped)
- Aggregated error contains violations from multiple rules
- `restrictedPackages` catches violation and passes for allowed layer
- `.violations()` terminal returns array without throwing

## Out of scope

- `apiArchitecture` — deferred to `@ts-archunit/rest` per ADR-006. The generic parts (forbidden calls/imports in routes) are already expressible via `layeredArchitecture` with `restrictedPackages`.
- Framework-specific presets (Fastify schemas, NestJS decorators) — separate packages per ADR-006
- JSON config layer — presets are functions, not config files
- Auto-detection of project structure — user provides globs explicitly
- Per-preset sub-path exports — single `./presets` entry point is sufficient

## Verification

```bash
npm run test
npm run typecheck
npm run lint
```
