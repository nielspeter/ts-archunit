import type { ClassDeclaration } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import { classes } from '../builders/class-rule-builder.js'
import { newExpr } from '../helpers/matchers.js'
import type { PresetBaseOptions } from './shared.js'
import { atPath, collectRule, overrideFindings, validateOverrides } from './shared.js'

/** This preset's rule ids, derived from `RULE_IDS` so the two cannot drift. */
export type DataLayerIsolationRuleId = (typeof RULE_IDS)[number]

export interface DataLayerIsolationOptions extends PresetBaseOptions<DataLayerIsolationRuleId> {
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
export function dataLayerIsolation(
  p: ArchProject,
  options: DataLayerIsolationOptions,
): RuleBuilderLike[] {
  const overrides = options.overrides
  validateOverrides(overrides, [...RULE_IDS])
  const overrideProblems = overrideFindings(overrides, RULE_IDS)

  const builders: RuleBuilderLike[] = []

  // --- Base class enforcement ---
  if (options.baseClass) {
    builders.push(
      ...collectRule(
        classes(p)
          .that()
          .satisfy(atPath(options.repositories, 'repositories'))
          .should()
          .extend(options.baseClass),
        {
          id: 'preset/data/extend-base',
          because:
            'a repository that does not extend the base class silently opts out of whatever the base guarantees — connection handling, tenancy scoping, error translation',
          suggestion:
            'Extend the base repository. If this one genuinely cannot, exclude it by name and record why, rather than leaving it looking conformant.',
          imperative: 'Do NOT define a repository that does not extend the base repository',
        },
        'error',
        overrides,
      ),
    )
  }

  // --- Typed errors ---
  if (options.requireTypedErrors) {
    builders.push(
      ...collectRule(
        classes(p)
          .that()
          .satisfy(atPath<ClassDeclaration>(options.repositories, 'repositories'))
          .should()
          .notContain(newExpr('Error')),
        {
          id: 'preset/data/typed-errors',
          because:
            'a generic Error crossing the data layer loses the information callers need to distinguish not-found from conflict from a real failure',
          suggestion:
            'Throw a domain error type instead, so the caller can branch on it and the API layer can map it to a status code.',
          imperative: 'Do NOT throw new Error() in a repository — throw a domain error type',
        },
        'error',
        overrides,
      ),
    )
  }

  // Unknown override keys FIRST: they say the configuration is wrong, which
  // the reader needs before any finding produced under it (bug 0038).
  return [...overrideProblems, ...builders]
}
