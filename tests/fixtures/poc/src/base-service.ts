export abstract class BaseService {
  protected db: Record<string, unknown> = {}

  protected normalizeCount(result: { count: string | number }): number {
    return typeof result.count === 'string' ? parseInt(result.count, 10) : result.count
  }

  protected toError(entity: string, id: string): never {
    throw new DomainError(`${entity} '${id}' not found`)
  }
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}
