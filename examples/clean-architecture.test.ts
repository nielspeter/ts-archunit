/**
 * Example: Clean Architecture / Hexagonal Architecture rules
 *
 * Assumes a project structure like:
 *   src/domain/           — entities, aggregates, value objects, domain services
 *   src/application/      — use cases, ports (interfaces)
 *   src/infrastructure/   — adapters, database, HTTP clients, messaging
 *   src/presentation/     — controllers, views, DTOs
 *   src/shared/           — cross-cutting utilities
 */
import { describe, it } from 'vitest'
import { project, modules, classes, slices } from 'ts-archunit'

const p = project('tsconfig.json')

// ─── The Dependency Rule ─────────────────────────────────────────────
// Source code dependencies must point inward.
// Nothing in an inner circle can know about something in an outer circle.

describe('The Dependency Rule', () => {
  const layers = {
    presentation: 'src/presentation/**',
    infrastructure: 'src/infrastructure/**',
    application: 'src/application/**',
    domain: 'src/domain/**',
  }

  it('dependencies point inward', () => {
    slices(p)
      .assignedFrom(layers)
      .should()
      .respectLayerOrder('presentation', 'infrastructure', 'application', 'domain')
      .because('Clean Architecture: dependencies point inward')
      .check()
  })

  it('domain has no outward dependencies', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .because('domain must not depend on application, infrastructure, or presentation')
      .check()
  })

  it('application depends only on domain', () => {
    modules(p)
      .that()
      .resideInFolder('**/application/**')
      .should()
      .onlyImportFrom('**/application/**', '**/domain/**', '**/shared/**')
      .because('use cases depend on domain, not on infrastructure')
      .check()
  })
})

// ─── Domain Layer Rules ──────────────────────────────────────────────

describe('Domain Layer', () => {
  it('no framework imports in domain', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .notImportFrom('**/node_modules/express/**')
      .check()
  })

  it('entities must be exported', () => {
    classes(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .beExported()
      .because('domain entities are used by application layer')
      .check()
  })
})

// ─── No Cycles ───────────────────────────────────────────────────────

describe('No Cycles', () => {
  it('no circular dependencies between layers', () => {
    slices(p)
      .assignedFrom({
        presentation: 'src/presentation/**',
        infrastructure: 'src/infrastructure/**',
        application: 'src/application/**',
        domain: 'src/domain/**',
      })
      .should()
      .beFreeOfCycles()
      .check()
  })

  it('no circular dependencies between domain aggregates', () => {
    slices(p)
      .matching('src/domain/*/')
      .should()
      .beFreeOfCycles()
      .because('aggregates must be independently consistent')
      .check()
  })
})
