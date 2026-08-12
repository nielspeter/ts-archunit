// The original function — parseWebhookOrder
//
// Padded to distinctVocabulary >= 20 (plan 0103, Phase 0 Problem B) — measured
// at 12 before padding, one token of margin below the highest candidate floor
// that plan's triage tested. Padding preserves the near-clone relationship
// with file-b: same overall structure, same new fields on both sides.
export function parseWebhookOrder(raw: string): Record<string, unknown> {
  const data = JSON.parse(raw)
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid webhook payload')
  }
  const id = data.id as string
  const amount = parseInt(data.amount as string, 10)
  const currency = data.currency as string
  const source = data.source as string
  const region = data.region as string
  const channel = data.channel as string
  const priority = data.priority as string
  const status = data.status as string
  const note = data.note as string
  const tags = data.tags as string
  const label = data.label as string
  const owner = data.owner as string
  const method = data.method as string
  return {
    id,
    amount,
    currency,
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
