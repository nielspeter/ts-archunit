// Type-only import from infra — should be allowed with ignoreTypeImports
import type { connect } from '../infra/database.js'

// Type-only import from shared — always allowed
import type { log } from '../shared/logger.js'

export interface TypedService {
  connect: typeof connect
  log: typeof log
}
