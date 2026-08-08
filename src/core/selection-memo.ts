import { registerCacheReset } from './cache-registry.js'

/**
 * Memoize a builder's materialized selection — plan 0096.
 *
 * ## Why this exists
 *
 * Plan 0096 makes every family expose the set its conditions receive, so that
 * `diagnose()`'s preview and (in plan 0098) the floor read the **same
 * computation** the gate reads rather than a parallel one. Two readers of one
 * method means the walk would run twice per rule — and `doctor` calls
 * `diagnose()` once per rule file, so on a 600-file project a rule file with ten
 * smell rules paid seconds to compute ten integers.
 *
 * ## Why a WeakMap and not an instance field
 *
 * Because a field would be **wrong**, not merely different. These builders are
 * copy-on-write: every chain method returns `this.copy()`, which is
 * `shallowClone` — `Object.assign(clone, source)` over own enumerable
 * properties. A memo stored on the instance is therefore copied onto a builder
 * that has just been given a **different predicate**, and the clone answers with
 * its parent's selection. That is a stale-evidence bug of exactly the kind this
 * plan exists to prevent, and it would have been hard to see: the number is
 * plausible, and only a test that narrows *after* materializing would catch it.
 *
 * A `WeakMap` keyed on the builder has no such hazard by construction. A clone
 * is a different object, so a different key, so no entry. Nothing to clear, no
 * `copy()` override to remember in five families, and the entry is collected
 * with the builder.
 *
 * ## Why a factory rather than one shared map
 *
 * So the element type survives without an assertion. One `WeakMap<object,
 * unknown[]>` shared by every family would need a cast on the way out, which
 * [ADR-005](../../adr/005-no-any-no-type-assertions.md) forbids — and the
 * honest alternatives (a `filter` with an always-true type predicate) are worse:
 * they compile, allocate, and lie.
 *
 * @example
 * const selectionOf = selectionMemo<ArchFunction>()
 *
 * private selected(): ArchFunction[] {
 *   return selectionOf(this, () =>
 *     this.getElements().filter((e) => this._predicates.every((p) => p.test(e))),
 *   )
 * }
 */
export function selectionMemo<T>(): (owner: object, compute: () => T[]) => T[] {
  let cache = new WeakMap<object, T[]>()
  // Same staleness profile as `element-cache.ts`, so the same escape hatch — a
  // consumer holding a builder across a mutation of the underlying ts-morph
  // project gets the pre-mutation selection back, and identity has not changed
  // so nothing else can notice. That is worse here than in the element cache:
  // BOTH readers go through this memo, so a stale entry is a stale VERDICT and
  // a stale count that agree with each other. Reasoning about the clone hazard
  // and stopping one short of this one would read as "considered and safe".
  registerCacheReset(() => {
    cache = new WeakMap<object, T[]>()
  })
  return (owner, compute) => {
    const cached = cache.get(owner)
    if (cached !== undefined) return cached
    const computed = compute()
    cache.set(owner, computed)
    return computed
  }
}
