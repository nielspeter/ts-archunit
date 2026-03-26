// Class with methods of varying complexity.
// Expected complexity values documented inline.

export class ComplexService {
  // Complexity: 1 (no decision points)
  simple(): string {
    return 'hello'
  }

  // Complexity: 6 (if + for + if + && + ternary)
  complex(items: string[], flag: boolean): number {
    let count = 0
    if (flag) {
      for (const item of items) {
        if (item.length > 0 && item !== 'skip') {
          count += item.length > 10 ? 2 : 1
        }
      }
    }
    return count
  }
}

export class SimpleService {
  // Complexity: 1
  greet(name: string): string {
    return `Hello, ${name}`
  }

  // Complexity: 1
  add(a: number, b: number): number {
    return a + b
  }
}
