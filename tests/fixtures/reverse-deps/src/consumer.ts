// Imports through the barrel (correct)
import { formatName } from './public/index.js'

export function greet(): string {
  return formatName('John', 'Doe')
}
