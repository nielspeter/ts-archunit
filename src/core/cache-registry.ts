/**
 * Where invalidatable caches register themselves.
 *
 * This module exists to break an import cycle, and the cycle was found by this
 * repository's own `beFreeOfCycles` rule rather than by review. Wiring
 * `resetProjectCache()` directly to `clearElementCaches()` made
 * `project.ts → element-cache.ts → project.ts` — the back edge being
 * `import type { ArchProject }`, which counts, because dependency conditions
 * have seen type-expression edges since v0.28.0.
 *
 * So the registry depends on nothing. `element-cache.ts` and `module-edges.ts`
 * register a reset closure here; `project.ts` calls {@link clearRegisteredCaches}
 * and never learns what is in it.
 *
 * A `WeakMap` cannot be enumerated, so "clear" means "replace the map". Each
 * cache contributes the closure that replaces its own.
 */
const resets: (() => void)[] = []

/** Register a cache's reset. Call once, at module scope. */
export function registerCacheReset(reset: () => void): void {
  resets.push(reset)
}

/**
 * Drop every registered cache.
 *
 * Called by `resetProjectCache()`. The caches are keyed on object identity, so
 * a caller who obtains projects through `project()` / `workspace()` is already
 * covered — those functions hand back a new object. This is the escape hatch
 * for a consumer holding an `ArchProject` **they** built across a mutation of
 * the underlying ts-morph project, where identity does not change and the
 * cached population would otherwise be frozen.
 */
export function clearRegisteredCaches(): void {
  for (const reset of resets) reset()
}
