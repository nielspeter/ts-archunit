/**
 * Dogfood: Architecture rules for ts-archunit itself.
 *
 * These rules enforce our own ADRs on our own codebase.
 */
import { describe, it } from 'vitest'
import { project, modules, classes, functions, slices, call } from '../../src/index.js'
import { noAnyProperties, noTypeAssertions } from '../../src/rules/typescript.js'
import { noEval, noConsoleLog } from '../../src/rules/security.js'
import { noGenericErrors } from '../../src/rules/errors.js'

const p = project('tsconfig.json')

// ─── ADR-005: No any types, no type assertions ──────────────────────

describe('ADR-005: Type Safety', () => {
  it('source classes must not have any-typed properties', () => {
    classes(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .satisfy(noAnyProperties())
      .because('ADR-005: use specific types or unknown instead of any')
      .check()
  })

  it('source classes must not use type assertions in methods', () => {
    classes(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .satisfy(noTypeAssertions())
      .because('ADR-005: use type guards instead of as casts')
      .check()
  })
})

// ─── ADR-004: ESM only ──────────────────────────────────────────────

describe('ADR-004: ESM', () => {
  it('no require() calls in source', () => {
    classes(p)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notContain(call('require'))
      .because('ADR-004: ESM only, no CommonJS require()')
      .check()
  })

  it('no module.exports in source', () => {
    functions(p)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notContain(call('require'))
      .because('ADR-004: ESM only')
      .check()
  })
})

// ─── ADR-002: ts-morph only ─────────────────────────────────────────

describe('ADR-002: ts-morph as AST engine', () => {
  it('source must not import typescript compiler API directly', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notImportFrom('**/node_modules/typescript/**')
      .because('ADR-002: use ts-morph, not raw TypeScript compiler API')
      .check()
  })
})

// ─── Code Quality ───────────────────────────────────────────────────

describe('Code Quality', () => {
  it('no eval()', () => {
    classes(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .satisfy(noEval())
      .because('eval is a security risk')
      .check()
  })

  it('no generic Error', () => {
    classes(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .satisfy(noGenericErrors())
      .because('use typed domain errors')
      .check()
  })

  it('builders must be exported', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Builder')
      .and()
      .resideInFolder('**/src/builders/**')
      .should()
      .beExported()
      .check()
  })

  it('entry point functions must be exported', () => {
    functions(p)
      .that()
      .haveNameMatching(/^(modules|classes|functions|types|slices|project)$/)
      .and()
      .resideInFolder('**/src/**')
      .should()
      .beExported()
      .check()
  })
})

// ─── Architecture ───────────────────────────────────────────────────

describe('Architecture', () => {
  it('helpers must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/helpers/**')
      .should()
      .notImportFrom('**/src/builders/**')
      .because('helpers are lower-level than builders')
      .check()
  })

  it('core must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFrom('**/src/builders/**')
      .because('core must not depend on entry points')
      .check()
  })

  it('predicates must not import from conditions', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/predicates/**')
      .should()
      .notImportFrom('**/src/conditions/**')
      .because('predicates and conditions are independent')
      .check()
  })

  it('models must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/models/**')
      .should()
      .notImportFrom('**/src/builders/**')
      .because('models are lower-level than builders')
      .check()
  })

  it('conditions must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/conditions/**')
      .should()
      .notImportFrom('**/src/builders/**')
      .because('conditions are lower-level than builders')
      .check()
  })

  it('no cycles between source modules', () => {
    slices(p)
      .assignedFrom({
        core: '**/src/core/**',
        builders: '**/src/builders/**',
        predicates: '**/src/predicates/**',
        conditions: '**/src/conditions/**',
        helpers: '**/src/helpers/**',
        models: '**/src/models/**',
      })
      .should()
      .beFreeOfCycles()
      .because('source modules must have a clean dependency graph')
      .check()
  })
})

// ─── No console.log ──────────────────────────────────────────────────

describe('No console.log in Source', () => {
  it('source classes must not call console.log', () => {
    classes(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .satisfy(noConsoleLog())
      .because('use console.warn for warnings or throw for errors')
      .check()
  })

  it('source functions must not call console.log', () => {
    functions(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .notContain(call('console.log'))
      .because('use console.warn for warnings or throw for errors')
      .check()
  })
})
