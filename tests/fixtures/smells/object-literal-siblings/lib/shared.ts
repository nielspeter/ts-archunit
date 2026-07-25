export function validateInput(value: string): void {
  if (value.length === 0) {
    throw new Error('empty input')
  }
}
