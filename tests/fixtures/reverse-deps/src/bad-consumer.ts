// Imports directly from internal (bypasses barrel — violation)
import { formatName } from './internal/helper.js'

export function greetDirect(): string {
  return formatName('Jane', 'Doe')
}
