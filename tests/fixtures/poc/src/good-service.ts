import { BaseService, DomainError } from './base-service.js'

export class OrderService extends BaseService {
  async getTotal(): Promise<number> {
    const result = { count: '42' }
    return this.normalizeCount(result)
  }

  async findById(id: string) {
    const result = this.db[id]
    if (!result) {
      throw new DomainError(`Order '${id}' not found`)
    }
    return result
  }

  async search(query: string) {
    const items = Object.values(this.db)
    return items.filter((item) => JSON.stringify(item).includes(query))
  }
}
