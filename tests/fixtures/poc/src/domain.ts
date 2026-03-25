// Domain layer — should not import from services or routes
export interface User {
  id: string
  name: string
  email: string
}

export interface Order {
  id: string
  userId: string
  total: number
  status: 'pending' | 'shipped' | 'delivered'
}
