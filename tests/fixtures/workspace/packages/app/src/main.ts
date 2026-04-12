import { formatDate } from '../../shared/src/utils.js'

export function run(): string {
  return formatDate(new Date())
}
