/**
 * Architecture rules for ts-archunit itself.
 *
 * These rules enforce our own ADRs on our own codebase.
 * Uses .rule() metadata for educational violation messages.
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
      .rule({
        id: 'adr005/no-any',
        because: 'any bypasses the type checker, hiding bugs that strict mode catches',
        suggestion: 'Use a specific type, unknown with narrowing, or a generic',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/005-no-any-no-type-assertions.md',
      })
      .check()
  })

  it('source classes must not use type assertions in methods', () => {
    classes(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .satisfy(noTypeAssertions())
      .rule({
        id: 'adr005/no-as-cast',
        because: 'as casts bypass the type checker — refactoring silently breaks',
        suggestion:
          'Use ts-morph Node type guards (Node.isClassDeclaration etc.) or explicit type annotations',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/005-no-any-no-type-assertions.md',
      })
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
      .rule({
        id: 'adr004/no-require',
        because: 'ts-archunit is ESM-only — CommonJS require() breaks module resolution',
        suggestion: "Use import ... from '...' (static) or import('...') (dynamic)",
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/004-esm-only-package.md',
      })
      .check()
  })

  it('no require() in source functions', () => {
    functions(p)
      .that()
      .resideInFolder('**/src/**')
      .should()
      .notContain(call('require'))
      .rule({
        id: 'adr004/no-require-fn',
        because: 'ESM only',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/004-esm-only-package.md',
      })
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
      .notImportFromCondition('**/node_modules/typescript/**')
      .rule({
        id: 'adr002/no-raw-ts',
        because:
          'ts-morph wraps the TypeScript compiler API — using it directly creates version coupling and verbose code',
        suggestion: 'Use ts-morph APIs: Project, Node, SyntaxKind, type checker methods',
        docs: 'https://github.com/NielsPeter/ts-archunit/blob/main/adr/002-ts-morph-ast-engine.md',
      })
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
      .rule({
        id: 'security/no-eval',
        because: 'eval executes arbitrary code — security risk and prevents static analysis',
      })
      .check()
  })

  it('no generic Error', () => {
    classes(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .satisfy(noGenericErrors())
      .rule({
        id: 'quality/typed-errors',
        because: 'Generic Error loses context. Typed errors enable consistent handling.',
        suggestion: 'Use ArchRuleError or a specific Error subclass',
      })
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
      .rule({
        id: 'quality/builders-exported',
        because: 'Builders are the public API — unexported builders are unreachable',
      })
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
      .rule({
        id: 'quality/entry-points-exported',
        because: 'Entry point functions are the primary user API',
      })
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
      .notImportFromCondition('**/src/builders/**')
      .excluding('within.ts') // within() intentionally creates scoped builders
      .rule({
        id: 'arch/helpers-no-builders',
        because: 'Helpers are lower-level primitives — builders depend on helpers, not the reverse',
        suggestion: 'Move the shared logic to src/helpers/ or src/core/',
      })
      .check()
  })

  it('core must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/builders/**')
      .rule({
        id: 'arch/core-no-builders',
        because: 'Core is the foundation — it must not depend on entry points',
        suggestion: 'If core needs builder functionality, extract it to core first',
      })
      .check()
  })

  it('core must not import from predicates', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/predicates/**')
      .rule({
        id: 'arch/core-no-predicates',
        because: 'Core must not depend on predicate implementations',
      })
      .check()
  })

  it('core must not import from conditions', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/conditions/**')
      .rule({
        id: 'arch/core-no-conditions',
        because: 'Core must not depend on condition implementations',
      })
      .check()
  })

  it('core must not import from smells', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/smells/**')
      .rule({
        id: 'arch/core-no-smells',
        because: 'Core must not depend on smell detectors',
      })
      .check()
  })

  it('core must not import from rules', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/rules/**')
      .rule({
        id: 'arch/core-no-rules',
        because: 'Core must not depend on standard rule implementations',
      })
      .check()
  })

  it('core must not import from graphql', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/graphql/**')
      .rule({
        id: 'arch/core-no-graphql',
        because: 'Core must not depend on the graphql extension',
      })
      .check()
  })

  it('core must not import from cli', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/cli/**')
      .rule({
        id: 'arch/core-no-cli',
        because: 'Core must not depend on the CLI layer',
      })
      .check()
  })

  it('core must not import from helpers', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/core/**')
      .should()
      .notImportFromCondition('**/src/helpers/**')
      .rule({
        id: 'arch/core-no-helpers',
        because: 'Core is the foundation — helpers depend on core, not the reverse',
      })
      .check()
  })

  it('standard rules must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/rules/**')
      .should()
      .notImportFromCondition('**/src/builders/**')
      .rule({
        id: 'arch/rules-no-builders',
        because: 'Standard rules are conditions, not builders',
      })
      .check()
  })

  it('predicates must not import from conditions', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/predicates/**')
      .should()
      .notImportFromCondition('**/src/conditions/**')
      .rule({
        id: 'arch/predicates-independent',
        because: 'Predicates filter, conditions assert — they are independent concerns',
      })
      .check()
  })

  it('models must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/models/**')
      .should()
      .notImportFromCondition('**/src/builders/**')
      .rule({
        id: 'arch/models-no-builders',
        because: 'Models are data representations — they must not depend on the rule engine',
      })
      .check()
  })

  it('conditions must not import from builders', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/conditions/**')
      .should()
      .notImportFromCondition('**/src/builders/**')
      .rule({
        id: 'arch/conditions-no-builders',
        because: 'Conditions are reusable — they must not depend on specific entry points',
      })
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
      .rule({
        id: 'arch/no-cycles',
        because: 'Circular dependencies between modules prevent independent testing and reasoning',
        suggestion: 'Extract shared code to a lower-level module (core or helpers)',
      })
      .warn() // type-only imports create false-positive cycles; switch to .check() when beFreeOfCycles ignores import type
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
      .rule({
        id: 'quality/no-console-log',
        because: 'Use console.warn for user-facing warnings or throw for errors',
        suggestion: 'Replace console.log() with console.warn() or remove it',
      })
      .check()
  })

  it('source functions must not call console.log', () => {
    functions(p)
      .that()
      .resideInFolder('**/ts-archunit/src/**')
      .should()
      .notContain(call('console.log'))
      .rule({
        id: 'quality/no-console-log-fn',
        because: 'Use console.warn for user-facing warnings or throw for errors',
      })
      .check()
  })
})

// ─── API Consistency ─────────────────────────

describe('Import Hygiene', () => {
  it('test files should not use aliased imports', () => {
    modules(p)
      .that()
      .resideInFile('**/tests/**/*.test.ts')
      .should()
      .notHaveAliasedImports()
      .rule({
        id: 'quality/no-aliased-imports',
        because: 'aliases hide API naming problems — use the real export name',
        suggestion:
          'Import the symbol by its original name, or fix the export if the name conflicts',
      })
      .check()
  })
})

describe('API Consistency', () => {
  it('module predicate functions must not accept a single "glob" parameter', () => {
    // Regression guard for the .notImportFrom() variadic bug.
    // Module predicates like importFrom/notImportFrom should accept ...globs
    // so users can write .notImportFrom('fastify', 'knex', 'bullmq').
    // Note: identity predicates (resideInFile, resideInFolder) are legitimately
    // single-glob — you match one location pattern, not a blacklist.
    functions(p)
      .that()
      .resideInFolder('**/src/predicates/module**')
      .and()
      .areExported()
      .and()
      .haveParameterNamed('glob')
      .and()
      .haveParameterCount(1)
      .should()
      .notExist()
      .rule({
        id: 'api/no-single-glob-predicates',
        because: 'Single-glob predicates silently ignore extra arguments — use ...globs variadic',
        suggestion: 'Change (glob: string) to (...globs: string[]) to match condition variants',
      })
      .check()
  })
})
