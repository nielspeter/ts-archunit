/**
 * Example: Architecture rules for a REST API backend
 *
 * Assumes a project structure like:
 *   src/domain/        — entities, value objects, business rules (no framework deps)
 *   src/services/      — application services, orchestration
 *   src/repositories/  — data access, database queries
 *   src/controllers/   — route handlers, HTTP layer
 *   src/shared/        — utilities, types, constants
 */
import { describe, it } from 'vitest'
import {
  project,
  modules,
  classes,
  functions,
  types,
  slices,
  call,
  newExpr,
  notType,
  isString,
} from 'ts-archunit'

const p = project('tsconfig.json')

// ─── Layer Dependencies ──────────────────────────────────────────────

describe('Layer Dependencies', () => {
  it('domain must not import from infrastructure', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .because('domain layer must be independent of infrastructure')
      .check()
  })

  it('repositories must not import from controllers', () => {
    modules(p)
      .that()
      .resideInFolder('**/repositories/**')
      .should()
      .notImportFrom('**/controllers/**')
      .check()
  })

  it('layers must respect dependency direction', () => {
    slices(p)
      .assignedFrom({
        controllers: 'src/controllers/**',
        services: 'src/services/**',
        repositories: 'src/repositories/**',
        domain: 'src/domain/**',
      })
      .should()
      .respectLayerOrder('controllers', 'services', 'repositories', 'domain')
      .because('dependencies flow inward: controllers → services → repositories → domain')
      .check()
  })
})

// ─── Cycle Detection ─────────────────────────────────────────────────

describe('Cycle Detection', () => {
  it('no circular dependencies between feature modules', () => {
    slices(p)
      .matching('src/features/*/')
      .should()
      .beFreeOfCycles()
      .because('feature modules must be independently deployable')
      .check()
  })
})

// ─── Naming Conventions ──────────────────────────────────────────────

describe('Naming Conventions', () => {
  it('controllers must end with Controller', () => {
    classes(p)
      .that()
      .resideInFolder('**/controllers/**')
      .should()
      .haveNameMatching(/Controller$/)
      .check()
  })

  it('services must end with Service', () => {
    classes(p)
      .that()
      .resideInFolder('**/services/**')
      .should()
      .haveNameMatching(/Service$/)
      .check()
  })

  it('repositories must end with Repository', () => {
    classes(p)
      .that()
      .resideInFolder('**/repositories/**')
      .should()
      .haveNameMatching(/Repository$/)
      .check()
  })
})

// ─── Class Structure ─────────────────────────────────────────────────

describe('Class Structure', () => {
  it('repositories must extend BaseRepository', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Repository')
      .and()
      .resideInFolder('**/repositories/**')
      .should()
      .shouldExtend('BaseRepository')
      .check()
  })

  it('services must be exported', () => {
    classes(p).that().haveNameEndingWith('Service').should().beExported().check()
  })
})

// ─── Body Analysis ───────────────────────────────────────────────────

describe('Body Analysis', () => {
  it('repositories must not call parseInt directly', () => {
    classes(p)
      .that()
      .extend('BaseRepository')
      .should()
      .notContain(call('parseInt'))
      .because('use this.extractCount() from BaseRepository')
      .check()
  })

  it('repositories must use typed errors, not generic Error', () => {
    classes(p)
      .that()
      .extend('BaseRepository')
      .should()
      .notContain(newExpr('Error'))
      .because('use NotFoundError, ValidationError, etc.')
      .check()
  })

  it('SDK wrappers must not use raw URLSearchParams', () => {
    functions(p)
      .that()
      .resideInFolder('**/wrappers/**')
      .should()
      .notContain(newExpr('URLSearchParams'))
      .because('use buildQueryString() utility')
      .check()
  })

  it('no copy-pasted order parsers in routes', () => {
    functions(p)
      .that()
      .haveNameMatching(/^parse\w+Order$/)
      .and()
      .resideInFolder('**/routes/**')
      .should()
      .notExist()
      .because('use the shared parseOrder() utility')
      .check()
  })
})

// ─── Type Safety ─────────────────────────────────────────────────────

describe('Type Safety', () => {
  it('query options must use typed unions for orderBy', () => {
    types(p)
      .that()
      .haveNameMatching(/Options$/)
      .and()
      .haveProperty('orderBy')
      .should()
      .havePropertyType('orderBy', notType(isString()))
      .because('bare string orderBy passed to .orderBy() is a SQL injection surface')
      .check()
  })
})
