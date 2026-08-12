import type { ClassDeclaration } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import { classes } from '../builders/class-rule-builder.js'
import { newExpr } from '../helpers/matchers.js'
import type { PresetBaseOptions } from './shared.js'
import {
  atPath,
  collectRule,
  overrideFindings,
  validateOverrides,
  declaredEmptyFindings,
  assertEnabled,
} from './shared.js'

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
  const config = options
  const constructed: string[] = []
  validateOverrides(config.overrides, [...RULE_IDS])
  const overrideProblems = overrideFindings(config.overrides, RULE_IDS)

  // Plan 0100's `attempted`: both rules sit behind an independent optional
  // flag, so — unlike `strictBoundaries`/`layeredArchitecture`, which always
  // construct at least one rule once discovery succeeds — this can
  // legitimately be `[]`. Computed from the options directly, before
  // `overrides` is consulted, same as `constructed` is computed after.
  //
  // Kept in step with the two `if` blocks below BY HAND — the same shape of
  // fragility `constructed` already has here (review: nothing enforces
  // `attempted.length === 0 ⟺` no rule gets built; it holds because both
  // conditionals are copy-derived from the same two options).
  const attempted: string[] = []
  if (options.baseClass) attempted.push('preset/data/extend-base')
  if (options.requireTypedErrors) attempted.push('preset/data/typed-errors')

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
        config,
        constructed,
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
        config,
        constructed,
      ),
    )
  }

  // Unknown override keys FIRST: they say the configuration is wrong, which
  // the reader needs before any finding produced under it (bug 0038).
  // Constructed, not merely known: a rule whose option was never enabled, or that
  // was overridden `off`, is not built — so a declaration naming it is dead.
  const otherFindings = [
    ...overrideProblems,
    ...declaredEmptyFindings(config.expectEmpty, constructed),
  ]
  return [
    ...otherFindings,
    // Plan 0100, LAST: only when nothing above already explains the empty
    // result does "neither flag was ever set" get to be the diagnosis.
    ...assertEnabled(attempted, otherFindings, {
      id: 'preset/data/constructs-nothing',
      presetName: 'dataLayerIsolation',
      optionsHint: 'baseClass, requireTypedErrors',
    }),
    ...builders,
  ]
}
