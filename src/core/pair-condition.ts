import type { SourceFile } from 'ts-morph'
import type { ArchViolation } from './violation.js'
import type { ConditionContext } from './condition.js'
import type { LayerPair, Layer } from '../models/cross-layer.js'

/**
 * What a pair condition is given, beyond an ordinary condition's context.
 *
 * `layers` is the builder's **own resolved** layers —
 * [bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md).
 * Before this, `haveMatchingCounterpart` took a `Layer[]` argument that **no
 * public API could produce**: `PairFinalBuilder.layers` is private at every
 * stage and `resolveLayer` is unexported, so every caller hand-built the array
 * and the condition judged that copy rather than the builder's resolution.
 * Measured: builder glob dead, hand-built layers populated → two counterpart
 * violations and no configuration finding, describing an array the library never
 * resolved.
 *
 * ## Why a subtype rather than a field on `ConditionContext`
 *
 * A pair-only field on the base context leaks onto every class, function, module
 * and type condition. `identifyByArgument` is the one precedent, and its own
 * docstring justifies itself as "one optional primitive" — a second would make
 * that comment false.
 *
 * This is still additive for an external implementer: TypeScript method
 * parameters are bivariant, so a condition declaring `ConditionContext` still
 * satisfies `PairCondition`. Verified — `haveConsistentExports` and
 * `satisfyPairCondition` compile unchanged.
 */
export interface PairConditionContext extends ConditionContext {
  /** The layers the builder resolved, in declaration order. */
  readonly layers: readonly Layer[]
}

/** Condition that evaluates matched pairs from two layers. */
export interface PairCondition<A = SourceFile, B = SourceFile> {
  readonly description: string
  evaluate(pairs: LayerPair<A, B>[], context: PairConditionContext): ArchViolation[]
}
