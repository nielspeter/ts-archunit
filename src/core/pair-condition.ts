import type { SourceFile } from 'ts-morph'
import type { ArchViolation } from './violation.js'
import type { ConditionContext } from './condition.js'
import type { LayerPair } from '../models/cross-layer.js'

/** Condition that evaluates matched pairs from two layers. */
export interface PairCondition<A = SourceFile, B = SourceFile> {
  readonly description: string
  evaluate(pairs: LayerPair<A, B>[], context: ConditionContext): ArchViolation[]
}
