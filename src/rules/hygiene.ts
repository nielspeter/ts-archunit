import type { SourceFile } from 'ts-morph'
import type { Condition } from '../core/condition.js'
import type { ArchFunction } from '../models/arch-function.js'
import { comment, STUB_PATTERNS } from '../helpers/matchers.js'
import { beImported, haveNoUnusedExports } from '../conditions/reverse-dependency.js'
import {
  functionNotContain,
  functionNotHaveEmptyBody,
} from '../conditions/body-analysis-function.js'

/**
 * Module must be imported by at least one other module.
 * Detects dead/orphaned files that nobody references.
 *
 * Exclude entry points (index.ts, main.ts) via .excluding().
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noDeadModules())
 *   .excluding('index.ts', 'main.ts')
 *   .check()
 */
export function noDeadModules(): Condition<SourceFile> {
  return beImported()
}

/**
 * Every exported symbol must be referenced by at least one other file.
 * Detects exports that bloat the public API without consumers.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noUnusedExports())
 *   .check()
 */
export function noUnusedExports(): Condition<SourceFile> {
  return haveNoUnusedExports()
}

/**
 * No stub/TODO/FIXME comments in function bodies.
 * Catches: TODO, FIXME, HACK, XXX, STUB, DEFERRED, PLACEHOLDER,
 * "not implemented", "coming soon".
 *
 * Pass a custom pattern to override the defaults.
 *
 * @example
 * functions(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noStubComments())
 *   .check()
 */
export function noStubComments(pattern: RegExp = STUB_PATTERNS): Condition<ArchFunction> {
  return functionNotContain(comment(pattern))
}

/**
 * Functions must not have empty bodies.
 * An empty function compiles and passes type checks but does nothing.
 *
 * @example
 * functions(p)
 *   .that().resideInFolder('src/**')
 *   .should().satisfy(noEmptyBodies())
 *   .check()
 */
export function noEmptyBodies(): Condition<ArchFunction> {
  return functionNotHaveEmptyBody()
}
