import { createOrder } from '../services/order-service.js'

export function handleCreateOrder(): void {
  createOrder('1')
}
