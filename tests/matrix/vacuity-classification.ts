/**
 * Every published export, classified — plan 0095.
 *
 * The property this file exists for: **an export that is in neither list fails the matrix.** A
 * new family joins the vacuity audit by being written down here, and there is no default that
 * would let it join silently. That is the whole mechanism; the lists are just how it is spelled.
 *
 * Two lists rather than a per-export record, because 20 of the 328 published bindings construct
 * something you can call `.check()` on and the other 308 are conditions, predicates, matchers,
 * types and classes. A record with 308 `kind: 'helper'` entries would bury the twenty that matter.
 *
 * `CHECKS` carries a **recipe** and a **unit**. The unit is ADR-009 part 1's requirement that a
 * family name what it counts as a written, reviewed claim rather than an implementer's private
 * interpretation.
 */
import {
  calls,
  call,
  classes,
  correspondence,
  crossLayer,
  functions,
  jsxElements,
  modules,
  slices,
  smells,
  types,
  haveMatchingCounterpart,
} from '../../src/index.js'
import {
  agentGuardrails,
  dataLayerIsolation,
  layeredArchitecture,
  recommended,
  strictBoundaries,
} from '../../src/presets/index.js'
import { resolvers, schema } from '../../src/graphql/index.js'
import type { ArchProject } from '../../src/core/project.js'

/** What a probe needs from a constructed check. `warn()` returns void; the throw is the observable. */
export interface Probeable {
  check(): void
  warn(): void
}

/** What a recipe is given: a project that loaded nothing, and an empty directory. */
export interface Ctx {
  /** A project over a solution-style tsconfig — `"files": []` — so it loads zero source files. */
  project: ArchProject
  /** A directory containing no `.graphql` files, for constructors that take a root. */
  emptyDir: string
}

export interface CheckEntry {
  /** What this family counts as an examined unit (ADR-009 part 1). */
  unit: string
  /**
   * The NEAREST-BARE construction reaching a terminal.
   *
   * Returns `unknown`: presets are typed as `RuleBuilderLike[]`, which exposes only
   * `violations()`, while the objects behind it carry the full terminal surface. The probe
   * narrows with a runtime type guard rather than an assertion (ADR-005) — and the guard is
   * load-bearing, because a recipe that returned something unprobeable would otherwise be
   * silently skipped.
   */
  recipe: (c: Ctx) => unknown
  /**
   * Required when the recipe is not the bare construction. Bug 0066 measured why this matters:
   * bare `.check()` PASSED while `.inFolder(…)` THREW, so a decorated probe certifies the
   * guarded cell and reports the fail-open one as covered.
   */
  deviation?: string
}

export const CHECKS: Record<string, CheckEntry> = {
  // ── the rule-builder grammar ──────────────────────────────────────────────
  // One unit for all of them: `filterElements()` returns the ONE set that is both the
  // selection and what the conditions receive, so examined ≡ selection here. Measured, not
  // assumed — `within()`'s scoped functions were the suspected exception and narrow by
  // overriding `getElements()`, which `filterElements()` calls.
  '.:classes': {
    unit: 'post-filter subjects handed to the conditions',
    recipe: (c) => classes(c.project).should().beExported(),
  },
  '.:functions': {
    unit: 'post-filter subjects handed to the conditions',
    recipe: (c) => functions(c.project).should().beExported(),
  },
  '.:modules': {
    unit: 'post-filter subjects handed to the conditions',
    recipe: (c) => modules(c.project).should().beImported(),
  },
  '.:types': {
    unit: 'post-filter subjects handed to the conditions',
    recipe: (c) => types(c.project).should().beExported(),
  },
  '.:calls': {
    unit: 'post-filter subjects handed to the conditions',
    recipe: (c) => calls(c.project).should().haveCallbackContaining(call('x')),
  },
  '.:jsxElements': {
    unit: 'post-filter subjects handed to the conditions',
    recipe: (c) => jsxElements(c.project).should().haveAttribute('key'),
  },
  '.:slices': {
    unit: 'slices discovered, then their files',
    recipe: (c) => slices(c.project).matching('**/src/*').should().beFreeOfCycles(),
    deviation: 'slices() cannot be constructed without a discovery glob',
  },

  // ── families outside that grammar: each owns its materialization ──────────
  '.:smells.duplicateBodies': {
    unit: 'bodies entering pairwise comparison, post-minLines',
    recipe: (c) => smells.duplicateBodies(c.project),
  },
  '.:smells.inconsistentSiblings': {
    unit: 'the grouped sibling-file set entering partitionByPattern',
    recipe: (c) => smells.inconsistentSiblings(c.project).forPattern(call('x')),
    deviation:
      'bare construction reds on the assertion gate before the vacuity cell is reached, so the bare cell is unobservable for this detector',
  },
  '.:correspondence': {
    unit: 'keys of both sides, summed',
    recipe: (c) => correspondence(c.project).side('left', []).side('right', []).beComplete(),
    deviation:
      'correspondence has no corpus of its own — its sides ARE its input, so the zero-subject cell is two empty sides',
  },
  '.:crossLayer': {
    unit: 'files matched by the left layer',
    recipe: (c) =>
      crossLayer(c.project)
        .layer('a', '**/a/**')
        .layer('b', '**/b/**')
        .mapping(() => true)
        .forEachPair()
        .should(haveMatchingCounterpart()),
    deviation: 'crossLayer cannot be constructed without layers',
  },

  // ── graphql ───────────────────────────────────────────────────────────────
  './graphql:schema': {
    unit: 'schema fields entering the chain',
    recipe: (c) => schema(c.emptyDir, '**/*.graphql').that().queries().should().haveFields('id'),
    deviation: 'schema() requires a glob; it has no bare form',
  },
  './graphql:resolvers': {
    unit: 'collected resolver functions',
    recipe: (c) => resolvers(c.project, '**/*.ts').should().contain(call('x')),
    deviation: 'resolvers() requires a glob',
  },

  // ── presets: they construct N checks, so a recipe returns N probeables ────
  './presets:recommended': { unit: 'per constructed rule', recipe: (c) => recommended(c.project) },
  './presets:agentGuardrails': {
    unit: 'per constructed rule',
    recipe: (c) => agentGuardrails(c.project, { src: '**/src/**', noCopyPaste: true }),
  },
  './presets:strictBoundaries': {
    unit: 'per constructed rule',
    recipe: (c) => strictBoundaries(c.project, { folders: '**/src/*', noCopyPaste: true }),
  },
  './presets:layeredArchitecture': {
    unit: 'per constructed rule',
    recipe: (c) => layeredArchitecture(c.project, { layers: { a: '**/a/**', b: '**/b/**' } }),
  },
  './presets:dataLayerIsolation': {
    // Plan 0100: this minimal call constructs ZERO rules — `unit` describes the
    // OTHER presets' verdict shape, and stays accurate for what this recipe
    // would have measured before 0100. Since 0100, `verdictOf()`'s
    // `hasManufacturedFinding` branch reports this cell's actual verdict
    // (`'config-finding'`, not one-per-rule) — see `KNOWN_FAIL_OPEN`'s comment
    // in vacuity-matrix.test.ts.
    unit: 'per constructed rule',
    recipe: (c) => dataLayerIsolation(c.project, { repositories: '**/repo/**' }),
  },
}

/**
 * Everything else: conditions, predicates, matchers, helpers, classes and type-adjacent values.
 * Generated once from the published surface and reviewed; a NEW name appearing here without a
 * decision is what the completeness assertion refuses.
 *
 * Runtime enumeration cannot see type-only exports — they are erased. Those are covered by the
 * static/runtime pairing in `tests/docs/deprecated-symbols.test.ts`, not here.
 */
export const NO_CORPUS: readonly string[] = [
  // A family whose input IS its argument has no corpus to be empty OF, so the zero-subject
  // cell does not exist for it — asking the question would measure a satisfied assertion and
  // report it as vacuity. Classified explicitly rather than omitted, because "we thought about
  // this one" and "we forgot this one" must not look the same.
  '.:tsconfig', // the requirements object is the input
  './graphql:schemaFromSDL', // the SDL string is the input
]

export const NOT_CHECKS: readonly string[] = [
  './graphql:ResolverRuleBuilder',
  './graphql:SchemaRuleBuilder',
  './graphql:acceptArgs',
  './graphql:haveFields',
  './graphql:haveMatchingResolver',
  './graphql:isGraphQLAvailable',
  './graphql:loadSchemaFromGlob',
  './graphql:loadSchemaFromSDL',
  './graphql:mutations',
  './graphql:queries',
  './graphql:resolveFieldReturning',
  './graphql:returnListOf',
  './graphql:typesNamed',
  './presets:validateOverrides',
  './rules/architecture:classMustCall',
  './rules/architecture:mustCall',
  './rules/code-quality:noMagicNumbers',
  './rules/code-quality:noPublicFields',
  './rules/code-quality:requireJsDocOnPublicMethods',
  './rules/dependencies:mustNotDependOn',
  './rules/dependencies:onlyDependOn',
  './rules/dependencies:typeOnlyFrom',
  './rules/errors:functionNoGenericErrors',
  './rules/errors:functionNoSilentCatch',
  './rules/errors:functionNoTypeErrors',
  './rules/errors:moduleNoSilentCatch',
  './rules/errors:noGenericErrors',
  './rules/errors:noSilentCatch',
  './rules/errors:noTypeErrors',
  './rules/hygiene:noDeadModules',
  './rules/hygiene:noEmptyBodies',
  './rules/hygiene:noStubComments',
  './rules/hygiene:noUnusedExports',
  './rules/metrics:maxClassLines',
  './rules/metrics:maxCyclomaticComplexity',
  './rules/metrics:maxFunctionComplexity',
  './rules/metrics:maxFunctionLines',
  './rules/metrics:maxFunctionParameters',
  './rules/metrics:maxMethodLines',
  './rules/metrics:maxMethods',
  './rules/metrics:maxParameters',
  './rules/naming:mustMatchName',
  './rules/naming:mustNotEndWith',
  './rules/security:functionNoConsole',
  './rules/security:functionNoConsoleLog',
  './rules/security:functionNoEval',
  './rules/security:functionNoFunctionConstructor',
  './rules/security:functionNoJsonParse',
  './rules/security:functionNoProcessEnv',
  './rules/security:moduleNoConsoleLog',
  './rules/security:moduleNoEval',
  './rules/security:moduleNoProcessEnv',
  './rules/security:noConsole',
  './rules/security:noConsoleLog',
  './rules/security:noEval',
  './rules/security:noFunctionConstructor',
  './rules/security:noJsonParse',
  './rules/security:noProcessEnv',
  './rules/typescript:functionNoNonNullAssertions',
  './rules/typescript:functionNoTypeAssertions',
  './rules/typescript:moduleNoNonNullAssertions',
  './rules/typescript:moduleNoTypeAssertions',
  './rules/typescript:noAnyProperties',
  './rules/typescript:noNonNullAssertions',
  './rules/typescript:noTypeAssertions',
  '.:ArchRuleError',
  '.:Baseline',
  '.:CallRuleBuilder',
  '.:ClassRuleBuilder',
  '.:CorrespondenceBuilder',
  '.:CrossLayerBuilder',
  '.:DiffFilter',
  '.:DuplicateBodiesBuilder',
  '.:FunctionRuleBuilder',
  '.:InconsistentSiblingsBuilder',
  '.:JsxRuleBuilder',
  '.:ModuleRuleBuilder',
  '.:RuleBuilder',
  '.:STANDARD_HTML_TAGS',
  '.:STUB_PATTERNS',
  '.:ScopedFunctionRuleBuilder',
  '.:SliceRuleBuilder',
  '.:SmellBuilder',
  '.:TerminalBuilder',
  '.:TsconfigBuilder',
  '.:TypeRuleBuilder',
  '.:access',
  '.:and',
  '.:areAbstract',
  '.:areAsync',
  '.:areComponents',
  '.:areExported',
  '.:areHtmlElements',
  '.:areInterfaces',
  '.:areNotAsync',
  '.:areNotExported',
  '.:arePrivate',
  '.:areProtected',
  '.:arePublic',
  '.:areTypeAliases',
  '.:arrayOf',
  '.:beExported',
  '.:beFreeOfCycles',
  '.:beImported',
  '.:buildFingerprint',
  '.:byArg',
  '.:byName',
  '.:byPropertyNames',
  '.:call',
  '.:callHaveArgumentContaining',
  '.:callHaveCallbackContaining',
  '.:callNotExist',
  '.:callNotHaveArgumentContaining',
  '.:callNotHaveCallbackContaining',
  '.:checkAll',
  '.:classAcceptParameterOfType',
  '.:classContain',
  '.:classHaveMethodNamed',
  '.:classMustCall',
  '.:classNotAcceptParameterOfType',
  '.:classNotContain',
  '.:classNotHaveEmptyBody',
  '.:classUseInsteadOf',
  '.:collectCalls',
  '.:collectFunctions',
  '.:collectJsxElements',
  '.:collectObjectLiteralFunctions',
  '.:collectViolations',
  '.:combineGlobs',
  '.:comment',
  '.:computeSimilarity',
  '.:conditionHaveNameMatching',
  '.:conditionHavePropertyMatching',
  '.:conditionHavePropertyNamed',
  '.:conditionNotHavePropertyMatching',
  '.:conditionNotHavePropertyNamed',
  '.:conditionNotImportFrom',
  '.:conditionResideInFile',
  '.:conditionResideInFolder',
  '.:createViolation',
  '.:cyclomaticComplexity',
  '.:defineCondition',
  '.:defineConfig',
  '.:definePattern',
  '.:definePredicate',
  '.:dependOn',
  '.:detectFormat',
  '.:diagnose',
  '.:diffAware',
  '.:exactly',
  '.:exportSymbolNamed',
  '.:expression',
  '.:extend',
  '.:extendType',
  '.:extractCallbacks',
  '.:followPattern',
  '.:formatViolations',
  '.:formatViolationsGitHub',
  '.:formatViolationsJson',
  '.:formatViolationsPlain',
  '.:fromArrowVariableDeclaration',
  '.:fromCallExpression',
  '.:fromFunctionDeclaration',
  '.:fromMethodDeclaration',
  '.:fromObjectLiteralFunction',
  '.:functionAcceptParameterOfType',
  '.:functionBeAsync',
  '.:functionBeExported',
  '.:functionContain',
  '.:functionHaveNameMatching',
  '.:functionHaveReturnTypeMatching',
  '.:functionNoConsole',
  '.:functionNoConsoleLog',
  '.:functionNoEval',
  '.:functionNoFunctionConstructor',
  '.:functionNoGenericErrors',
  '.:functionNoJsonParse',
  '.:functionNoProcessEnv',
  '.:functionNoSilentCatch',
  '.:functionNoTypeErrors',
  '.:functionNotAcceptParameterOfType',
  '.:functionNotContain',
  '.:functionNotExist',
  '.:functionNotHaveEmptyBody',
  '.:functionUseInsteadOf',
  '.:generateBaseline',
  '.:generateCodeFrame',
  '.:getElementFile',
  '.:getElementLine',
  '.:getElementName',
  '.:globAnyOf',
  '.:globNode',
  '.:haveArgumentWithProperty',
  '.:haveComplexity',
  '.:haveConsistentExports',
  '.:haveCyclomaticComplexity',
  '.:haveDecorator',
  '.:haveDecoratorMatching',
  '.:haveDefaultExport',
  '.:haveMatchingCounterpart',
  '.:haveMaxExports',
  '.:haveMethodMatching',
  '.:haveMoreFunctionLinesThan',
  '.:haveMoreLinesThan',
  '.:haveMoreMethodsThan',
  '.:haveNameEndingWith',
  '.:haveNameMatching',
  '.:haveNameStartingWith',
  '.:haveNoUnusedExports',
  '.:haveOnlyReadonlyProperties',
  '.:haveOptionalParameter',
  '.:haveParameterCount',
  '.:haveParameterCountGreaterThan',
  '.:haveParameterCountLessThan',
  '.:haveParameterNameMatching',
  '.:haveParameterNamed',
  '.:haveParameterOfType',
  '.:havePathMatching',
  '.:haveProperty',
  '.:havePropertyNamed',
  '.:havePropertyOfType',
  '.:havePropertyType',
  '.:haveRestParameter',
  '.:haveReturnType',
  '.:implement',
  '.:importFrom',
  '.:isBoolean',
  '.:isCI',
  '.:isExcludedByComment',
  '.:isNumber',
  '.:isString',
  '.:isStringLiteral',
  '.:isTypeOnlyImport',
  '.:isUnionOfLiterals',
  '.:jsxElement',
  '.:jsxHaveAttribute',
  '.:jsxHaveAttributeMatching',
  '.:jsxNotExist',
  '.:jsxNotHaveAttribute',
  '.:jsxNotHaveAttributeMatching',
  '.:jsxText',
  '.:jsxWithAttribute',
  '.:jsxWithAttributeMatching',
  '.:linesOfCode',
  '.:matching',
  '.:maxProperties',
  '.:moduleContain',
  '.:moduleNoConsoleLog',
  '.:moduleNoEval',
  '.:moduleNoProcessEnv',
  '.:moduleNoSilentCatch',
  '.:moduleNotContain',
  '.:moduleUseInsteadOf',
  '.:mustCall',
  '.:negateGlobs',
  '.:newExpr',
  '.:noConsole',
  '.:noConsoleLog',
  '.:noDeadModules',
  '.:noEmptyBodies',
  '.:noEval',
  '.:noFunctionConstructor',
  '.:noGenericErrors',
  '.:noJsonParse',
  '.:noProcessEnv',
  '.:noSilentCatch',
  '.:noStubComments',
  '.:noTypeErrors',
  '.:noUnusedExports',
  '.:nonNullAssertion',
  '.:not',
  '.:notDependOn',
  '.:notExist',
  '.:notHaveAliasedImports',
  '.:notHaveArgumentWithProperty',
  '.:notHaveDefaultExport',
  '.:onObject',
  '.:onlyBeImportedVia',
  '.:onlyHaveTypeImportsFrom',
  '.:onlyImportFrom',
  '.:or',
  '.:orphanExclusions',
  '.:parseExclusionComments',
  '.:predicateNotImportFrom',
  '.:project',
  '.:property',
  '.:remedyRepeatsMessage',
  '.:resetProjectCache',
  '.:resideInFile',
  '.:resideInFolder',
  '.:respectLayerOrder',
  '.:satisfyPairCondition',
  '.:setCorrespondence',
  '.:severityFor',
  '.:shouldExtend',
  '.:shouldHaveMethodNamed',
  '.:shouldImplement',
  '.:shouldNotHaveMethodMatching',
  '.:silent',
  '.:smells',
  '.:stampGlobs',
  '.:typeAssertion',
  '.:withArgMatching',
  '.:withBaseline',
  '.:withMethod',
  '.:withStringArg',
  '.:within',
  '.:workspace',
]
