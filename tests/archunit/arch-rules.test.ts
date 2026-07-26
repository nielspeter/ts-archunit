/**
 * Architecture rules for ts-archunit itself.
 *
 * These rules enforce our own ADRs on our own codebase.
 * Uses .rule() metadata for educational violation messages.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import type { Located, Predicate } from '../../src/index.js'
import { project, modules, classes, functions, slices, call } from '../../src/index.js'
import { noAnyProperties, noTypeAssertions } from '../../src/rules/typescript.js'
import {
  noEval,
  noConsoleLog,
  functionNoEval,
  functionNoJsonParse,
  moduleNoEval,
} from '../../src/rules/security.js'
import { noGenericErrors, functionNoGenericErrors } from '../../src/rules/errors.js'
import { noEmptyBodies, noStubComments } from '../../src/rules/hygiene.js'

const p = project('tsconfig.json')

/**
 * This project's own `src/`, derived from the tsconfig's location rather than
 * matched by a glob.
 *
 * Thirteen rules below used to scope with `resideInFolder('**\/ts-archunit/src/**')`,
 * which requires the *checkout directory* to be named `ts-archunit` — not a
 * property of this repository. From a git worktree, a clone into `arch/`, or a
 * renamed folder, that glob selected 0 modules, 0 functions and 0 classes and
 * all thirteen passed while enforcing nothing (bug 0011). Measured: it matches
 * 14 parent directories here and **0** with the checkout renamed.
 *
 * Two obvious replacements are both wrong, and both were measured:
 *
 * - `'**\/src/**'` also matches `tests/fixtures/**\/src/**` — the corpus built
 *   to *violate* these very rules. It reds 13 rules on 89 hits, every one a
 *   fixture.
 * - `` `${dirname(p.tsConfigPath)}/src/**` `` passes here and returns to 0
 *   subjects at any checkout path containing glob metacharacters, because
 *   picomatch reads `My (work)/` as an extglob. It reproduces the bug it closes.
 *
 * So this is a prefix test, not a glob: a path either starts with this
 * project's src directory or it does not, and no character in the checkout
 * path can change that. ADR-008 rule 5 — the derivation is the tsconfig's own
 * resolved location, which is independent of what anyone named the folder.
 */
const SRC_PREFIX = path.dirname(path.resolve('tsconfig.json')).replaceAll('\\', '/') + '/src/'

function inProjectSrc<T extends Located>(): Predicate<T> {
  return {
    description: `reside in this project's src/ ("${SRC_PREFIX}")`,
    test: (element) => element.getSourceFile().getFilePath().startsWith(SRC_PREFIX),
  }
}

// ─── The scope of every rule below, guarded ─────────────────────────
//
// Ask ADR-008's question of this file: what would these 36 rules do if their
// scope selected nothing? Pass — all of them, silently. That is bug 0011, and
// it went unnoticed from the day the rules were written. A green suite is
// therefore not evidence that the suite is enforcing anything, so the scope
// gets its own guard with an INDEPENDENT derivation: ts-morph's module graph
// on one side, a filesystem walk on the other. A bug that empties one cannot
// empty the other.

describe('rule scope (bug 0011)', () => {
  it('inProjectSrc() selects exactly the TypeScript on disk under src/', () => {
    const fromCompiler = modules(p)
      .that()
      .satisfy(inProjectSrc())
      .subjects()
      .map((sourceFile) => sourceFile.getFilePath())
      .sort()

    const fromDisk: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name).replaceAll('\\', '/')
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) fromDisk.push(full)
      }
    }
    walk(SRC_PREFIX)

    // Both non-empty, or the comparison is two empty sets agreeing — which is
    // precisely the false green this test exists to catch.
    expect(fromCompiler.length).toBeGreaterThan(0)
    expect(fromDisk.length).toBeGreaterThan(0)
    expect(fromCompiler).toEqual(fromDisk.sort())
  })

  it('no rule scopes by the name of the checkout directory', () => {
    // The original defect was not "a wrong glob" but "a glob that encodes the
    // folder name", which is a property of the machine, not the repository.
    // Renaming the checkout is enough to silence any rule written that way, so
    // ban the shape rather than the one string that happened to be used.
    const checkoutName = path.basename(path.dirname(path.resolve('tsconfig.json')))
    const source = fs.readFileSync(import.meta.filename, 'utf-8')
    const offending = source
      .split('\n')
      .map((line, index) => ({ text: line.trim(), number: index + 1 }))
      // Comments are excluded deliberately: the JSDoc above quotes the banned
      // glob as the counter-example, and that is the most useful line in the
      // file. A leading `*` or `//` is not a comment parser — it is enough for
      // this file's style, and a false negative here only means the ban misses
      // a glob someone hid inside a trailing comment, which no rule executes.
      .filter(({ text }) => !text.startsWith('*') && !text.startsWith('//'))
      .filter(({ text }) => /'[^']*\*[^']*'/.test(text) && text.includes(checkoutName))

    expect(offending.map((o) => `${String(o.number)}: ${o.text}`)).toEqual([])
  })
})

// ─── ADR-005: No any types, no type assertions ──────────────────────

describe('ADR-005: Type Safety', () => {
  it('source classes must not have any-typed properties', () => {
    classes(p)
      .that()
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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

// ─── Hygiene: function variants (plan 0042) ────────────────────────

describe('Hygiene', () => {
  it('source functions must not have empty bodies', () => {
    functions(p)
      .that()
      .satisfy(inProjectSrc())
      .should()
      .satisfy(noEmptyBodies())
      .rule({
        id: 'hygiene/no-empty-bodies',
        because: 'An empty function compiles but does nothing — dead code or unfinished work',
      })
      .check()
  })

  it('source functions must not have stub comments', () => {
    functions(p)
      .that()
      .satisfy(inProjectSrc())
      .should()
      .satisfy(noStubComments())
      .rule({
        id: 'hygiene/no-stubs',
        because: 'TODO/FIXME/HACK comments indicate unfinished work — resolve before merging',
      })
      .check()
  })

  it('source functions must not use eval', () => {
    functions(p)
      .that()
      .satisfy(inProjectSrc())
      .should()
      .satisfy(functionNoEval())
      .rule({ id: 'security/no-eval-fn' })
      .check()
  })

  it('source functions must not throw generic Error (excluding argument validation)', () => {
    functions(p)
      .that()
      .satisfy(inProjectSrc())
      .should()
      .satisfy(functionNoGenericErrors())
      .excluding(
        // Argument validation in predicate/condition factories — thrown at construction time, not evaluation
        /haveMaxExports/,
        /havePropertyNamed/,
        /notHavePropertyNamed/,
        /haveArgumentWithProperty/,
        /notHaveArgumentWithProperty/,
        'areHtmlElements',
        // Project loader — single point of failure with descriptive message
        'project',
        'workspace',
        // Precondition guard — caller must verify the initializer
        'fromArrowVariableDeclaration',
        // GraphQL schema loader — requires graphql peer dep
        'requireGraphQL',
        'loadSchemaFromGlob',
      )
      .rule({
        id: 'quality/typed-errors-fn',
        because: 'Use ArchRuleError or a specific Error subclass',
      })
      .check()
  })

  it('source modules must not contain eval', () => {
    modules(p)
      .that()
      .satisfy(inProjectSrc())
      .should()
      .satisfy(moduleNoEval())
      .rule({ id: 'security/no-eval-module' })
      .check()
  })

  it('source functions must not use JSON.parse (excluding CLI and baseline)', () => {
    functions(p)
      .that()
      .satisfy(inProjectSrc())
      .should()
      .satisfy(functionNoJsonParse())
      .excluding(
        'getVersion', // CLI: reads package.json version
        'withBaseline', // baseline: parses baseline JSON file
        'readJsonc', // init: parses the user's tsconfig for source-root detection
        'planPackageJson', // init: parses the user's package.json to merge scripts
        'declaresWorkspaces', // identity root: reads package.json to detect a monorepo root
      )
      .rule({
        id: 'security/no-json-parse',
        because: 'ts-archunit analyzes AST, not JSON — JSON.parse should not appear in source',
      })
      .check()
  })

  it('presets must not import from graphql', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/presets/**')
      .should()
      .notImportFrom('**/src/graphql/**')
      .rule({
        id: 'arch/presets-no-graphql',
        because: 'Presets are core — they must not depend on the optional graphql extension',
      })
      .check()
  })

  it('presets must not import from cli', () => {
    modules(p)
      .that()
      .resideInFolder('**/src/presets/**')
      .should()
      .notImportFrom('**/src/cli/**')
      .rule({
        id: 'arch/presets-no-cli',
        because: 'Presets are used programmatically — they must not depend on CLI infrastructure',
      })
      .check()
  })

  it('modules must not have default exports (except index)', () => {
    modules(p)
      .that()
      .satisfy(inProjectSrc())
      .and()
      .haveNameMatching(/^(?!index\.ts$)/)
      .should()
      .notHaveDefaultExport()
      .rule({
        id: 'quality/no-default-exports',
        because: 'Named exports are easier to refactor and tree-shake',
      })
      .check()
  })
})

// ─── No console.log ──────────────────────────────────────────────────

describe('No console.log in Source', () => {
  it('source classes must not call console.log', () => {
    classes(p)
      .that()
      .satisfy(inProjectSrc())
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
      .satisfy(inProjectSrc())
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
    //
    // Identity predicates (resideInFile, resideInFolder, havePathMatching) are
    // legitimately single-glob — you match one location pattern, not a
    // blacklist. That carve-out used to live in a comment here while the scope
    // covered them anyway; now it IS the scope, because those predicates live
    // in identity.ts and this rule names module.ts (bug 0011, plan 0069 R-any).
    //
    // resideInFile, not resideInFolder: resideInFolder matches the DIRECTORY
    // portion of the path, so '**/src/predicates/module**' matched 1 file and
    // 0 directories and this rule selected nothing, everywhere, since it was
    // written. Widening to '**/src/predicates/**' is not the fix either — it
    // would red on identity.ts's own single-glob predicates.
    functions(p)
      .that()
      .resideInFile('**/src/predicates/module.ts')
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
