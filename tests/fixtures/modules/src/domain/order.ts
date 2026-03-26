import type { Entity } from './entity.js'
import { validate } from '../shared/validation.js'

export interface Order extends Entity {
  items: string[]
  total: number
}

export function createOrder(items: string[]): Order {
  validate(items)
  return { id: '1', items, total: items.length * 10 }
}
