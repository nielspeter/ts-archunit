/**
 * Example: Enforce strict type safety across a codebase
 *
 * Uses the standard rules from ts-archunit/rules/typescript and
 * ts-archunit/rules/security — no custom conditions needed.
 */
import { describe, it } from 'vitest'
import {
  project,
  classes,
  functions,
  types,
  notType,
  isString,
  access,
} from '@nielspeter/ts-archunit'
import {
  noAnyProperties,
  noTypeAssertions,
  noNonNullAssertions,
} from '@nielspeter/ts-archunit/rules/typescript'
import {
  noEval,
  noFunctionConstructor,
  noConsoleLog,
  noProcessEnv,
} from '@nielspeter/ts-archunit/rules/security'

const p = project('tsconfig.json')

// ─── TypeScript Type Safety ──────────────────────────────────────────

describe('TypeScript Type Safety', () => {
  it('classes must not have any-typed properties', () => {
    classes(p)
      .that()
      .areExported()
      .should()
      .satisfy(noAnyProperties())
      .because('any bypasses the type checker')
      .check()
  })

  it('service classes must not use type assertions', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Service')
      .should()
      .satisfy(noTypeAssertions())
      .because('use type guards or explicit type annotations instead of as casts')
      .check()
  })

  it('domain classes must not use non-null assertions', () => {
    classes(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .satisfy(noNonNullAssertions())
      .because('non-null assertions hide potential runtime errors')
      .check()
  })

  it('query options must use typed unions, not bare string', () => {
    types(p)
      .that()
      .haveNameMatching(/Options$/)
      .and()
      .haveProperty('orderBy')
      .should()
      .havePropertyType('orderBy', notType(isString()))
      .because('bare string types defeat the purpose of TypeScript')
      .check()
  })
})

// ─── Security ────────────────────────────────────────────────────────

describe('Security', () => {
  it('no eval() calls', () => {
    classes(p).should().satisfy(noEval()).because('eval is a security risk').check()
  })

  it('no Function constructor', () => {
    classes(p)
      .should()
      .satisfy(noFunctionConstructor())
      .because('new Function() is equivalent to eval')
      .check()
  })

  it('no console.log in production code', () => {
    classes(p)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .satisfy(noConsoleLog())
      .because('use a logger abstraction')
      .check()
  })

  it('no direct process.env access in domain layer', () => {
    classes(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .satisfy(noProcessEnv())
      .because('use dependency injection for configuration')
      .check()
  })
})
