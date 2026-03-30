# Architecture Presets

Presets are parameterized architecture rule bundles. One function call generates multiple coordinated rules with aggregated error reporting. Use presets as the starting point for new projects — they encode proven patterns from real production codebases.

```typescript
import {
  layeredArchitecture,
  strictBoundaries,
  dataLayerIsolation,
} from '@nielspeter/ts-archunit/presets'
```

## `layeredArchitecture`

The most universal architecture pattern. Nearly every backend project has layers — routes/controllers at the top, services in the middle, repositories/data access at the bottom. The rule is simple: dependencies flow downward, never upward. A repository must never import from a route. A service must never reach into the HTTP layer.

`layeredArchitecture` enforces this with a single function call. You define your layers in order (top to bottom) and it generates 5 coordinated rules: dependency direction, cycle freedom, innermost isolation, type-import enforcement, and package restrictions.

```typescript
layeredArchitecture(p, {
  layers: {
    routes: 'src/routes/**',
    services: 'src/services/**',
    repositories: 'src/repositories/**',
  },
  shared: ['src/shared/**', 'src/utils/**'],
  strict: true,
})
```

Layer order matters — the first layer depends on the second, the second on the third, etc. In this example: routes → services → repositories. A repository importing from routes is a violation.

### Generated rules

Each generated rule has a stable ID (for overrides) and a default severity. The preset runs all rules and aggregates violations — you see every problem in one error, not one rule at a time.

| Rule ID                              | What it enforces                                                | Default |
| ------------------------------------ | --------------------------------------------------------------- | ------- |
| `preset/layered/layer-order`         | Dependencies flow inward only                                   | error   |
| `preset/layered/no-cycles`           | No circular dependencies between layers                         | error   |
| `preset/layered/innermost-isolation` | Innermost layer imports only from itself + shared (strict mode) | error   |
| `preset/layered/type-imports-only`   | Cross-layer type imports allowed, value imports forbidden       | warn    |
| `preset/layered/restricted-packages` | Only specified layers may import restricted packages            | error   |

### `strict` mode

When `strict: true`, the innermost layer (last in the `layers` object) is fully isolated — it can only import from itself and the `shared` folders. This prevents repositories from reaching into services or routes.

### `typeImportsAllowed`

Some layers need to reference types from other layers without taking a runtime dependency. `typeImportsAllowed` specifies which layers may use `import type` across layer boundaries:

```typescript
layeredArchitecture(p, {
  layers: { ... },
  typeImportsAllowed: ['src/services/**'],
  // Services can `import type { User } from '../repositories/user-repo.js'`
  // but not `import { findUser } from '../repositories/user-repo.js'`
})
```

### `restrictedPackages`

Enforce that certain npm packages are only imported by specific layers. The key is the layer that IS allowed — all other modules in the project are forbidden:

```typescript
layeredArchitecture(p, {
  layers: { ... },
  restrictedPackages: {
    'src/repositories/**': ['knex', 'prisma'],
    'src/infra/**': ['@aws-sdk/*'],
  },
})
```

This generates: "all modules NOT in `src/repositories/**` must not import `knex` or `prisma`". If multiple layers list the same package, the union of those layers may import it.

## `dataLayerIsolation`

Companion to `layeredArchitecture`. Enforces repository pattern conventions that layer ordering alone cannot catch: base class extension and typed error throwing.

```typescript
dataLayerIsolation(p, {
  repositories: 'src/repositories/**',
  baseClass: 'BaseRepository',
  requireTypedErrors: true,
})
```

### Generated rules

| Rule ID                    | What it enforces                                    | Default |
| -------------------------- | --------------------------------------------------- | ------- |
| `preset/data/extend-base`  | All classes in repositories extend the base class   | error   |
| `preset/data/typed-errors` | No `new Error()` in repositories — use typed errors | error   |

Both rules are optional — omit `baseClass` to skip the extension check, omit `requireTypedErrors` to skip the error check.

## `strictBoundaries`

For projects with distinct feature areas (modules, bounded contexts, packages). Prevents cross-contamination between boundaries.

```typescript
strictBoundaries(p, {
  folders: 'src/features/*',
  shared: ['src/shared/**', 'src/lib/**'],
  isolateTests: true,
  noCopyPaste: true,
})
```

### Generated rules

| Rule ID                                 | What it enforces                                     | Default |
| --------------------------------------- | ---------------------------------------------------- | ------- |
| `preset/boundaries/no-cycles`           | No circular deps between boundary folders            | error   |
| `preset/boundaries/no-cross-boundary`   | Each boundary imports only from itself + shared      | error   |
| `preset/boundaries/shared-isolation`    | Shared folders don't import from boundaries          | error   |
| `preset/boundaries/test-isolation`      | Test files don't import from other boundaries' tests | error   |
| `preset/boundaries/no-duplicate-bodies` | No copy-pasted function bodies across boundaries     | warn    |

Boundary folders are discovered dynamically from the glob pattern. `src/features/*` finds all immediate subdirectories under `src/features/`.

## Overrides

Every preset accepts `overrides` to change individual rule severity:

```typescript
layeredArchitecture(p, {
  layers: { ... },
  overrides: {
    'preset/layered/type-imports-only': 'off',    // disable completely
    'preset/layered/no-cycles': 'warn',            // downgrade to warning
  },
})
```

Three severity levels: `'error'` (throws), `'warn'` (logs to stderr), `'off'` (skipped entirely). Unrecognized override keys emit a warning — catches typos.

## Aggregated errors

Presets collect violations from ALL rules before throwing. You see every violation in one error, not just the first failing rule. This makes fixing violations much faster — you see the full picture on every run.

## When to use presets vs. custom rules

Use presets when your project follows a recognized pattern (layered architecture, feature modules, repository pattern). Use custom rules when you need project-specific constraints that presets don't cover.

Presets and custom rules compose freely — run both in the same test file:

```typescript
// Presets handle the structural rules
layeredArchitecture(p, { layers: { ... } })
strictBoundaries(p, { folders: 'src/features/*' })

// Custom rules handle project-specific concerns
functions(p)
  .that().resideInFolder('**/services/**')
  .should().satisfy(mustCall(/Repository/))
  .check()
```
