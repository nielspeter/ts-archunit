# Slices

::: warning The slice graph sees static imports only
`beFreeOfCycles()`, `notDependOn()` and `respectLayerOrder()` build their dependency
graph from static `import` declarations. Since v0.28.0 that is **narrower** than the
module conditions: `export { x } from './b.js'` is a dependency to `notImportFrom`
and invisible here.

A barrel re-export is _the_ classic cycle shape, so `a → barrel → a` is exactly what
the cycle check cannot see — and the asymmetry shows up inside one `strictBoundaries`
run, which will report a barrel re-export as a cross-boundary violation and the cycle
it creates as absent. Deliberate; a cycle finding is the hardest class to remedy and
belongs to its own release.
::: & Layers

::: tip Rule file or test file?
Snippets on this page end in `.check()` (the **test-file** form). In a [CLI rule file](/cli) (`arch.rules.ts`), **drop `.check()`** and spread the bare builder into `export default [...]` — a `.check()` inside a rule-file array is [silently skipped](/running-in-tests#converting-between-the-two-forms). Use `.asSeverity('warn')` for warnings.
:::

The `slices()` entry point groups source files into logical slices and checks relationships between them. Use it for cycle detection, layer ordering, and slice isolation.

## What Slices Are

Slices let you reason about architecture at a higher level than individual files. Instead of writing per-module import rules, you group files into named units and enforce constraints between them -- cycle freedom, layer ordering, or isolation. Use slices when your architectural rules are about relationships between groups (features, layers, packages) rather than between individual files.

A slice is a named group of source files. Two files in the same slice are considered "together." Two files in different slices have a dependency if one imports the other.

Slices can represent:

- **Layers** -- controllers, services, repositories, domain
- **Features** -- user management, billing, notifications
- **Packages** -- in a monorepo, each package is a slice

## Glob conventions (read this first)

**File-path** globs are matched against the **absolute** path, and a
project-relative glob like `'src/services/**'` is resolved against the directory
holding your `tsconfig.json`. Since **0.36.3** every surface accepts one:

| Where                                                          | `'src/services/**'`               |
| -------------------------------------------------------------- | --------------------------------- |
| `resideInFolder()`, `resideInFile()`, `havePathMatching()`     | ✅ the folder **at project root** |
| `slices().matching()`                                          | ✅                                |
| Preset options that name a location (`shared`, `repositories`) | ✅                                |
| `slices().assignedFrom()`, and the layer options that use it   | ✅                                |
| `crossLayer().layer()`, `smells.*.inFolder()`, import globs    | ✅ (since 0.36.3)                 |

Every path-glob entry point accepts it, and that list is **derived from the source** rather than maintained by hand — adding a new one fails the suite until someone decides what a relative spelling means there. The one exception is `slices().matching()`, which normalizes by prefixing `'**/'` instead: there the relative spelling means _anywhere_, not the root, and both spellings select the same set.

::: tip When in doubt, anchor with `**/`
`'**/src/services/**'` works everywhere. It means a `src/services` **anywhere**
in the project — including one nested in `vendor/` or another package — whereas
the relative spelling means the one at the project root, which is usually what
you meant.

**Import** globs need the anchor too, with one exception. They are matched against
**both** the _resolved_ absolute path and — for non-relative specifiers only — the
specifier exactly as written, and either may match. So a bare package name works as
written (`importFrom('fastify')`), installed or not, while anything path-shaped must
be anchored (`notImportFrom('**/src/repositories/**')`). A **relative** specifier is
never matched as a raw string: `'../services/*'` is an unanchored glob and matches
nothing, which is the diagnosis you want rather than a half-working match.

Genuinely exempt: `.excluding()`, which takes an exact string or a `RegExp` rather
than a glob; and the GraphQL entry points `schema()` / `resolvers()`, whose globs
are matched against paths relative to the tsconfig directory.

Watch `shared` in particular — anchoring `layers` but leaving `shared` relative
turns a silent no-op into a false positive, because with `strict: true` `shared`
is the innermost layer's import allow-list.
:::

`matching()` is the one exception, because its glob does double duty — the literal
prefix locates the files, and the segment after it _names_ each slice. It accepts
either spelling: `'src/features/*'`, `'src/features/*/'` and `'**/src/features/*'`
are equivalent.

A glob that matches nothing is not silently ignored: since v0.18 a slice rule that
discovers no slices **fails** with a message naming the glob at fault, because a
rule that discovers nothing enforces nothing.

## Defining Slices

There are two ways to assign files to slices: automatic discovery from directory structure, or explicit assignment via a map. Use `matching()` when your folder layout already reflects the architecture; use `assignedFrom()` when slices do not map one-to-one to directories or when you want explicit control.

### `matching(pattern)`

Derives slice names automatically from directory paths using a glob capture. This is the simplest approach when each subdirectory under a common parent represents one architectural slice (e.g., one feature folder per slice).

Auto-discover slices from the directory structure:

```typescript
import { project, slices } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// Each directory under src/features/ becomes a slice
slices(p).matching('src/features/*/').should().beFreeOfCycles().check()
```

The `*/` captures one directory level. `src/features/billing/order.ts` and `src/features/billing/invoice.ts` both land in the `billing` slice.

::: warning The captured segment may be a file
The segment after the literal prefix names each slice — a **directory** when files
are nested under it, otherwise each **file**. Over a flat folder,
`matching('src/services/*')` yields one slice per file (`order.service.ts`,
`user.service.ts`, …), not one `services` slice. That is useful for file-level
cycle detection, but it means layer names in `respectLayerOrder()` will not match
file-named slices — use `assignedFrom()` when you want to name the groups yourself.
:::

### `assignedFrom(map)`

Defines slices by providing a name-to-glob mapping. Use this when your architectural layers do not correspond to a single directory level, or when you need to name slices independently of folder structure. This is the typical choice for layer-based rules like Clean Architecture or Hexagonal Architecture.

Explicitly assign slices from a map of glob patterns:

```typescript
slices(p)
  .assignedFrom({
    controllers: '**/src/controllers/**',
    services: '**/src/services/**',
    repositories: '**/src/repositories/**',
    domain: '**/src/domain/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'repositories', 'domain')
  .check()
```

## Conditions

### `beFreeOfCycles(options?)`

Detects circular dependencies between slices using Tarjan's strongly connected components algorithm.

**Type-only imports are ignored by default** since v0.47.0. `import type { X } from './b.js'` is
erased at compile time and creates no runtime dependency, so counting it as an edge reports cycles
that cannot exist when the code runs — and a remedy like "extract the shared code to a lower-level
module" is not something you do about an `import type`.

```typescript
.beFreeOfCycles()                            // default: ignoreTypeImports: true
.beFreeOfCycles({ ignoreTypeImports: false }) // pre-0.47 behaviour: type edges count
```

::: tip Why this default differs from `notDependOn()` and `dependOn()`
It looks inconsistent and it is deliberate. **Cycles** are about runtime module-initialization order,
and an erased edge cannot contribute to one. **Layering and isolation** are about coupling — a
type-only dependency on `legacy` is still a dependency on `legacy`, and it still breaks when `legacy`
is deleted. So the cycle check ignores type edges by default and the dependency conditions count them.
:::

**Upgrading from 0.46 or earlier.** If a project reports fewer cycles after upgrading, the ones that
disappeared were type-only and were never runtime cycles. If you keep a baseline, note that a cycle's
identity is its **member list** — so a cycle that merely got _narrower_ (a slice joined to it only by
type edges is no longer a member) changes identity, and the entry stops matching rather than moving.
Regenerate the baseline, or pass `{ ignoreTypeImports: false }` to keep the old graph while you
migrate.

```typescript
slices(p)
  .matching('src/features/*/')
  .should()
  .beFreeOfCycles()
  .rule({
    id: 'arch/no-feature-cycles',
    because: 'Circular dependencies prevent independent deployment and testing',
    suggestion: 'Extract shared code into src/shared/ or introduce an event bus',
  })
  .check()
```

When a cycle is detected, the violation message shows the cycle path:

```
Architecture Violation [arch/no-feature-cycles]

  Cycle detected: billing -> notifications -> billing
  billing imports notifications at src/features/billing/service.ts:5
  notifications imports billing at src/features/notifications/handler.ts:12
```

### `respectLayerOrder(...layers)`

Asserts that dependencies between slices follow the declared order. The first layer may depend on the second, the second on the third, and so on -- but not in reverse.

```typescript
slices(p)
  .assignedFrom({
    controllers: '**/src/controllers/**',
    services: '**/src/services/**',
    repositories: '**/src/repositories/**',
    domain: '**/src/domain/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'repositories', 'domain')
  .rule({
    id: 'layer/direction',
    because: 'Dependencies flow inward: controllers -> services -> repositories -> domain',
  })
  .check()
```

This means:

- `controllers` may import from `services`, `repositories`, `domain`
- `services` may import from `repositories`, `domain`
- `repositories` may import from `domain`
- `domain` may not import from any of the above

### `notDependOn(slice)`

Asserts that no slice depends on the named slice.

```typescript
slices(p)
  .assignedFrom({
    core: '**/src/core/**',
    legacy: '**/src/legacy/**',
    features: '**/src/features/**',
  })
  .should()
  .notDependOn('legacy')
  .because('legacy module is being phased out')
  .check()
```

## Real-World Examples

### Clean Architecture Layers

```typescript
const layers = {
  presentation: '**/src/presentation/**',
  infrastructure: '**/src/infrastructure/**',
  application: '**/src/application/**',
  domain: '**/src/domain/**',
}

slices(p)
  .assignedFrom(layers)
  .should()
  .respectLayerOrder('presentation', 'infrastructure', 'application', 'domain')
  .because('Clean Architecture: dependencies point inward')
  .check()
```

### Feature Module Independence

```typescript
slices(p)
  .matching('src/features/*/')
  .should()
  .beFreeOfCycles()
  .rule({
    id: 'arch/no-feature-cycles',
    because: 'Circular dependencies prevent independent deployment',
    suggestion: 'Extract shared code into src/shared/',
  })
  .check()
```

### Domain Aggregate Independence

```typescript
slices(p)
  .matching('src/domain/*/')
  .should()
  .beFreeOfCycles()
  .because('aggregates must be independently consistent')
  .check()
```

### No Layer Cycles

```typescript
slices(p)
  .assignedFrom({
    presentation: '**/src/presentation/**',
    infrastructure: '**/src/infrastructure/**',
    application: '**/src/application/**',
    domain: '**/src/domain/**',
  })
  .should()
  .beFreeOfCycles()
  .check()
```

### Monorepo Package Boundaries

```typescript
slices(p)
  .matching('packages/*/')
  .should()
  .beFreeOfCycles()
  .because('packages should be independently publishable')
  .check()
```

## Combining with Module Rules

Use `slices()` for architectural structure and `modules()` for fine-grained import control:

```typescript
// Architectural: layers respect order
slices(p)
  .assignedFrom({
    controllers: '**/src/controllers/**',
    services: '**/src/services/**',
    domain: '**/src/domain/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'domain')
  .check()

// Fine-grained: domain must not import from node_modules/express
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notImportFrom('**/node_modules/express/**')
  .check()
```
