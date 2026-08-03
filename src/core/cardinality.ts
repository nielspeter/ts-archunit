/**
 * The cardinality exemption, keyed so that only this library can set it.
 *
 * Plan 0074 (R3b), and specifically constraint 2 of 0069's appendix:
 *
 * > `Condition` is a public export and `defineCondition` is its sanctioned
 * > constructor. If the flag is expressible there, it is a one-line silent
 * > opt-out on any user condition — the hazard the Decisions section used to
 * > reject `.allowEmpty()`, relocated onto the condition object. A
 * > module-private `unique symbol`, with no `defineCondition` parameter, closes
 * > it by construction (ADR-008 rule 3's corollary).
 *
 * A first cut of this shipped as a plain `assertsCardinality?: true` property,
 * which is exactly the rejected shape: `Condition` is exported from
 * `src/index.ts`, so any user object literal could set it and silence the
 * empty-selection gate on any rule, permanently and invisibly. That is
 * `.allowEmpty()` wearing a different hat.
 *
 * This symbol is **not** re-exported from `src/index.ts`, and `package.json`'s
 * `exports` map has no wildcard subpath, so a consumer cannot import it to
 * name the key. The escape hatch users *do* get is `.expectEmpty()`, which is
 * an assertion that fails when the selection stops being empty — not a
 * silencer.
 */
const CARDINALITY_ASSERTERS = new WeakSet<object>()

/**
 * Declare that this condition is satisfied by an empty selection.
 *
 * **A registry, because a symbol was forgeable.** The first version keyed a
 * module-private `unique symbol` onto the condition, reasoning that a consumer
 * could not import it to name the key. They do not need to import it — four
 * shipped conditions carry it as an own property, and `notExist` is publicly
 * exported, so:
 *
 * ```ts
 * const stolen = Object.getOwnPropertySymbols(notExist())[0]
 * const mine = { description: 'x', evaluate: () => [], [stolen]: true }
 * ```
 *
 * Measured: an honest condition on an empty selection produces **1** configuration
 * finding and that forgery produces **0**. One line, through documented exports,
 * to exempt any rule from the empty-selection gate — the gate this library is
 * named around, and precisely the `.allowEmpty()` hazard the symbol was chosen to
 * prevent.
 *
 * Found by review, immediately after the identical hole was closed in
 * [plan 0081](../../plans/completed/0081-a-condition-declares-discovery-ownership.md)'s
 * symbol — while this one was being cited in that module's docstring as the safe
 * precedent. The lesson is worth more than the fix: **"module-private" describes
 * the binding, not the value.** A symbol keyed onto a public object is unlisted,
 * not unreachable.
 *
 * `WeakSet` membership cannot be read off an object, copied, or forged: a caller
 * would need this module's binding, and it is not exported. Weak so a condition is
 * not retained after its rule is discarded.
 */
export function marksAssertsCardinality<T extends object>(condition: T): T {
  CARDINALITY_ASSERTERS.add(condition)
  return condition
}

/** Is this condition satisfied by an empty selection? */
export function assertsCardinality(condition: object): boolean {
  return CARDINALITY_ASSERTERS.has(condition)
}
