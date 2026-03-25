import { BaseService } from './base-service.js'

export class ProductService extends BaseService {
  async getTotal(): Promise<number> {
    const result = { count: '42' }
    // BAD: inline parseInt instead of this.normalizeCount()
    return typeof result.count === 'string' ? parseInt(result.count, 10) : result.count
  }

  async findById(id: string) {
    const result = this.db[id]
    if (!result) {
      // BAD: generic Error instead of DomainError
      throw new Error(`Product '${id}' not found`)
    }
    return result
  }

  async buildUrl(params: Record<string, string>): Promise<string> {
    // BAD: manual URLSearchParams
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      search.append(key, value)
    }
    return `/products?${search.toString()}`
  }
}
