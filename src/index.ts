// Core — project loader
export { project } from './core/project.js'
export type { ArchProject } from './core/project.js'

// Core — predicate interface & combinators
export type { Predicate } from './core/predicate.js'
export { and, or, not } from './core/predicate.js'

// Core — condition interface & violation model
export type { Condition, ConditionContext } from './core/condition.js'
export type { ArchViolation } from './core/violation.js'
export { createViolation, getElementName, getElementFile, getElementLine } from './core/violation.js'

// Core — rule builder & error
export { RuleBuilder } from './core/rule-builder.js'
export { ArchRuleError } from './core/errors.js'

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
export { collectFunctions, fromFunctionDeclaration, fromArrowVariableDeclaration } from './models/arch-function.js'

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
