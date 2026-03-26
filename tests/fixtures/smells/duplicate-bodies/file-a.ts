// The original function — parseWebhookOrder
export function parseWebhookOrder(raw: string): Record<string, unknown> {
  const data = JSON.parse(raw)
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid webhook payload')
  }
  const id = data.id as string
  const amount = parseInt(data.amount as string, 10)
  const currency = data.currency as string
  return { id, amount, currency }
}
