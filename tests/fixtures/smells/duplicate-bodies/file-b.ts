// Near-clone of parseWebhookOrder — same overall structure, slightly different flow
export function parseContentTypeOrder(raw: string): Record<string, unknown> {
  const payload = JSON.parse(raw)
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid content type payload')
  }
  const identifier = payload.id as string
  const total = parseInt(payload.amount as string, 10)
  const cur = payload.currency as string
  // Extra validation step — makes the AST slightly different
  if (total < 0) {
    throw new Error('Negative amount')
  }
  return { identifier, total, cur }
}
