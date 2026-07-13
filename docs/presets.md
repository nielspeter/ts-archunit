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

## `recommended`

A deliberately **thin, universal safety floor** for any TypeScript project — the handful of things dangerous regardless of project shape that fire ~never on healthy code. It is _not_ a full architecture; shape-specific rules (layer order, cycles, delegation) are yours to add.

Like `agentGuardrails`, it **returns** severity-carrying builders (it does not throw), so spread it into the default export:

```typescript
import { project } from '@nielspeter/ts-archunit'
import { recommended } from '@nielspeter/ts-archunit/presets'

const p = project('tsconfig.json')

export default [
  ...recommended(p),
  // ...your shape-specific rules
]
```

### Generated rules

| Rule ID                                      | Enforces                       | Default |
| -------------------------------------------- | ------------------------------ | ------- |
| `preset/recommended/no-eval`                 | No `eval()`                    | error   |
| `preset/recommended/no-function-constructor` | No `Function` constructor      | error   |
| `preset/recommended/no-silent-catch`         | No empty/silent `catch` blocks | warn    |
| `preset/recommended/no-empty-bodies`         | No empty function bodies       | warn    |

Two `error`, two `warn`. The warn rules have known, suppressible false positives (intentional empty catches, no-op callbacks), so they surface without failing the build.

**Options.** `include` is the source glob (default `'**/src/**'`, matched against each file's absolute path). A `**/src/**` glob already covers monorepos — `packages/foo/src/**` matches at any depth — so only projects whose source lives _outside_ any `src/` folder (e.g. `lib/`) need to override it:

```typescript
export default [...recommended(p, { include: 'lib/**' })]
```

The `overrides` map (below) changes individual rule severity. Codegen, templating, or serializer libraries that legitimately build functions from strings should turn off the Function-constructor rule: `overrides: { 'preset/recommended/no-function-constructor': 'off' }`. (`eval` has no comparable legitimate use, so it stays `error`.)

**Adoption.** The floor is designed to fire ~never on healthy code, so adopting it is usually a non-event. If a legacy codebase does trip the rules — an existing `eval`, or a wall of empty catches — snapshot them once with [`--baseline`](/cli#check-run-rules); the baseline captures **all four** severities, so only _new_ violations surface afterward (see [Baseline](/core-concepts#baseline-mode)).

**Stability.** `recommended` is a versioned contract, not just a convenience alias: spreading `...recommended(p)` means "these four rules today, and we won't break your CI on a minor bump." New rules enter at `warn` or `off` in a minor release and are only promoted to `error` in a major. That opt-in ladder is the reason to depend on the preset rather than hand-copy the four rules.

> Overlaps `agentGuardrails` on empty bodies and (if you list `'eval'` in its `noInlineLogic`) `eval`. Running both double-reports those locations under different rule ids. For agent-focused projects prefer `agentGuardrails` alone; otherwise silence the `recommended` copies — `overrides: { 'preset/recommended/no-empty-bodies': 'off' }`.

## `agentGuardrails`

Targets the mistakes AI coding agents make most often — inline logic, generic errors, stub comments, empty bodies, copy-paste. Where the presets above enforce _where_ code goes, `agentGuardrails` enforces _how_ it is written. See [AI Agents](/ai-agents) for the full workflow.

Unlike the other presets, it **returns** severity-carrying builders (it does not throw), so you spread it into a rule file's default export:

```typescript
import { project } from '@nielspeter/ts-archunit'
import { agentGuardrails } from '@nielspeter/ts-archunit/presets'

const p = project('tsconfig.json')

export default [
  ...agentGuardrails(p, {
    src: 'src/**',
    noInlineLogic: ['parseInt', 'JSON.parse', 'eval'],
    noGenericErrors: true,
    noStubs: true,
    noEmptyBodies: true,
    noCopyPaste: true,
  }),
]
```

### Generated rules

| Rule ID                              | Enforces                                             | Default |
| ------------------------------------ | ---------------------------------------------------- | ------- |
| `preset/agent/no-inline-logic/<api>` | No inline call to a banned API (one per entry)       | error   |
| `preset/agent/no-generic-errors`     | No `throw new Error()` — use typed errors            | error   |
| `preset/agent/no-stubs`              | No TODO/FIXME/"not implemented" stub comments        | error   |
| `preset/agent/no-empty-bodies`       | No empty function bodies                             | error   |
| `preset/agent/no-copy-paste`         | No near-identical function bodies (≥ 0.9 similarity) | warn    |

Uses function-variant rules, so standalone functions, arrow functions, and class methods are all covered. Each rule carries `because` / `suggestion` / `imperative` metadata so the agent gets an actionable fix in `explain --format agent` and `check --format json`. Accepts the same `overrides` map as every preset (below).

> `agentGuardrails` overlaps a general `recommended` floor on empty bodies and `eval`. Running both double-reports those locations (different rule ids). For agent-focused projects, prefer `agentGuardrails` alone; otherwise override the duplicated ids to `'off'` in one preset.

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
