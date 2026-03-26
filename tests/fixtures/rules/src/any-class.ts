/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fixture: class with `any`-typed properties for testing noAnyProperties.
 */
export class AnyPropertyClass {
  public data: any
  private config: any

  getData(): any {
    return this.data
  }
}
