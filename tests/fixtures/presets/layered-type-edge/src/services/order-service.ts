// The whole point of this fixture: the ONLY edge from services to routes is
// type-only, and it points OUTWARD (services is inner, routes is outer).
//
// `respectLayerOrder` counts it by default — layering asks whether the code is
// coupled, and a shared type is coupling. `beFreeOfCycles` would not — an erased
// import cannot contribute to an initialization cycle. That disagreement is
// deliberate, and plan 0089's `importOptions` is how a preset user aligns them.
import type { HandlerContext } from '../routes/handler.js'

export function describeOrder(ctx: HandlerContext): string {
  return `order for ${ctx.requestId}`
}
