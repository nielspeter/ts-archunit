// Near-clone of parseWebhookOrder — same overall structure, slightly different flow
//
// Padded to distinctVocabulary >= 20 (plan 0103, Phase 0 Problem B) — measured
// at 17 before padding. See file-a.ts for why.
export function parseContentTypeOrder(raw: string): Record<string, unknown> {
  const payload = JSON.parse(raw)
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid content type payload')
  }
  const identifier = payload.id as string
  const total = parseInt(payload.amount as string, 10)
  const cur = payload.currency as string
  const source = payload.source as string
  const region = payload.region as string
  const channel = payload.channel as string
  const priority = payload.priority as string
  const status = payload.status as string
  const note = payload.note as string
  const tags = payload.tags as string
  const label = payload.label as string
  const owner = payload.owner as string
  const method = payload.method as string
  // Extra validation step — makes the AST slightly different
  if (total < 0) {
    throw new Error('Negative amount')
  }
  return {
    identifier,
    total,
    cur,
    source,
    region,
    channel,
    priority,
    status,
    note,
    tags,
    label,
    owner,
    method,
  }
}
