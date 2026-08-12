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
import {
  overrideFindings,
  validateOverrides,
  declareEmptyIfListed,
  presetDeclarationSpelling,
  declaredEmptyFindings,
  assertEnabled,
} from './shared.js'
import type { RuleSeverity } from './shared.js'

/**
 * This preset's rule ids. The `no-inline-logic` arm is a **template literal**
 * because those ids are built from the caller's own `noInlineLogic` entries, so
 * the set is not closed. A typo in the API name is therefore still accepted by
 * the type — the runtime finding is what covers that arm.
 */
export type AgentGuardrailsRuleId =
  | `preset/agent/no-inline-logic/${string}`
  | 'preset/agent/no-generic-errors'
  | 'preset/agent/no-stubs'
  | 'preset/agent/no-empty-bodies'
  | 'preset/agent/no-copy-paste'

export interface AgentGuardrailsOptions extends PresetBaseOptions<AgentGuardrailsRuleId> {
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
// Presets collect object-literal functions unconditionally. `functions()`
// keeps it opt-in because widening a selector the USER wrote silently changes
// their rule; a preset's subject set is the preset's own, and this one already
// promises "standalone functions, arrow functions, and class methods are all
// covered". A handler map — the shape agents generate most — was none of the
// three, so `{ POST: () => {} }` slipped every guardrail (bug 0013).
const COLLECT_ALL = { includeObjectLiteralFunctions: true } as const

export function agentGuardrails(
  p: ArchProject,
  options: AgentGuardrailsOptions,
): RuleBuilderLike[] {
  // Plan 0100's `attempted`: the ids the caller's OPTIONS ask for, before any
  // override is consulted — every rule this preset can build sits behind an
  // optional flag, so this can legitimately be `[]` (nothing was ever enabled).
  // NOT what override validation uses below — see `knownOverrideIds`'s own doc.
  const attempted = collectRuleIds(options)
  const knownIds = knownOverrideIds(options)
  validateOverrides(options.overrides, knownIds)
  const overrideProblems = overrideFindings(options.overrides, knownIds)

  const builders: RuleBuilderLike[] = []
  // Recorded HERE, at the one place a rule is actually built — the same argument
  // `collectRule` makes for its `constructed` parameter ("the known-id list
  // cannot answer this"). Deriving it instead from `collectRuleIds()` filtered by
  // severity restates the construction conditionals a second time; the two agree
  // today only because they are kept in step by hand, and the first rule added to
  // one and not the other makes a declaration bind to a rule that was never built.
  const constructed: string[] = []
  const push = (
    builder: FunctionRuleBuilder | DuplicateBodiesBuilder,
    meta: RuleMetadata & { id: string },
    def: 'error' | 'warn',
  ): void => {
    const sev = lookup(options.overrides, meta.id) ?? def
    // Plan 0089's carrier, applied here as well as in `collectRule` — this
    // preset builds through its own helper, and a carrier that reached only the
    // shared path would cover the families someone remembered.
    if (sev !== 'off') {
      constructed.push(meta.id)
      builders.push(
        declareEmptyIfListed(
          builder
            .rule({ ...meta, declarationSpelling: presetDeclarationSpelling(meta.id) })
            .asSeverity(sev),
          meta.id,
          options,
        ),
      )
    }
  }

  for (const api of options.noInlineLogic ?? []) {
    push(
      functions(p, COLLECT_ALL).that().resideInFile(options.src).should().notContain(call(api)),
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
      functions(p, COLLECT_ALL)
        .that()
        .resideInFile(options.src)
        .should()
        .satisfy(functionNoGenericErrors()),
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
      functions(p, COLLECT_ALL).that().resideInFile(options.src).should().satisfy(noStubComments()),
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
      functions(p, COLLECT_ALL).that().resideInFile(options.src).should().satisfy(noEmptyBodies()),
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

  // Unknown override keys FIRST: they say the configuration is wrong, which
  // the reader needs before any finding produced under it (bug 0038).
  // `constructed` is recorded at the `push` site above, not re-derived here.
  const otherFindings = [
    ...overrideProblems,
    ...declaredEmptyFindings(options.expectEmpty, constructed),
  ]
  return [
    ...otherFindings,
    // Plan 0100, LAST of the config-findings: only when nothing else above
    // already explains the empty result (an unknown override key, an unbound
    // `expectEmpty`) does "no rule was ever enabled" get to be the diagnosis.
    ...assertEnabled(attempted, otherFindings, {
      id: 'preset/agent/constructs-nothing',
      presetName: 'agentGuardrails',
      optionsHint: 'noInlineLogic, noGenericErrors, noStubs, noEmptyBodies, noCopyPaste',
    }),
    ...builders,
  ]
}

/**
 * Widen the typed override map for a lookup by a runtime-built id.
 *
 * `no-inline-logic/${api}` ids are constructed from the caller's own options, so
 * the key here is a `string` and the map is keyed by a literal union. The
 * widening is confined to this one function rather than loosening the option
 * type, which is what makes the typo a compile error for every other key.
 */
function lookup(
  overrides: Partial<Record<AgentGuardrailsRuleId, RuleSeverity>> | undefined,
  id: string,
): RuleSeverity | undefined {
  const widened: Partial<Record<string, RuleSeverity>> | undefined = overrides
  return widened?.[id]
}

/**
 * The four ids this preset can construct regardless of whether their flag is
 * currently set — fixed, matching `AgentGuardrailsRuleId`'s own closed union
 * members (everything but the open `no-inline-logic/${string}` arm).
 */
const STATIC_RULE_IDS = [
  'preset/agent/no-generic-errors',
  'preset/agent/no-stubs',
  'preset/agent/no-empty-bodies',
  'preset/agent/no-copy-paste',
] as const

/**
 * Rule ids the given options WOULD generate if every flag were on — for
 * override-key validation. Static ids are always known (a key for a rule not
 * yet enabled is still a real rule, not a typo); `no-inline-logic/${api}` ids
 * stay scoped to what `noInlineLogic` actually named, because that arm is open
 * by construction and the only way to catch a typo in it is to compare against
 * what the caller wrote.
 *
 * Deliberately NOT `attempted` below, which is flag-gated. Reusing `attempted`
 * here was the bug plan 0100's review found: `overrides: { 'preset/agent/no-
 * generic-errors': 'off' } }` with `noGenericErrors` unset reported "matches no
 * rule in this preset" with an EMPTY enumeration — a real, correctly-spelled id
 * misdiagnosed as unknown, and `otherFindings.length > 0` from that wrong
 * finding then silently suppressed the correct `constructs-nothing` finding
 * `assertEnabled` would otherwise have reported. `dataLayerIsolation` never had
 * this bug: it already validates against the full static `RULE_IDS`, not its
 * flag-gated `attempted`.
 */
function knownOverrideIds(options: AgentGuardrailsOptions): string[] {
  const ids: string[] = [...STATIC_RULE_IDS]
  for (const api of options.noInlineLogic ?? []) ids.push(`preset/agent/no-inline-logic/${api}`)
  return ids
}

/**
 * Ids plan 0100's `attempted` needs: the ones the caller's OPTIONS actually
 * ask for, flag-gated — `assertEnabled` fires when this is empty. NOT for
 * override validation; see {@link knownOverrideIds}.
 *
 * Kept in step with the five `if (options.x)` blocks in `agentGuardrails`
 * itself BY HAND — same shape of fragility this file already notes for
 * `constructed` (review: nothing enforces the two stay copy-identical as
 * flags are added).
 */
function collectRuleIds(options: AgentGuardrailsOptions): string[] {
  const ids: string[] = []
  for (const api of options.noInlineLogic ?? []) ids.push(`preset/agent/no-inline-logic/${api}`)
  if (options.noGenericErrors) ids.push('preset/agent/no-generic-errors')
  if (options.noStubs) ids.push('preset/agent/no-stubs')
  if (options.noEmptyBodies) ids.push('preset/agent/no-empty-bodies')
  if (options.noCopyPaste) ids.push('preset/agent/no-copy-paste')
  return ids
}
