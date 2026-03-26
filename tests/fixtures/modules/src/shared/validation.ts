export function validate(items: unknown[]): void {
  if (items.length === 0) {
    throw new Error('Items cannot be empty')
  }
}
