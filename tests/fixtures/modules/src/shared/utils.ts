export function format(value: unknown): string {
  return String(value)
}

export function parse(input: string): unknown {
  return JSON.parse(input)
}
