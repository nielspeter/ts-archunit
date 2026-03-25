import { BaseService } from './base-service.js'

export class EdgeCaseService extends BaseService {
  // Optional chaining — does getText() return 'this?.normalizeCount' or 'this.normalizeCount'?
  withOptionalChain() {
    const result = { count: '5' }
    return this?.normalizeCount(result)
  }

  // Destructured — should NOT match 'this.normalizeCount' (no this prefix)
  withDestructuring() {
    const { normalizeCount } = this
    const result = { count: '5' }
    return normalizeCount.call(this, result)
  }

  // Nested — parseInt buried inside other calls
  withNesting() {
    return Math.max(0, parseInt(String(Math.random()), 10))
  }

  // Chained — method calls on returned objects
  withChaining() {
    return [1, 2, 3].map(String).filter(Boolean).join(',')
  }

  // Multiple violations in one method
  withMultiple() {
    const count = parseInt('10', 10)
    const search = new URLSearchParams()
    search.append('count', String(count))
    throw new Error('not implemented')
  }
}
