import { Entity } from '../domain/entity.js'
import { log } from '../shared/logger.js'

export function printEntity(e: Entity): void {
  log(e.id)
}
