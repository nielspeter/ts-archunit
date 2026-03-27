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

// --- Return type variants (plan 0033) ---

export function returnsString(): string {
  return 'hello'
}

export function returnsPromiseNumber(): Promise<number> {
  return Promise.resolve(42)
}

export function returnsVoid(): void {
  // no return
}

export interface Collection<T> {
  items: T[]
  total: number
}

export function listUsers(): Collection<string> {
  return { items: [], total: 0 }
}

export function listOrders(): Collection<number> {
  return { items: [], total: 0 }
}

export function createUser(name: string): string {
  return name
}
