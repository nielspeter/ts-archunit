/**
 * Fixture: a class with no violations.
 * No any properties, no type assertions, no non-null assertions,
 * no eval, no Function constructor, no process.env, no console.log,
 * no generic Error, no TypeError.
 */
export class CleanService {
  private readonly name: string

  constructor(name: string) {
    this.name = name
  }

  getName(): string {
    return this.name
  }

  greet(greeting: string): string {
    return `${greeting}, ${this.name}`
  }
}
