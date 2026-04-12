export function formatDate(date: Date): string {
  return date.toISOString()
}

export function parseId(raw: string): number {
  return parseInt(raw, 10)
}
