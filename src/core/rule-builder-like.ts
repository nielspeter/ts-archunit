import type { ArchViolation } from './violation.js'

/**
 * Minimal shape the CLI runner and presets collect violations from: anything
 * exposing a non-throwing, severity-stamped `.violations()`. Lives in core (not
 * `cli/`) so presets can return `RuleBuilderLike[]` without depending on CLI
 * infrastructure.
 */
export interface RuleBuilderLike {
  violations: () => ArchViolation[]
}
