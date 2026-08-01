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
export const ASSERTS_CARDINALITY: unique symbol = Symbol('ts-archunit.assertsCardinality')
