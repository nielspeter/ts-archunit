import type { ArchProject } from '../core/project.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import type { Condition } from '../core/condition.js'
import type { ArchFunction } from '../models/arch-function.js'
import { functions } from '../builders/function-rule-builder.js'
import { functionNoEval, functionNoFunctionConstructor } from '../rules/security.js'
import { functionNoSilentCatch } from '../rules/errors.js'
import { noEmptyBodies } from '../rules/hygiene.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import type { PresetBaseOptions } from './shared.js'
import { validateOverrides } from './shared.js'

export interface RecommendedOptions extends PresetBaseOptions {
  /**
   * Source-file glob the rules apply to. Defaults to `'**\/src/**'`, matched
   * against each file's absolute path (picomatch). This scopes the rules to your
   * source tree by convention — it does NOT itself exclude `node_modules` or
   * generated files (any `src/` segment anywhere in the path matches). Projects
   * whose source lives outside a `src/` folder (e.g. `lib/`) should override.
   * Note: because the match is on the absolute path, an ancestor directory named
   * `src` (e.g. a clone under `~/src/`) widens scope — anchor with a project-root
   * glob if that matters.
   */
  include?: string
}

interface RuleSpec {
  condition: Condition<ArchFunction>
  meta: RuleMetadata & { id: string }
  default: 'error' | 'warn'
}

/**
 * Single source of truth for the floor. `RULE_IDS` (for override validation) and
 * the builder loop both derive from this — add a rule here and nothing else
 * needs updating.
 */
const SPECS: readonly RuleSpec[] = [
  {
    condition: functionNoEval(),
    meta: {
      id: 'preset/recommended/no-eval',
      because: 'eval() executes arbitrary code — a code-injection risk',
      suggestion: 'remove eval(); parse or dispatch explicitly',
      imperative: 'Do NOT call eval()',
    },
    default: 'error',
  },
  {
    condition: functionNoFunctionConstructor(),
    meta: {
      id: 'preset/recommended/no-function-constructor',
      because: 'the Function constructor is eval() in disguise',
      suggestion: 'define the function directly instead of building it from a string',
      imperative: 'Do NOT use the Function constructor',
    },
    default: 'error',
  },
  {
    condition: functionNoSilentCatch(),
    meta: {
      id: 'preset/recommended/no-silent-catch',
      because: 'a silent catch hides failures',
      suggestion: 'handle or rethrow the caught error (reference it in the catch)',
      imperative: 'Do NOT swallow errors in an empty catch',
    },
    default: 'warn',
  },
  {
    condition: noEmptyBodies(),
    meta: {
      id: 'preset/recommended/no-empty-bodies',
      because: 'an empty function body is usually an unfinished stub',
      suggestion: 'implement the body or remove the function',
      imperative: 'Do NOT leave a function body empty',
    },
    default: 'warn',
  },
]

const RULE_IDS = SPECS.map((s) => s.meta.id)

/**
 * A deliberately **thin, universal safety floor** for any TypeScript project —
 * the handful of things dangerous regardless of project shape that fire ~never
 * on healthy code. Not a full architecture: shape-specific rules (layer order,
 * cycles, delegation) are yours to add.
 *
 * Returns severity-carrying builders (the returning form), so spread it into a
 * rule file: `export default [...recommended(p)]`. The two `error` rules fail
 * the run; the two `warn` rules (silent-catch, empty-bodies) are reported but
 * never fail — they have known, suppressible false positives.
 *
 * Overlaps `agentGuardrails` on empty bodies and `eval`. For agent-focused
 * projects prefer `agentGuardrails` alone, or override the duplicated ids to
 * `'off'` in one preset.
 */
export function recommended(p: ArchProject, options: RecommendedOptions = {}): RuleBuilderLike[] {
  const include = options.include ?? '**/src/**'
  validateOverrides(options.overrides, RULE_IDS)

  const builders: RuleBuilderLike[] = []
  for (const { condition, meta, default: def } of SPECS) {
    const sev = options.overrides?.[meta.id] ?? def
    if (sev === 'off') continue
    builders.push(
      functions(p)
        .that()
        .resideInFile(include)
        .should()
        .satisfy(condition)
        .rule(meta)
        .asSeverity(sev),
    )
  }

  return builders
}
