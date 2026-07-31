import type { ArchProject } from './project.js'
import { registerCacheReset } from './cache-registry.js'

/**
 * Collect a builder's elements once per project instead of once per rule.
 *
 * Plan 0075. `filterElements()` calls `getElements()` on every rule execution
 * and each builder re-collects from scratch, so a suite with five `calls()`
 * rules walks every file's AST five times. Measured on this repository (518
 * files): **5 × `calls()` issued 2,600 `getDescendantsOfKind` queries in 692ms;
 * with this memo, 0 in 3ms warm** — measured against the implementation by
 * stashing it, not projected from a prototype.
 *
 * ## Why a factory rather than one shared map
 *
 * A single `WeakMap<ArchProject, Map<string, unknown[]>>` would need a cast to
 * hand `unknown[]` back as `ArchCall[]`, and ADR-005 bars both `any` and `as`.
 * Each builder module instead creates its own instance at module scope, closed
 * over its own element type, so the type survives end to end with no assertion.
 *
 * ## Why `WeakMap`, keyed on the project object
 *
 * The same shape `src/core/disk-set.ts:83` and `src/core/path-universe.ts:35`
 * already use. Keying on **object identity** is what makes a stale entry
 * unreachable: `resetProjectCache()` (`project.ts:178`) clears the `project()`
 * and `workspace()` maps, so the next call constructs a new object literal and
 * therefore a new key. Watch mode depends on that, and it is where a stale
 * cache would be an ADR-008 failure rather than a slow test — a rule
 * re-evaluated against a pre-edit AST reports a pass the edit did not earn. A
 * cache keyed on `tsConfigPath` would pass this repository's whole suite and
 * silently break watch mode.
 *
 * ## What it does not cover, measured rather than asserted
 *
 * An `ArchProject` a consumer built themselves and holds across a change to the
 * underlying ts-morph project. An earlier version of this docstring said the memo
 * "does not worsen" that case. **It does**, and review measured it:
 *
 *     classes(p).subjects()            -> One
 *     m.createSourceFile('/two.ts', …)
 *     classes(p).subjects()            -> One      (before this cache: One, Two)
 *
 * The population is frozen at first collection for the lifetime of the project
 * object, so a rule about `Two` selects nothing and passes — an ADR-008 false
 * green manufactured by a cache. Re-collection used to heal it.
 *
 * Two things make it survivable, and both are load-bearing rather than
 * reassuring: the CLI is unaffected, because `resetProjectCache()`
 * (`project.ts`) builds a new `ArchProject` per run and `--watch` calls it; and
 * `resetProjectCache()` now **also clears these caches**, so a consumer holding
 * their own project object has a documented way out. Call it after mutating.
 *
 * ## What must NOT be cached through this
 *
 * The **unfiltered** `getElements()` result only. `filterElements()`
 * unconditionally calls `.filter(...)`, which always allocates, so `subjects()`
 * keeps handing out a fresh array and no caller can alias the cached one.
 * Memoizing `filterElements()` instead would break that *and* be wrong:
 * `ScopedFunctionRuleBuilder` overrides `getElements()` to draw from a call
 * selection rather than the project, so a shared key would serve
 * `within(sel).functions()` the plain `functions()` population and let
 * `.should().notExist()` pass vacuously.
 */
export interface ElementCache<T> {
  /**
   * The cached collection for `project` under `key`, collecting it on first
   * ask. `key` distinguishes populations that differ for the same project —
   * see `FunctionRuleBuilder`, whose collection options change what it returns.
   */
  get(project: ArchProject, key: string, collect: () => T[]): T[]
}

/** A cache private to one builder module, typed to that builder's element. */
export function createElementCache<T>(): ElementCache<T> {
  let perProject = new WeakMap<ArchProject, Map<string, T[]>>()
  // Registered rather than exported: a `clearElementCaches()` that `project.ts`
  // imported directly would close the cycle `project -> element-cache -> project`
  // (the back edge is `import type { ArchProject }`, which counts).
  registerCacheReset(() => {
    perProject = new WeakMap<ArchProject, Map<string, T[]>>()
  })

  return {
    get(project: ArchProject, key: string, collect: () => T[]): T[] {
      let byKey = perProject.get(project)
      if (byKey === undefined) {
        byKey = new Map<string, T[]>()
        perProject.set(project, byKey)
      }
      const hit = byKey.get(key)
      // `has`, not truthiness: a legitimately empty collection is `[]`, and
      // `[]` is truthy — but an empty project is exactly the case where
      // re-collecting on every rule is pure waste, so it must cache too.
      if (hit !== undefined) return hit
      const fresh = collect()
      byKey.set(key, fresh)
      return fresh
    },
  }
}

/** The key for builders whose population is a function of the project alone. */
export const SOLE_POPULATION = 'default'
