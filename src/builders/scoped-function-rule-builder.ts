import { FunctionRuleBuilder } from './function-rule-builder.js'
import type { CallRuleBuilder } from './call-rule-builder.js'
import type { ArchFunction } from '../models/arch-function.js'
import { extractCallbacks } from '../helpers/callback-extractor.js'

/**
 * A FunctionRuleBuilder that only examines callback functions
 * inside matched call expressions.
 *
 * Created by `within(selection).functions()`. Inherits all predicates,
 * conditions, and chain methods from FunctionRuleBuilder --- the only
 * difference is the element source.
 */
export class ScopedFunctionRuleBuilder extends FunctionRuleBuilder {
  private readonly callSelection: CallRuleBuilder

  constructor(callSelection: CallRuleBuilder) {
    super(callSelection.getProject())
    this.callSelection = callSelection
  }

  /**
   * Override: instead of scanning all source files, extract callbacks
   * from the matched call expressions.
   */
  protected override getElements(): ArchFunction[] {
    const matchedCalls = this.callSelection.getMatchedCalls()
    return matchedCalls.flatMap((archCall) =>
      extractCallbacks(archCall.getNode()).map((ec) => ec.fn),
    )
  }
}
