// Completely different function — should NOT be flagged
export function formatCurrency(amount: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  })
  return formatter.format(amount)
}
