/**
 * Example: ArchUnit-inspired architecture rules for TypeScript
 *
 * These rules mirror the 7 categories from Java ArchUnit's "What to Check" guide,
 * adapted for TypeScript projects. See: https://www.archunit.org/use-cases
 *
 * Assumes a project structure like:
 *   src/controllers/   — HTTP handlers
 *   src/services/       — Business logic
 *   src/repositories/   — Data access
 *   src/domain/         — Entities, value objects
 *   src/shared/         — Cross-cutting utilities
 *   src/features/       — Feature modules (auth/, billing/, orders/)
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

// ═══════════════════════════════════════════════════════════════════════
// 1. DEPENDENCY RULES
//    ArchUnit: "Package Dependency Checks"
//    Enforce which modules can import from which.
// ═══════════════════════════════════════════════════════════════════════

describe('1. Dependency Rules', () => {
  it('domain must not import from infrastructure', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .rule({
        id: 'deps/domain-isolation',
        because: 'Domain layer must be independent of infrastructure',
        suggestion: 'Move the dependency to a service that bridges domain and infrastructure',
      })
      .check()
  })

  it('controllers must not import from repositories directly', () => {
    modules(p)
      .that()
      .resideInFolder('**/controllers/**')
      .should()
      .notImportFrom('**/repositories/**')
      .rule({
        id: 'deps/no-controller-repo',
        because: 'Controllers should delegate to services, not access data directly',
      })
      .check()
  })

  it('repositories must not import from controllers or services', () => {
    modules(p)
      .that()
      .resideInFolder('**/repositories/**')
      .should()
      .notImportFrom('**/controllers/**', '**/services/**')
      .rule({
        id: 'deps/repo-independence',
        because: 'Repositories are the innermost layer — no upward dependencies',
      })
      .check()
  })

  it('shared packages must not import from app code', () => {
    modules(p)
      .that()
      .resideInFolder('**/shared/**')
      .should()
      .notImportFrom('**/controllers/**', '**/services/**', '**/repositories/**')
      .rule({
        id: 'deps/shared-isolation',
        because: 'Shared code is used by all layers — it must not depend on any',
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 2. CONTAINMENT RULES
//    ArchUnit: "Class and Package Containment Checks"
//    Enforce that classes live in the right folders.
// ═══════════════════════════════════════════════════════════════════════

describe('2. Containment Rules', () => {
  it('controllers must reside in the controllers folder', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Controller')
      .should()
      .resideInFile('**/controllers/**')
      .rule({
        id: 'contain/controllers-in-folder',
        because: 'Controllers scattered across folders break the layered structure',
      })
      .check()
  })

  it('repositories must reside in the repositories folder', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Repository')
      .should()
      .resideInFile('**/repositories/**')
      .rule({ id: 'contain/repos-in-folder' })
      .check()
  })

  it('DTOs must reside in dto folder', () => {
    classes(p)
      .that()
      .haveNameMatching(/Request$|Response$|DTO$/)
      .should()
      .resideInFile('**/dto/**')
      .rule({
        id: 'contain/dtos-in-folder',
        because: 'DTOs scattered across the codebase are hard to find and maintain',
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 3. INHERITANCE RULES
//    ArchUnit: "Inheritance Checks"
//    Enforce naming conventions on subclasses and implementations.
// ═══════════════════════════════════════════════════════════════════════

describe('3. Inheritance Rules', () => {
  it('classes extending BaseRepository must end with Repository', () => {
    classes(p)
      .that()
      .extend('BaseRepository')
      .should()
      .haveNameMatching(/Repository$/)
      .rule({
        id: 'inherit/repo-naming',
        because: 'Consistent naming makes the codebase navigable',
        suggestion: 'Rename the class to end with Repository',
      })
      .check()
  })

  it('classes implementing EventHandler must end with Handler', () => {
    classes(p)
      .that()
      .implement('EventHandler')
      .should()
      .haveNameMatching(/Handler$/)
      .rule({ id: 'inherit/handler-naming' })
      .check()
  })

  it('all repositories must extend BaseRepository', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Repository')
      .and()
      .resideInFolder('**/repositories/**')
      .should()
      .shouldExtend('BaseRepository')
      .rule({
        id: 'inherit/repos-extend-base',
        because: 'BaseRepository provides transaction support and shared query helpers',
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 4. DECORATOR RULES (TypeScript equivalent of ArchUnit "Annotation Checks")
//    Enforce conventions around TypeScript decorators.
// ═══════════════════════════════════════════════════════════════════════

describe('4. Decorator Rules', () => {
  it('classes with @Controller must reside in controllers folder', () => {
    classes(p)
      .that()
      .haveDecorator('Controller')
      .should()
      .resideInFile('**/controllers/**')
      .rule({ id: 'decorator/controller-location' })
      .check()
  })

  it('classes with @Injectable must end with Service or Repository', () => {
    classes(p)
      .that()
      .haveDecorator('Injectable')
      .should()
      .haveNameMatching(/Service$|Repository$|Provider$/)
      .rule({
        id: 'decorator/injectable-naming',
        because: 'Injectable classes should follow naming conventions for DI discovery',
      })
      .check()
  })

  it('abstract classes must not have @Controller decorator', () => {
    classes(p)
      .that()
      .areAbstract()
      .and()
      .haveDecorator('Controller')
      .should()
      .notExist()
      .rule({
        id: 'decorator/no-abstract-controller',
        because: 'Abstract controllers cannot handle requests — use concrete classes',
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 5. LAYER RULES
//    ArchUnit: "Layer Checks"
//    Enforce layered architecture with dependency direction.
// ═══════════════════════════════════════════════════════════════════════

describe('5. Layer Rules', () => {
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
        docs: 'https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html',
      })
      .check()
  })

  it('domain must not depend on any other layer', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .rule({
        id: 'layer/domain-pure',
        because: 'Domain is the innermost layer — it depends on nothing',
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 6. CYCLE RULES
//    ArchUnit: "Cycle Checks"
//    Detect and prevent circular dependencies.
// ═══════════════════════════════════════════════════════════════════════

describe('6. Cycle Rules', () => {
  it('no cycles between feature modules', () => {
    slices(p)
      .matching('src/features/*/')
      .should()
      .beFreeOfCycles()
      .rule({
        id: 'cycle/features',
        because: 'Circular feature dependencies prevent independent deployment and testing',
        suggestion: 'Extract shared code to src/shared/ or introduce an event bus',
      })
      .check()
  })

  it('no cycles between layers', () => {
    slices(p)
      .assignedFrom({
        controllers: 'src/controllers/**',
        services: 'src/services/**',
        repositories: 'src/repositories/**',
      })
      .should()
      .beFreeOfCycles()
      .rule({ id: 'cycle/layers' })
      .check()
  })

  it('feature modules must not depend on each other', () => {
    slices(p)
      .matching('src/features/*/')
      .should()
      .notDependOn('legacy', 'deprecated')
      .rule({
        id: 'cycle/no-legacy-deps',
        because: 'New features must not introduce dependencies on legacy code',
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 7. BODY ANALYSIS RULES (ts-archunit exclusive — not in Java ArchUnit)
//    Inspect what happens INSIDE functions and methods.
// ═══════════════════════════════════════════════════════════════════════

describe('7. Body Analysis (beyond ArchUnit)', () => {
  it('repositories must not call parseInt directly', () => {
    classes(p)
      .that()
      .extend('BaseRepository')
      .should()
      .notContain(call('parseInt'))
      .rule({
        id: 'body/no-parseint',
        because: 'BaseRepository provides extractCount() for safe type coercion',
        suggestion: 'Replace parseInt(x, 10) with this.extractCount(result)',
      })
      .check()
  })

  it('services must throw typed errors, not generic Error', () => {
    classes(p)
      .that()
      .haveNameEndingWith('Service')
      .should()
      .notContain(newExpr('Error'))
      .rule({
        id: 'body/typed-errors',
        because: 'Generic Error prevents consistent API error responses',
        suggestion: 'Use NotFoundError, ValidationError, or ConflictError',
      })
      .check()
  })

  it('no eval() anywhere', () => {
    classes(p)
      .should()
      .notContain(call('eval'))
      .rule({ id: 'body/no-eval', because: 'eval is a security risk' })
      .check()
  })

  it('no console.log in production code', () => {
    functions(p)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notContain(call('console.log'))
      .rule({
        id: 'body/no-console-log',
        suggestion: 'Use a logger abstraction or remove the debug statement',
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 8. TYPE SAFETY RULES (ts-archunit exclusive)
//    Enforce type-level constraints using the TypeScript type checker.
// ═══════════════════════════════════════════════════════════════════════

describe('8. Type Safety (beyond ArchUnit)', () => {
  it('query option types must use typed unions, not bare string', () => {
    types(p)
      .that()
      .haveNameMatching(/Options$/)
      .and()
      .haveProperty('orderBy')
      .should()
      .havePropertyType('orderBy', notType(isString()))
      .rule({
        id: 'type/no-bare-string-orderby',
        because: 'Bare string orderBy passed to SQL query builders is an injection risk',
        suggestion: "Use a union: orderBy?: 'created_at' | 'updated_at' | 'name'",
      })
      .check()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// 9. NAMING CONVENTIONS
//    Ensure consistent naming across the codebase.
// ═══════════════════════════════════════════════════════════════════════

describe('9. Naming Conventions', () => {
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

  it('services must be exported', () => {
    classes(p).that().haveNameEndingWith('Service').should().beExported().check()
  })

  it('no functions matching parseXxxOrder in routes (copy-paste smell)', () => {
    functions(p)
      .that()
      .haveNameMatching(/^parse\w+Order$/)
      .and()
      .resideInFolder('**/routes/**')
      .should()
      .notExist()
      .rule({
        id: 'naming/no-copy-paste-parsers',
        because: 'Copy-pasted parsers diverge — use shared parseOrder() utility',
      })
      .check()
  })
})
