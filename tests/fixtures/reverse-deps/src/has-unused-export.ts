// usedFunction is imported by consumer-of-partial.ts
// unusedFunction is never imported by anyone
export function usedFunction(): string {
  return 'used'
}

export function unusedFunction(): string {
  return 'unused'
}
