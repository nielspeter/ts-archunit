import type { Entity } from '../domain/entity.js'

export function createOrder(id: string): Entity {
  return { id }
}
