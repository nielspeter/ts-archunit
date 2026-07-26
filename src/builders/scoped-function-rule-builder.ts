import { FunctionRuleBuilder } from './function-rule-builder.js'
import type { CallRuleBuilder } from './call-rule-builder.js'
import type { ArchFunction } from '../models/arch-function.js'
import type { GlobNode } from '../core/glob-site.js'
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

  /**
   * This builder's own globs, plus the wrapped call selection's.
   *
   * `within(selection).functions()` draws its subjects from `selection`, so a
   * dead glob in the selection empties this rule just as surely as a dead
   * glob on the rule itself — and inheriting `RuleBuilder.globs()` unchanged
   * would report only half of that. The composition follows the element
   * source, which is what `getElements()` above already does for subjects.
   */
  override globs(): readonly GlobNode[] {
    return [...this.callSelection.globs(), ...super.globs()]
  }
}
