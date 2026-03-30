import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import { classes } from '../builders/class-rule-builder.js'
import { newExpr } from '../helpers/matchers.js'
import type { PresetBaseOptions } from './shared.js'
import { dispatchRule, validateOverrides, throwIfViolations } from './shared.js'

export interface DataLayerIsolationOptions extends PresetBaseOptions {
  /** Glob pattern for repository files */
  repositories: string
  /** Base class that all repositories must extend */
  baseClass?: string
  /** If true, repositories must throw typed errors, not generic Error */
  requireTypedErrors?: boolean
}

const RULE_IDS = ['preset/data/extend-base', 'preset/data/typed-errors'] as const

/**
 * Companion to `layeredArchitecture`. Enforces repository pattern:
 * base class extension and typed error throwing.
 *
 * Does NOT duplicate layer ordering or import direction — those
 * are `layeredArchitecture`'s job.
 */
export function dataLayerIsolation(p: ArchProject, options: DataLayerIsolationOptions): void {
  const overrides = options.overrides
  validateOverrides(overrides, [...RULE_IDS])

  const violations: ArchViolation[] = []

  // --- Base class enforcement ---
  if (options.baseClass) {
    violations.push(
      ...dispatchRule(
        classes(p).that().resideInFolder(options.repositories).should().extend(options.baseClass),
        'preset/data/extend-base',
        'error',
        overrides,
      ),
    )
  }

  // --- Typed errors ---
  if (options.requireTypedErrors) {
    violations.push(
      ...dispatchRule(
        classes(p)
          .that()
          .resideInFolder(options.repositories)
          .should()
          .notContain(newExpr('Error')),
        'preset/data/typed-errors',
        'error',
        overrides,
      ),
    )
  }

  throwIfViolations(violations)
}
