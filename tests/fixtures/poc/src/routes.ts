// BAD: per-resource parsers (copy-paste pattern)
export function parseFooOrder(order: string | undefined) {
  const isDesc = order?.startsWith('-') ?? false
  const field = isDesc ? order!.slice(1) : order
  return { field: field ?? 'created_at', direction: isDesc ? 'desc' : 'asc' }
}

export function parseBarOrder(order: string | undefined) {
  const isDesc = order?.startsWith('-') ?? false
  const field = isDesc ? order!.slice(1) : order
  return { field: field ?? 'name', direction: isDesc ? 'desc' : 'asc' }
}

// BAD: const arrow function variant (same pattern, different syntax)
export const parseBazOrder = (order: string | undefined) => {
  const isDesc = order?.startsWith('-') ?? false
  const field = isDesc ? order!.slice(1) : order
  return { field: field ?? 'updated_at', direction: isDesc ? 'desc' : 'asc' }
}

// GOOD: no parseXxxOrder function — uses shared utility
export function listItems() {
  return []
}

// GOOD: different naming pattern — should not match /^parse\w+Order$/
export function parseConfig(raw: string) {
  return JSON.parse(raw) as unknown
}
