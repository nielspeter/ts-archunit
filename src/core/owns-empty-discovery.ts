/**
 * A condition that diagnoses its own empty discovery population.
 *
 * [Plan 0081](../../plans/completed/0081-a-condition-declares-discovery-ownership.md). The
 * dead-glob gate can see that a `.layer()` or `.inFolder()` glob matched nothing,
 * but it short-circuits **before** the condition runs, so where a condition
 * produces a better finding — one that names the dead layer, with a remedy
 * pointing at the call the reader must edit — the gate would replace it with a
 * generic message. This symbol is how a condition says "leave it to me".
 *
 * ## Why per condition, and not per builder
 *
 * It was per builder, and the granularity was load-bearing rather than cosmetic.
 * At v0.45.0 `PairFinalBuilder` returned `true` unconditionally while its own
 * docstring claimed *"All three now produce a finding naming the layer"* — and
 * that claim was false: `haveMatchingCounterpart` checked for empty layers inside
 * its pair loop, so a dead **final** layer produced no configuration finding at
 * all. The coarse declaration suppressed the gate for exactly the case its
 * declared owner did not handle, and the result was silence where the truth was
 * one dead glob
 * ([bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)).
 *
 * v0.45.1 fixed the condition, so the blanket claim became true again. It would
 * have gone false again the moment a fourth condition reached that builder,
 * because nothing forced the new condition to say anything. Now the claim is not
 * a claim: the builder reads the tag off the condition it was given.
 *
 * **An untagged condition does not own it, so the gate covers it.** That default
 * is the load-bearing half — under it, v0.45.0's hole would have degraded to a
 * generic message rather than silence, and a generic message is recoverable. An
 * agent reading "this glob matched nothing" fixes the glob; silence sends it to
 * write files into a layer that will never match.
 *
 * ## Unreachable by construction — a registry, not a property
 *
 * The first version was a `unique symbol` keyed onto the condition object, copying
 * `ASSERTS_CARDINALITY`. Review broke it in two lines:
 *
 * ```ts
 * const stolen = Object.getOwnPropertySymbols(haveMatchingCounterpart())[0]
 * const mine: PairCondition = { description: 'x', evaluate: () => [], [stolen]: true }
 * ```
 *
 * Measured: **0 configuration findings** on a dead layer. `PairCondition` is a
 * public type and all three condition factories are public exports, so the symbol
 * was readable off any shipped condition — the one-line silent opt-out this file
 * claimed could not exist, reachable through documented API.
 *
 * The `ASSERTS_CARDINALITY` precedent is stronger than the copy was, and that is
 * why copying it was not enough: `defineCondition` is its *sanctioned constructor*,
 * and a test asserts that constructor emits no own symbols. `PairCondition` has no
 * sanctioned constructor, so there is nothing to make the analogous guarantee.
 *
 * A module-level `WeakSet` has no such hole. Membership is not a property of the
 * object, so it cannot be read off one, copied, or forged — a caller would need
 * this module's binding, and it is not exported. `WeakSet` rather than `Set` so a
 * condition is not retained after its rule is discarded.
 */
const OWNERS = new WeakSet<object>()

/** Declare that this condition reports an empty discovery population itself. */
export function marksOwnEmptyDiscovery<T extends object>(condition: T): T {
  OWNERS.add(condition)
  return condition
}

/** Does this condition report an empty discovery population itself? */
export function ownsEmptyDiscovery(condition: object): boolean {
  return OWNERS.has(condition)
}

/*
 * Not every builder needs this. `SliceRuleBuilder` declares ownership at the
 * BUILDER level and correctly so: its reason — `assignedFrom` fanning out one glob
 * tree per entry, where a single dead entry among populated siblings is a
 * legitimate project shape — is identical for every condition reachable through
 * it. Registry membership is for the case where ownership varies by condition,
 * which is what made a blanket declaration wrong for cross-layer.
 */
