// Core — project loader
export { project } from './core/project.js'
export type { ArchProject } from './core/project.js'

// Core — predicate interface & combinators
export type { Predicate } from './core/predicate.js'
export { and, or, not } from './core/predicate.js'

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
export { ArchRuleError } from './core/errors.js'
export type { RuleMetadata } from './core/rule-metadata.js'

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
export {
  onlyImportFrom,
  notImportFrom as conditionNotImportFrom,
  onlyHaveTypeImportsFrom,
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
  areAsync,
  areNotAsync,
  haveParameterCount,
  haveParameterCountGreaterThan,
  haveParameterCountLessThan,
  haveParameterNamed,
  haveReturnType,
} from './predicates/function.js'

// Function conditions
export {
  notExist as functionNotExist,
  beExported as functionBeExported,
  beAsync as functionBeAsync,
  haveNameMatching as functionHaveNameMatching,
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

// Type matchers
export type { TypeMatcher } from './helpers/type-matchers.js'
export {
  not as notType,
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
export { call, access, newExpr, expression } from './helpers/matchers.js'
export type { ExpressionMatcher } from './helpers/matchers.js'

// Body analysis conditions (for advanced composition)
export { classContain, classNotContain, classUseInsteadOf } from './conditions/body-analysis.js'
export {
  functionContain,
  functionNotContain,
  functionUseInsteadOf,
} from './conditions/body-analysis-function.js'

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

// CLI config (plan 0020)
export { defineConfig } from './cli/config.js'
export type { CliConfig } from './cli/config.js'
