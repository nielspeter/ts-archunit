import { connect } from '../infra/database.js'
import type { Entity } from '../domain/entity.js'

export function initDomain(): Entity {
  connect()
  return { id: 'leak' }
}
