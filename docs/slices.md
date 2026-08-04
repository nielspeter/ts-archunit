# Slices & Layers

::: tip What counts as a dependency here
`beFreeOfCycles()`, `notDependOn()` and `respectLayerOrder()` build their graph from the
**eager static** dependencies of each file — `import` declarations _and_ re-exports.
Since v0.48.0 that includes `export { x } from './b.js'` and `export * from './b.js'`,
which emit an import of the module and so are real runtime dependencies. Before v0.48.0
re-exports were invisible here, which meant a **barrel cycle** — `a → barrel → a`, the
commonest cycle there is — could not be detected.

Two kinds are deliberately **not** counted:

- **Dynamic `import('./b.js')`** — it is lazy, so it cannot deadlock module
  initialization, and it is usually the _deliberate_ fix for a cycle. Reporting it would
  fail a rule for applying its own remedy.
- **`require()`** — CommonJS, and this is an ESM-only package.

Type-only forms are erased at compile time and handled by `ignoreTypeImports`; the
default differs per condition, and the reason is under `beFreeOfCycles()` below.
:::

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
.beFreeOfCycles({ ignoreTypeImports: false }) // count type-only edges too
```

::: tip Why this default differs from `notDependOn()` and `dependOn()`
It looks inconsistent and it is deliberate. **Cycles** are about runtime module-initialization order,
and an erased edge cannot contribute to one. **Layering and isolation** are about coupling — a
type-only dependency on `legacy` is still a dependency on `legacy`, and it still breaks when `legacy`
is deleted. So the cycle check ignores type edges by default and the dependency conditions count them.
:::

::: warning `verbatimModuleSyntax` changes what counts as a cycle
Under `verbatimModuleSyntax: true`, TypeScript keeps the module request even when every
specifier is erased. Measured, same source, both settings:

| form                         | `verbatimModuleSyntax: false` | `verbatimModuleSyntax: true` |
| ---------------------------- | ----------------------------- | ---------------------------- |
| `import type { X } from 's'` | erased                        | erased                       |
| `import { type X } from 's'` | erased                        | **`import {} from 's'`**     |
| `export type { X } from 's'` | erased                        | erased                       |
| `export { type X } from 's'` | erased                        | **`export {} from 's'`**     |

So under that flag `import { type X } from './b.js'` **does** cause `./b.js` to be evaluated, and it
**can** close a cycle. Since v0.49.0 `beFreeOfCycles()` reads your tsconfig and counts those two forms
accordingly; before that it reported nothing for them.

If you have the flag on, expect cycles you have not seen before. They are real: write
`import type { X }` — with the modifier on the declaration — and the module request goes away along
with the cycle. That is also the fix.

`notDependOn()` and `respectLayerOrder()` are **unaffected** by the flag: the bindings are type-level
either way, and coupling is what they measure.
:::

**Upgrading from 0.46 or earlier.** If a project reports fewer cycles after upgrading, the ones that
disappeared were type-only and were never runtime cycles. If you keep a baseline, note that a cycle's
identity is its **member list** — so a cycle that merely got _narrower_ (a slice joined to it only by
type edges is no longer a member) changes identity, and the entry stops matching rather than moving.
Regenerate the baseline.

::: danger `{ ignoreTypeImports: false }` is not a way back
This page said it was, until v0.49.1. It counts type-only edges — but since v0.48.0 re-exports are
counted as well, so type edges **plus** re-export edges is a **wider** graph than v0.46.1 ever had.
Someone reaching for it to buy migration time gets _more_ findings than they started with. To hold
still while you migrate, use `.asSeverity('warn')` or a baseline, not this option.
:::

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

When a cycle is detected, the finding names the slices involved:

```
Architecture Violation [arch/no-feature-cycles]

  Cycle detected: billing -> notifications -> billing
  src/features/billing/service.ts:5 — [billing, notifications]
```

::: warning Read the arrows as a member list, not a path
This page showed a per-edge listing until v0.49.1 — two extra lines naming each edge and its
location. **That output has never existed**; it was aspirational documentation from v0.1.0.

What the arrows actually contain is the strongly-connected component's **members**, not a traversal.
For a two-slice cycle that reads correctly. For three or more it does not: the order is an artefact
of the cycle-detection algorithm, so the arrows can name pairs that are not edges at all, and the
reported location may be an import that is perfectly legal — or missing entirely. Treat the list as
"these slices are mutually entangled" and find the offending edge yourself.

Being fixed; the per-edge output above is what it should say.
:::

### `respectLayerOrder(...layers)` · `respectLayerOrder(layers, options)`

Asserts that dependencies between slices follow the declared order. The first layer may depend on the second, the second on the third, and so on -- but not in reverse.

Takes `ImportOptions` in the two-argument form. **Type-only edges count by default** — see
[the note under `notDependOn`](#notdependon-options) for why that differs
from `beFreeOfCycles()`.

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

### `notDependOn(...slices)` · `notDependOn(slices, options)` {#notdependon-options}

Asserts that no slice depends on any of the named slices.

::: tip Why type-only edges count here but not in `beFreeOfCycles()`
It looks like an inconsistency and it is deliberate.

A **cycle** is about runtime module-initialization order, so an edge that is erased at compile time
cannot contribute to one — and "extract the shared code to a lower-level module" is not something you
do about an `import type`. `beFreeOfCycles()` therefore ignores type-only edges by default.

**Isolation and layering** are about _coupling_. A type-only dependency on `legacy` is still a
dependency on `legacy`: it breaks when `legacy` is deleted, and "this layer may not reach into that
one" is a design statement rather than a runtime one. So these two count type-only edges by default,
matching `dependOn()` and `notImportFrom()`.

Since v0.49.0 the difference is not only the default — it is the **question**. `beFreeOfCycles()` asks
"is the target module evaluated"; the other two ask "are the bindings type-level". Those answers differ
for two spellings under `verbatimModuleSyntax`; the table is in the `beFreeOfCycles()` section above.

Pass `{ ignoreTypeImports: true }` to disagree:

```typescript
.should().notDependOn('legacy', 'deprecated')                      // type edges count
.should().notDependOn(['legacy'], { ignoreTypeImports: true })     // runtime edges only
```

:::

One violation is reported **per dependency site**, not per slice pair, so a barrel that re-exports
thirty things from a forbidden slice reports thirty findings — each with its own line, each separately
fixable.

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
