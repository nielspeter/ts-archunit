import { Entity as DomainEntity } from '../domain/entity.js'
import { validate as check } from '../shared/validation.js'

export function process(e: DomainEntity): void {
  check([e])
}
