// Core — project loader
export { project, workspace, resetProjectCache } from './core/project.js'
export type { ArchProject } from './core/project.js'

// Core — predicate interface & combinators
export type { Predicate } from './core/predicate.js'
export { not, and, or } from './core/combinators.js'

// Core — condition interface & violation model
export type { Condition, ConditionContext } from './core/condition.js'
export type { ArchViolation } from './core/violation.js'
export {
  createViolation,
  getElementName,
  getElementFile,
  getElementLine,
} from './core/violation.js'

// Core — rule builder, error & metadata
export { RuleBuilder } from './core/rule-builder.js'
export { TerminalBuilder } from './core/terminal-builder.js'
export { ArchRuleError } from './core/errors.js'
export type { RuleMetadata } from './core/rule-metadata.js'
export type { RuleDescription } from './core/rule-description.js'

// Core — code frame & formatting
export { generateCodeFrame } from './core/code-frame.js'
export type { CodeFrameOptions } from './core/code-frame.js'
export { formatViolations, formatViolationsPlain } from './core/format.js'
export type { FormatOptions } from './core/format.js'

// Core — custom predicate/condition factories
export { definePredicate, defineCondition } from './core/define.js'

// Identity predicates
export type { Named, Located, Exportable } from './predicates/index.js'
export {
  haveNameMatching,
  haveNameStartingWith,
  haveNameEndingWith,
  resideInFile,
  resideInFolder,
  areExported,
  areNotExported,
} from './predicates/index.js'

// Structural conditions
export {
  resideInFile as conditionResideInFile,
  resideInFolder as conditionResideInFolder,
  haveNameMatching as conditionHaveNameMatching,
  beExported,
  notExist,
} from './conditions/structural.js'

// Module predicates
export {
  importFrom,
  notImportFrom as predicateNotImportFrom,
  exportSymbolNamed,
  havePathMatching,
} from './predicates/module.js'

// Dependency conditions
export type { ImportOptions } from './core/import-options.js'
export { isTypeOnlyImport } from './core/import-options.js'
export {
  onlyImportFrom,
  notImportFrom as conditionNotImportFrom,
  onlyHaveTypeImportsFrom,
  notHaveAliasedImports,
  dependOn,
} from './conditions/dependency.js'

// Module entry point
export { modules, ModuleRuleBuilder } from './builders/module-rule-builder.js'

// Class entry point
export { classes, ClassRuleBuilder } from './builders/class-rule-builder.js'

// Class predicates (standalone)
export {
  extend,
  implement,
  haveDecorator,
  haveDecoratorMatching,
  areAbstract,
  haveMethodNamed as classHaveMethodNamed,
  haveMethodMatching,
  havePropertyNamed,
} from './predicates/class.js'

// Class conditions (standalone)
export {
  shouldExtend,
  shouldImplement,
  shouldHaveMethodNamed,
  shouldNotHaveMethodMatching,
  acceptParameterOfType as classAcceptParameterOfType,
  notAcceptParameterOfType as classNotAcceptParameterOfType,
} from './conditions/class.js'

// Function entry point
export { functions, FunctionRuleBuilder } from './builders/function-rule-builder.js'
export type { ArchFunction } from './models/arch-function.js'
export {
  collectFunctions,
  fromFunctionDeclaration,
  fromArrowVariableDeclaration,
  fromMethodDeclaration,
} from './models/arch-function.js'

// Function predicates
export {
  arePublic,
  areProtected,
  arePrivate,
  areAsync,
  areNotAsync,
  haveParameterCount,
  haveParameterCountGreaterThan,
  haveParameterCountLessThan,
  haveParameterNamed,
  haveReturnType,
  haveRestParameter,
  haveOptionalParameter,
  haveParameterOfType,
  haveParameterNameMatching,
} from './predicates/function.js'

// Function conditions
export {
  notExist as functionNotExist,
  beExported as functionBeExported,
  beAsync as functionBeAsync,
  haveNameMatching as functionHaveNameMatching,
  acceptParameterOfType as functionAcceptParameterOfType,
  notAcceptParameterOfType as functionNotAcceptParameterOfType,
  haveReturnTypeMatching as functionHaveReturnTypeMatching,
} from './conditions/function.js'

// Type entry point
export { types, TypeRuleBuilder } from './builders/type-rule-builder.js'

// Type predicates
export type { TypeDeclaration } from './predicates/type.js'
export {
  areInterfaces,
  areTypeAliases,
  haveProperty,
  havePropertyOfType,
  extendType,
} from './predicates/type.js'

// Type-level conditions
export { havePropertyType } from './conditions/type-level.js'

// Member property conditions (plan 0030)
export {
  havePropertyNamed as conditionHavePropertyNamed,
  notHavePropertyNamed as conditionNotHavePropertyNamed,
  havePropertyMatching as conditionHavePropertyMatching,
  notHavePropertyMatching as conditionNotHavePropertyMatching,
  haveOnlyReadonlyProperties,
  maxProperties,
} from './conditions/members.js'

// Re-export the PropertyBearingNode type for custom condition authors
export type { PropertyBearingNode } from './conditions/members.js'

// Type matchers
export type { TypeMatcher } from './helpers/type-matchers.js'
export {
  isString,
  isNumber,
  isBoolean,
  isUnionOfLiterals,
  isStringLiteral,
  arrayOf,
  matching,
  exactly,
} from './helpers/type-matchers.js'

// Body analysis helpers (plan 0011)
export {
  call,
  access,
  newExpr,
  expression,
  property,
  comment,
  STUB_PATTERNS,
} from './helpers/matchers.js'
export type { ExpressionMatcher } from './helpers/matchers.js'

// Body analysis conditions (for advanced composition)
export {
  classContain,
  classNotContain,
  classUseInsteadOf,
  classNotHaveEmptyBody,
} from './conditions/body-analysis.js'
export {
  functionContain,
  functionNotContain,
  functionUseInsteadOf,
  functionNotHaveEmptyBody,
} from './conditions/body-analysis-function.js'
export {
  moduleContain,
  moduleNotContain,
  moduleUseInsteadOf,
} from './conditions/body-analysis-module.js'
export type { ModuleBodyOptions } from './helpers/body-traversal.js'

// Export conditions (plan 0041 phase 3)
export { notHaveDefaultExport, haveDefaultExport, haveMaxExports } from './conditions/exports.js'

// Reverse dependency conditions (plan 0041 phase 4)
export {
  onlyBeImportedVia,
  beImported,
  haveNoUnusedExports,
} from './conditions/reverse-dependency.js'

// Slice model (plan 0012)
export type { Slice, SliceDefinition } from './models/slice.js'

// Slice conditions
export { beFreeOfCycles, respectLayerOrder, notDependOn } from './conditions/slice.js'

// Slice entry point
export { slices, SliceRuleBuilder } from './builders/slice-rule-builder.js'

// Check options
export type { CheckOptions, OutputFormat } from './core/check-options.js'

// Output formats
export { formatViolationsJson } from './core/format-json.js'
export { formatViolationsGitHub } from './core/format-github.js'
export { detectFormat, isCI } from './core/environment.js'

// Baseline mode
export { withBaseline, generateBaseline, Baseline } from './helpers/baseline.js'
export type { BaselineEntry, BaselineFile } from './helpers/baseline.js'

// Diff-aware mode
export { diffAware, DiffFilter } from './helpers/diff-aware.js'

// Exclusion comments
export { parseExclusionComments, isExcludedByComment } from './core/exclusion-comments.js'
export type { ExclusionComment, ExclusionWarning, ParseResult } from './core/exclusion-comments.js'

// Silent exclusion wrapper
export { silent } from './core/silent-exclusion.js'
export type { SilentExclusion } from './core/silent-exclusion.js'

// Baseline generation helper
export { collectViolations } from './helpers/baseline-generator.js'

// Call entry point (plan 0014)
export { calls, CallRuleBuilder } from './builders/call-rule-builder.js'
export type { ArchCall } from './models/arch-call.js'
export { collectCalls, fromCallExpression } from './models/arch-call.js'

// Call predicates (standalone)
export { onObject, withMethod, withArgMatching, withStringArg } from './predicates/call.js'

// Call conditions (standalone)
export {
  haveCallbackContaining as callHaveCallbackContaining,
  notHaveCallbackContaining as callNotHaveCallbackContaining,
  notExist as callNotExist,
  haveArgumentWithProperty,
  notHaveArgumentWithProperty,
  haveArgumentContaining as callHaveArgumentContaining,
  notHaveArgumentContaining as callNotHaveArgumentContaining,
} from './conditions/call.js'

// Scoped rules --- within() (plan 0015)
export { within } from './helpers/within.js'
export type { ScopedContext } from './helpers/within.js'
export { ScopedFunctionRuleBuilder } from './builders/scoped-function-rule-builder.js'

// Callback extraction (plan 0015)
export { extractCallbacks } from './helpers/callback-extractor.js'
export type { ExtractedCallback } from './helpers/callback-extractor.js'

// Pattern templates (plan 0017)
export { definePattern } from './helpers/pattern.js'
export type { ArchPattern, PropertyConstraint } from './helpers/pattern.js'
export { followPattern } from './conditions/pattern.js'

// Smell detectors (plan 0018)
export { smells } from './smells/index.js'
export { SmellBuilder } from './smells/smell-builder.js'
export { DuplicateBodiesBuilder } from './smells/duplicate-bodies.js'
export { InconsistentSiblingsBuilder } from './smells/inconsistent-siblings.js'
export type { Fingerprint } from './smells/fingerprint.js'
export { buildFingerprint, computeSimilarity } from './smells/fingerprint.js'

// Cross-layer validation (plan 0022)
export type { Layer, LayerPair } from './models/cross-layer.js'
export type { PairCondition } from './core/pair-condition.js'
export { crossLayer, CrossLayerBuilder } from './builders/cross-layer-builder.js'
export {
  haveMatchingCounterpart,
  haveConsistentExports,
  satisfyPairCondition,
} from './conditions/cross-layer.js'

// Metric predicates (plan 0028)
export {
  haveCyclomaticComplexity,
  haveMoreLinesThan,
  haveMoreMethodsThan,
  haveComplexity,
  haveMoreFunctionLinesThan,
} from './predicates/metrics.js'

// Complexity calculator (for custom rules)
export { cyclomaticComplexity, linesOfCode } from './helpers/complexity.js'

// Standard rules — security function/module variants (plan 0042)
export {
  noEval,
  noFunctionConstructor,
  noProcessEnv,
  noConsoleLog,
  noConsole,
  noJsonParse,
  functionNoEval,
  functionNoFunctionConstructor,
  functionNoProcessEnv,
  functionNoConsoleLog,
  functionNoConsole,
  functionNoJsonParse,
  moduleNoEval,
  moduleNoProcessEnv,
  moduleNoConsoleLog,
} from './rules/security.js'

// Standard rules — error function variants (plan 0042)
export {
  noGenericErrors,
  noTypeErrors,
  functionNoGenericErrors,
  functionNoTypeErrors,
  noSilentCatch,
  functionNoSilentCatch,
  moduleNoSilentCatch,
} from './rules/errors.js'

// Standard rules — architecture (plan 0042)
export { mustCall, classMustCall } from './rules/architecture.js'

// Standard rules — hygiene (plan 0042)
export { noDeadModules, noUnusedExports, noStubComments, noEmptyBodies } from './rules/hygiene.js'

// CLI config (plan 0020)
export { defineConfig } from './cli/config.js'
export type { CliConfig } from './cli/config.js'
