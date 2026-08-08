export interface HandlerContext {
  requestId: string
}

export function handle(ctx: HandlerContext): string {
  return ctx.requestId
}
