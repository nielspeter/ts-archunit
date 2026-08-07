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

/**
 * Deliberately over the default `minLines(5)` — plan 0096.
 *
 * Two `diagnose()` tests assert `toEqual([])` for a rule scoped to this folder,
 * meaning "no glob fault and no third finding". Every body here used to sit
 * under the default threshold, so a duplicate-body detector scoped here examined
 * ZERO subjects and could never fire — the tests were pinning glob liveness
 * through a vacuous detector, and 0096's evidence check surfaced it.
 *
 * Fixed here rather than by weakening the assertions, which that file explicitly
 * forbids: "weakening this to `toContain` is the cheap green the plan bans".
 */
export function summariseOrder(order: Order): string {
  const count = order.items.length
  const label = count === 1 ? 'item' : 'items'
  const total = order.total.toFixed(2)
  const head = `${String(count)} ${label}`
  return `${head} — ${total}`
}
