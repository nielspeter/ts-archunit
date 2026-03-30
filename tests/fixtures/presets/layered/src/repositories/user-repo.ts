import { formatDate } from '../shared/utils.js'

export function findUser(id: number): { id: number; created: string } {
  return { id, created: formatDate(new Date()) }
}
