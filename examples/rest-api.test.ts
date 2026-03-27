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
} from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

// ─── Layer Dependencies ──────────────────────────────────────────────

describe('Layer Dependencies', () => {
  it('domain must not import from infrastructure', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .rule({
        id: 'layer/domain-isolation',
        because:
          'Domain layer must be independent of infrastructure for testability and portability',
        suggestion: 'Move the import to a service that bridges domain and infrastructure',
        docs: 'https://example.com/adr/clean-architecture',
      })
      .check()
  })

  it('repositories must not import from controllers', () => {
    modules(p)
      .that()
      .resideInFolder('**/repositories/**')
      .should()
      .notImportFrom('**/controllers/**')
      .rule({
        id: 'layer/repo-no-controllers',
        because: 'Repositories are inner layer — they must not depend on the HTTP layer',
      })
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
      .rule({
        id: 'layer/direction',
        because: 'Dependencies flow inward: controllers → services → repositories → domain',
        docs: 'https://example.com/adr/layer-architecture',
      })
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
      .rule({
        id: 'arch/no-feature-cycles',
        because: 'Circular dependencies prevent independent deployment and testing',
        suggestion: 'Extract shared code into src/shared/ or introduce an event bus',
      })
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
      .rule({
        id: 'naming/controller-suffix',
        because: 'Consistent naming makes the codebase navigable',
        suggestion: 'Rename the class to end with Controller (e.g., OrderController)',
      })
      .check()
  })

  it('services must end with Service', () => {
    classes(p)
      .that()
      .resideInFolder('**/services/**')
      .should()
      .haveNameMatching(/Service$/)
      .rule({ id: 'naming/service-suffix' })
      .check()
  })

  it('repositories must end with Repository', () => {
    classes(p)
      .that()
      .resideInFolder('**/repositories/**')
      .should()
      .haveNameMatching(/Repository$/)
      .rule({ id: 'naming/repository-suffix' })
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
      .rule({
        id: 'repo/extend-base',
        because: 'BaseRepository provides transaction support and shared query helpers',
        suggestion: 'Add `extends BaseRepository` to the class declaration',
      })
      .check()
  })

  it('services must be exported', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Service')
      .should()
      .beExported()
      .rule({ id: 'quality/services-exported' })
      .check()
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
      .rule({
        id: 'repo/no-parseint',
        because: 'BaseRepository provides extractCount() which handles type coercion safely',
        suggestion: 'Replace parseInt(x, 10) with this.extractCount(result)',
      })
      .check()
  })

  it('repositories must use typed errors, not generic Error', () => {
    classes(p)
      .that()
      .extend('BaseRepository')
      .should()
      .notContain(newExpr('Error'))
      .rule({
        id: 'repo/typed-errors',
        because: 'Generic Error loses context and prevents consistent API error responses',
        suggestion: 'Use NotFoundError, ValidationError, or ConflictError instead',
      })
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
      .rule({
        id: 'route/no-copy-paste-parsers',
        because: 'Copy-pasted parsers diverge over time — use the shared parseOrder() utility',
        suggestion: "Import parseOrder from '@company/server-common' and pass a column map",
      })
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
      .rule({
        id: 'type/no-bare-string-orderby',
        because: 'Bare string orderBy passed to .orderBy() is a SQL injection surface',
        suggestion: "Use a union type: orderBy?: 'created_at' | 'updated_at' | 'name'",
      })
      .check()
  })
})
