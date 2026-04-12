# Proposal 001 — Multi-Project Workspace Support

**Status:** Implemented
**Implemented:** 2026-04-12
**Summary:** `workspace(tsConfigPaths)` shipped in `src/core/project.ts`. Returns
standard `ArchProject` backed by a single ts-morph `Project` loading multiple
tsconfigs via `addSourceFilesFromTsConfig()`. Separate cache keyed by sorted
paths; `resetProjectCache()` clears both caches. Exported from `src/index.ts`.
Docs updated in `getting-started.md`, `standard-rules.md`, `api-reference.md`. 10 tests.

**Priority:** High
**Affects:** `noUnusedExports()`, `noDeadModules()`, potentially all module-level rules

## Problem

In a monorepo with npm/pnpm/yarn workspaces, each `project()` instance
only sees one tsconfig. An export consumed by a different workspace
(e.g., a shared utility package imported by an app) appears "unused"
because the importing workspace is outside the scanned project.

This makes `noUnusedExports()` essentially unusable in monorepos without
a custom multi-project wrapper script. `noDeadModules()` has the same
issue — shared packages that are only imported by other workspaces
appear orphaned.

## Evidence

In a typical monorepo with 5-10 workspaces, running `noUnusedExports()`
on a shared package produces ~70% false positives. Exports consumed by
sibling workspaces are invisible to the single-project import graph.
Manual cross-checking with a custom script (loading all workspace
tsconfigs and joining their import graphs) reduces violations to the
genuinely dead exports.

The same pattern holds across workspaces: each workspace's "unused"
count drops dramatically once cross-workspace consumers are visible.

## Proposed API

```ts
import { workspace } from '@nielspeter/ts-archunit'

const ws = workspace([
  'apps/web/tsconfig.json',
  'apps/api/tsconfig.json',
  'packages/shared/tsconfig.json',
  'packages/sdk/tsconfig.json',
])

// Rules that check cross-project references
modules(ws, { scope: '**/packages/shared/src/**' })
  .that()
  .resideInFolder('**/packages/shared/src/**')
  .should()
  .satisfy(noUnusedExports())
  .check()
```

The `workspace()` function creates a unified view across all projects so
that `noUnusedExports()` and `noDeadModules()` can see imports from any
workspace, not just the declaring one.

## Design: Merge Into Single ArchProject

**Recommended approach:** `workspace()` returns a standard `ArchProject`
backed by a single ts-morph `Project` that loads multiple tsconfigs via
`Project.addSourceFilesFromTsConfig()`.

**Why this layering wins:**

- `beImported()` and `haveNoUnusedExports()` in
  `src/conditions/reverse-dependency.ts` already use
  `elements[0].getProject()` to build the import graph and call
  `findReferencesAsNodes()`. A merged Project automatically makes
  cross-workspace references visible with **zero condition-level changes**.
- All existing entry points (`modules()`, `classes()`, `functions()`,
  `calls()`) accept `ArchProject` — no new union type needed.
- The `{ scope: '...' }` parameter filters which source files to check,
  so rules can target one workspace while seeing imports from all of them.

**Alternative rejected:** returning a new `ArchWorkspace` type that all
entry points would need to accept. This creates a parallel type hierarchy
and forces changes across every builder.

### `tsConfigPath` Contract

`ArchProject` has `readonly tsConfigPath: string`. A workspace merges N
tsconfigs, so this field becomes ambiguous. The workspace `ArchProject`
must expose a **`tsConfigPaths: string[]`** field listing all loaded
configs, and set `tsConfigPath` to the first config in the array (the
"primary" config used for compiler options). Document this clearly — code
that derives a root directory from `tsConfigPath` (e.g., the GraphQL
extension) needs to handle multi-root workspaces.

### Compiler Options Behavior

**Correction:** `addSourceFilesFromTsConfig()` only adds source files —
it does **not** merge compiler options. The `Project` keeps the compiler
options from whichever tsconfig is passed to the `Project` constructor.
Subsequent `addSourceFilesFromTsConfig()` calls only load files.

`workspace()` should:

1. Create the `Project` with the **first** tsconfig's compiler options.
2. Add files from all remaining tsconfigs via `addSourceFilesFromTsConfig()`.
3. Document that the first tsconfig's compiler options "win" for type
   checking (strictNullChecks, target, paths, etc.).
4. Consider logging a warning if loaded tsconfigs have conflicting
   `strict` or `target` settings that could affect type resolution.

### Cache Isolation with `project()`

If a user calls both `project('packages/shared/tsconfig.json')` and
`workspace([..., 'packages/shared/tsconfig.json'])`, they get two
separate `Project` instances with different import graph visibility.
Rules using the single-project `ArchProject` will not see cross-workspace
references even though the workspace `ArchProject` exists.

Mitigations:

- `workspace()` and `project()` use **separate caches** (workspace cache
  keyed by sorted tsconfig paths).
- `resetProjectCache()` must clear **both** caches.
- Document that mixing `project()` and `workspace()` for the same
  tsconfig is unsupported — use one or the other.

## Performance Considerations

Loading N tsconfigs into a single ts-morph `Project` combines all
type-checker state. For large monorepos (10+ workspaces):

- Memory: each workspace adds its source files and type information.
  Expect ~100-300 MB for a 10-workspace monorepo with ~2000 files total.
- Startup: `addSourceFilesFromTsConfig()` is incremental — each call
  adds files without re-parsing existing ones. Still, loading 10+
  tsconfigs will take several seconds.
- Caching: `workspace()` uses its own cache keyed by sorted absolute
  tsconfig paths. `resetProjectCache()` clears both the `project()` and
  `workspace()` caches.

Document expected overhead so users can make informed choices about which
workspaces to include.

## Error Handling

- Invalid tsconfig path: throw with a clear message naming the path.
- Duplicate source files across tsconfigs: ts-morph handles this
  gracefully (deduplicates by absolute path).
- Conflicting compiler options: the first tsconfig's options win (see
  "Compiler Options Behavior" above). Log a warning if `strict` or
  `target` differ across configs.

## Alternatives Considered

- **Custom script per repo** — works but is ~170 lines of
  project-specific code that every monorepo would need to reinvent.
- **Running the rule per-workspace and filtering** — still requires
  cross-checking, deferred to the report consumer.

## Documentation

### `docs/getting-started.md`

Add a "Monorepo Setup" section after the single-project quick start,
showing `workspace()` as the entry point for multi-tsconfig setups:

```ts
import { workspace, modules, noUnusedExports } from '@nielspeter/ts-archunit'

const ws = workspace([
  'apps/web/tsconfig.json',
  'apps/api/tsconfig.json',
  'packages/shared/tsconfig.json',
])

modules(ws)
  .that()
  .resideInFolder('**/packages/shared/src/**')
  .should()
  .satisfy(noUnusedExports())
  .check()
```

Note: `workspace()` returns a standard `ArchProject` — all existing
entry points and conditions work unchanged.

### `docs/modules.md`

Add a "Monorepo / Multi-Project" section after the "Real-World Examples"
showing how `workspace()` eliminates cross-workspace false positives for
`beImported()`, `noDeadModules()`, and `noUnusedExports()`.

### `docs/standard-rules.md`

Update the `noDeadModules()` and `noUnusedExports()` sections to mention
the monorepo limitation and link to the workspace solution:

> **Monorepo note:** In a multi-workspace project, exports consumed by
> sibling workspaces are invisible to a single `project()` call. Use
> `workspace()` to unify the import graph across workspaces.

### `docs/api-reference.md`

Add `workspace()` and `resetProjectCache()` entries. Document the
`tsConfigPaths` field on the returned `ArchProject`.

### `src/index.ts`

Add export for `workspace` with a JSDoc comment matching the existing
`project()` pattern.

### `CHANGELOG.md`

Add under `### Added`:

- `workspace()` — load multiple tsconfigs into a unified project for
  monorepo-aware dead-code and unused-export detection.

## Scope

This is the single highest-impact improvement for monorepo users. Without
it, `noUnusedExports()` produces ~70% false positives in a typical
workspace-based monorepo.
