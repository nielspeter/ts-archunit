// Standalone functions and arrow functions with varying complexity.

// Complexity: 5 (if + for + if + || + ??)
export function processItems(items: string[], defaultVal: string | null): string[] {
  const result: string[] = []
  if (items.length > 0) {
    for (const item of items) {
      if (item === 'skip' || item === 'ignore') {
        continue
      }
      result.push(item ?? defaultVal ?? 'fallback')
    }
  }
  return result
}

// Complexity: 1 (no decision points)
export function identity(x: number): number {
  return x
}

// Arrow function — Complexity: 3 (if + && + ternary)
export const validate = (value: string, strict: boolean): boolean => {
  if (value.length > 0 && strict) {
    return value.length > 3 ? true : false
  }
  return false
}

// Many parameters — 6 params
export function createRecord(
  name: string,
  email: string,
  age: number,
  role: string,
  active: boolean,
  department: string,
): Record<string, unknown> {
  return { name, email, age, role, active, department }
}
