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
