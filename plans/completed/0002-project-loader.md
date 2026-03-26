# Plan 0002: Project Loader & Query Engine

## Status

- **State:** Complete
- **Priority:** P0 — Foundation for all entry points
- **Effort:** 0.5 day
- **Created:** 2026-03-25
- **Depends on:** 0000 (Project Bootstrap), 0001 (Exploratory PoC)

## Purpose

Implement `project('tsconfig.json')` as the single entry point for loading a TypeScript project. This returns an `ArchProject` that wraps a ts-morph `Project` and provides access to source files. Every subsequent plan (entry points, predicates, conditions) depends on this.

Key requirements:

- **Singleton caching** keyed by resolved absolute path so that `project('tsconfig.json')` called from different test files in the same vitest run reuses the same instance
- **`ArchProject` interface** as the public API surface (not a class)
- **Internal `_project` access** so entry points (plans 0007+) can query the underlying ts-morph `Project`
- **Clear error on invalid tsconfig** with actionable message

What this plan does NOT cover: pre-indexing of classes, functions, imports, etc. (that comes incrementally as entry points need it in plans 0007-0012), predicate memoization (plan 0003), or lazy AST loading optimizations (future performance plan). This plan is just the project loader and singleton cache.

## Phase 1: ArchProject Interface & project() Function

### `src/core/project.ts`

```typescript
import { Project, type SourceFile } from 'ts-morph'
import path from 'node:path'
import fs from 'node:fs'

/**
 * A loaded TypeScript project. Returned by `project()`.
 *
 * Wraps a ts-morph `Project` and provides access to source files.
 * Use this as the first argument to entry points like `classes(p)`, `modules(p)`, etc.
 */
export interface ArchProject {
  /** Resolved absolute path to the tsconfig.json used to load this project. */
  readonly tsConfigPath: string

  /** Returns all source files included by the tsconfig. */
  getSourceFiles(): SourceFile[]

  /**
   * The underlying ts-morph Project.
   * @internal Used by entry points — not part of the public API.
   */
  readonly _project: Project
}
```

The interface is deliberately minimal. Entry points call `p._project` to access ts-morph directly. End users only see `tsConfigPath` and `getSourceFiles()`.

### Singleton Cache

The cache is a module-level `Map<string, ArchProject>` keyed by the resolved absolute path. This handles:

- Relative paths: `project('tsconfig.json')` and `project('./tsconfig.json')` resolve to the same key
- Absolute paths: `project('/abs/path/tsconfig.json')` works directly
- Different projects: `project('packages/a/tsconfig.json')` and `project('packages/b/tsconfig.json')` get separate instances

```typescript
const cache = new Map<string, ArchProject>()

/**
 * Load a TypeScript project from a tsconfig.json path.
 *
 * Returns a cached instance if the same tsconfig has been loaded before.
 * The tsconfig path is resolved to an absolute path before caching,
 * so relative and absolute paths pointing to the same file share one instance.
 *
 * @param tsConfigPath - Path to tsconfig.json (relative or absolute)
 * @throws {Error} If the tsconfig file does not exist
 */
export function project(tsConfigPath: string): ArchProject {
  const resolved = path.resolve(tsConfigPath)

  const cached = cache.get(resolved)
  if (cached) {
    return cached
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `tsconfig not found: ${resolved}\n` +
        `Provide a valid path to tsconfig.json, e.g. project('tsconfig.json') or project('./packages/app/tsconfig.json')`,
    )
  }

  const tsMorphProject = new Project({
    tsConfigFilePath: resolved,
  })

  const archProject: ArchProject = {
    tsConfigPath: resolved,
    _project: tsMorphProject,
    getSourceFiles() {
      return tsMorphProject.getSourceFiles()
    },
  }

  cache.set(resolved, archProject)
  return archProject
}
```

### Why an object literal, not a class

`ArchProject` is an interface implemented by a plain object. This keeps the public API surface clean and prevents users from `instanceof` checking or subclassing. The implementation is entirely within the `project()` function closure.

### Cache reset for testing

Tests need a way to clear the singleton cache between test suites. Export a test-only helper:

```typescript
/**
 * Clear the project cache. Only for use in tests.
 * @internal
 */
export function _resetProjectCache(): void {
  cache.clear()
}
```

## Phase 2: Public API Export

### `src/index.ts`

Add the `project` function and `ArchProject` type to the public API:

```typescript
export { project } from './core/project.js'
export type { ArchProject } from './core/project.js'
```

`ArchProject` is exported as a type-only export since users receive it from `project()` but never construct it themselves.

## Phase 3: Tests

### `tests/core/project.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import { project, _resetProjectCache } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

describe('project()', () => {
  beforeEach(() => {
    _resetProjectCache()
  })

  it('loads a project from a tsconfig path', () => {
    const p = project(tsconfigPath)
    expect(p.tsConfigPath).toBe(tsconfigPath)
    expect(p._project).toBeDefined()
  })

  it('returns source files matching the tsconfig include', () => {
    const p = project(tsconfigPath)
    const files = p.getSourceFiles()
    const fileNames = files.map((f) => path.basename(f.getFilePath()))

    expect(fileNames).toContain('routes.ts')
    expect(fileNames).toContain('good-service.ts')
    expect(fileNames).toContain('bad-service.ts')
    expect(fileNames).toContain('base-service.ts')
    expect(fileNames).toContain('domain.ts')
    expect(fileNames).toContain('edge-cases.ts')
    expect(fileNames).toContain('options.ts')
  })

  describe('singleton caching', () => {
    it('returns the same instance for the same path', () => {
      const p1 = project(tsconfigPath)
      const p2 = project(tsconfigPath)
      expect(p1).toBe(p2)
    })

    it('returns the same instance for relative and absolute paths to the same file', () => {
      const relativePath = path.relative(process.cwd(), tsconfigPath)
      const p1 = project(tsconfigPath)
      const p2 = project(relativePath)
      expect(p1).toBe(p2)
    })

    it('returns different instances for different tsconfig files', () => {
      // Use the project's own root tsconfig as a second, different project
      const rootTsconfig = path.resolve(import.meta.dirname, '../../tsconfig.json')
      const p1 = project(tsconfigPath)
      const p2 = project(rootTsconfig)
      expect(p1).not.toBe(p2)
    })

    it('returns a fresh instance after cache reset', () => {
      const p1 = project(tsconfigPath)
      _resetProjectCache()
      const p2 = project(tsconfigPath)
      expect(p1).not.toBe(p2)
    })
  })

  describe('error handling', () => {
    it('throws a clear error for a non-existent tsconfig', () => {
      expect(() => project('/does/not/exist/tsconfig.json')).toThrowError(/tsconfig not found/)
    })

    it('includes the resolved path in the error message', () => {
      const badPath = '/does/not/exist/tsconfig.json'
      expect(() => project(badPath)).toThrowError(badPath)
    })

    it('includes a hint about valid paths in the error message', () => {
      expect(() => project('/nope/tsconfig.json')).toThrowError(/Provide a valid path/)
    })
  })

  it('exposes the resolved absolute path as tsConfigPath', () => {
    const relativePath = path.relative(process.cwd(), tsconfigPath)
    const p = project(relativePath)
    // tsConfigPath should always be absolute, even when loaded with a relative path
    expect(path.isAbsolute(p.tsConfigPath)).toBe(true)
    expect(p.tsConfigPath).toBe(tsconfigPath)
  })
})
```

## Files Changed

| File                         | Change                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `src/core/project.ts`        | New — `ArchProject` interface, `project()` function, singleton cache, `_resetProjectCache()` |
| `src/index.ts`               | Modified — export `project` and `ArchProject`                                                |
| `tests/core/project.test.ts` | New — 9 tests covering loading, caching, error handling, path resolution                     |

## Test Inventory

| #   | Test                                                      | What it validates                                           |
| --- | --------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | loads a project from a tsconfig path                      | Basic loading works, tsConfigPath is set, `_project` exists |
| 2   | returns source files matching the tsconfig include        | `getSourceFiles()` returns the expected fixture files       |
| 3   | returns the same instance for the same path               | Singleton cache works for identical paths                   |
| 4   | returns the same instance for relative and absolute paths | `path.resolve()` normalizes before cache lookup             |
| 5   | returns different instances for different tsconfig files  | Cache is keyed per-project, not global                      |
| 6   | returns a fresh instance after cache reset                | `_resetProjectCache()` works for test isolation             |
| 7   | throws a clear error for a non-existent tsconfig          | Error message includes "tsconfig not found"                 |
| 8   | includes the resolved path in the error message           | User can see which path failed                              |
| 9   | includes a hint about valid paths                         | Error message is actionable                                 |
| 10  | exposes the resolved absolute path as tsConfigPath        | Relative input produces absolute `tsConfigPath`             |

## Out of Scope

- **Pre-indexing** of classes, functions, types, imports — deferred to entry point plans (0007-0012) when each index is actually needed
- **Predicate memoization** — plan 0003 (Predicate Engine)
- **Lazy AST loading** — ts-morph already loads source files lazily by default; explicit lazy optimization deferred to a future performance plan if benchmarks warrant it
- **On-disk caching** — spec Section 13.4 item 3 (optional); not needed for v1
- **Performance benchmarks** — will be validated when entry points are implemented and real-world fixtures exist
- **`domain.ts` fixture** — already exists in `tests/fixtures/poc/src/domain.ts` from plan 0001; no changes needed
