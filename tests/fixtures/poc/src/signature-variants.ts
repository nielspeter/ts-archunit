// Fixture for testing function signature predicates (plan 0029)

export function withRest(...items: string[]): void {
  void items
}

export function withOptional(name?: string): void {
  void name
}

export function withDefault(count = 10): void {
  void count
}

export function allRequired(a: string, b: number): void {
  void [a, b]
}

export function withBoth(label: string, ...tags: string[]): void {
  void [label, tags]
}
