import type { ArchProject } from '../core/project.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import { functions } from '../builders/function-rule-builder.js'
import type { FunctionRuleBuilder } from '../builders/function-rule-builder.js'
import { call } from '../helpers/matchers.js'
import { functionNoGenericErrors } from '../rules/errors.js'
import { noStubComments, noEmptyBodies } from '../rules/hygiene.js'
import { smells } from '../smells/index.js'
import type { DuplicateBodiesBuilder } from '../smells/duplicate-bodies.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import type { PresetBaseOptions } from './shared.js'
import { validateOverrides } from './shared.js'

export interface AgentGuardrailsOptions extends PresetBaseOptions {
  /** Glob for the source files the rules apply to. */
  src: string
  /** Banned call names — one rule generated per entry (e.g. `['parseInt', 'eval']`). */
  noInlineLogic?: string[]
  noGenericErrors?: boolean
  noStubs?: boolean
  noEmptyBodies?: boolean
  noCopyPaste?: boolean
}

/**
 * Preset targeting the mistakes AI coding agents make most often — inline
 * logic, generic errors, stub comments, empty bodies, copy-paste.
 *
 * Returns severity-carrying builders (the returning form, plan 0060), so an
 * agent's rules file does `export default [...agentGuardrails(p, { ... })]` and
 * `ts-archunit check --format json` surfaces every violation, including the
 * copy-paste **warn**. Each rule carries agent-facing `because` / `suggestion` /
 * `imperative` metadata so `explain --format agent` and the check JSON give the
 * agent an actionable fix.
 *
 * Uses function-variant rules so standalone functions, arrow functions, and
 * class methods are all covered.
 */
export function agentGuardrails(p: ArchProject, options: AgentGuardrailsOptions): RuleBuilderLike[] {
  validateOverrides(options.overrides, collectRuleIds(options))

  const builders: RuleBuilderLike[] = []
  const push = (
    builder: FunctionRuleBuilder | DuplicateBodiesBuilder,
    meta: RuleMetadata & { id: string },
    def: 'error' | 'warn',
  ): void => {
    const sev = options.overrides?.[meta.id] ?? def
    if (sev !== 'off') builders.push(builder.rule(meta).asSeverity(sev))
  }

  for (const api of options.noInlineLogic ?? []) {
    push(
      functions(p).that().resideInFile(options.src).should().notContain(call(api)),
      {
        id: `preset/agent/no-inline-logic/${api}`,
        because: `${api} inline in a function is logic that belongs behind a named helper`,
        suggestion: `extract the ${api} call into a named helper function`,
        imperative: `Do NOT call ${api} inline — extract it behind a named helper`,
      },
      'error',
    )
  }

  if (options.noGenericErrors) {
    push(
      functions(p).that().resideInFile(options.src).should().satisfy(functionNoGenericErrors()),
      {
        id: 'preset/agent/no-generic-errors',
        because: 'a generic Error loses the type/context callers need to handle it',
        suggestion: 'throw a domain-specific error (NotFoundError, ValidationError, …)',
        imperative: 'Do NOT throw new Error() — throw a domain-specific error class',
      },
      'error',
    )
  }

  if (options.noStubs) {
    push(
      functions(p).that().resideInFile(options.src).should().satisfy(noStubComments()),
      {
        id: 'preset/agent/no-stubs',
        because: 'stub comments (TODO/FIXME/"not implemented") ship unfinished work',
        suggestion: 'implement the body or remove the stub before committing',
        imperative: 'Do NOT leave stub comments (TODO/FIXME/"not implemented") in a function body',
      },
      'error',
    )
  }

  if (options.noEmptyBodies) {
    push(
      functions(p).that().resideInFile(options.src).should().satisfy(noEmptyBodies()),
      {
        id: 'preset/agent/no-empty-bodies',
        because: 'an empty function body is almost always an unfinished stub',
        suggestion: 'implement the body — every function must have at least one statement',
        imperative: 'Do NOT leave a function body empty',
      },
      'error',
    )
  }

  if (options.noCopyPaste) {
    push(
      smells.duplicateBodies(p).withMinSimilarity(0.9),
      {
        id: 'preset/agent/no-copy-paste',
        because: 'near-identical bodies are copy-paste instead of reuse',
        suggestion: 'extract the shared logic into one function',
        imperative: 'Do NOT duplicate a function body — extract the shared logic',
      },
      'warn',
    )
  }

  return builders
}

/** All rule ids the given options would generate (for override validation). */
function collectRuleIds(options: AgentGuardrailsOptions): string[] {
  const ids: string[] = []
  for (const api of options.noInlineLogic ?? []) ids.push(`preset/agent/no-inline-logic/${api}`)
  if (options.noGenericErrors) ids.push('preset/agent/no-generic-errors')
  if (options.noStubs) ids.push('preset/agent/no-stubs')
  if (options.noEmptyBodies) ids.push('preset/agent/no-empty-bodies')
  if (options.noCopyPaste) ids.push('preset/agent/no-copy-paste')
  return ids
}
