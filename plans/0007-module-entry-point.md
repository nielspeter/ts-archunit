# Plan 0007: Module Entry Point & Dependency Conditions

## Status

- **State:** Draft
- **Priority:** P0 — First concrete entry point; proves the full pipeline end-to-end
- **Effort:** 2-3 days
- **Created:** 2026-03-26
- **Depends on:** 0002 (Project Loader), 0003 (Predicate Engine), 0004 (Condition Engine), 0005 (Rule Builder)

## Purpose

Implement the `modules(p)` entry point — the first concrete `RuleBuilder` subclass that operates on `SourceFile` elements (each `.ts` file is a "module"). This covers spec sections 5.6 and 6.2.

This plan delivers three things:

1. **`ModuleRuleBuilder`** — extends `RuleBuilder<SourceFile>`, wires identity predicates as fluent methods, adds module-specific predicates
2. **Module predicates** — `importFrom(glob)`, `notImportFrom(glob)`, `exportSymbolNamed(name)`, `havePathMatching(glob)`
3. **Dependency conditions** — `onlyImportFrom(...globs)`, `notImportFrom(...globs)`, `onlyHaveTypeImportsFrom(...globs)`

After this plan, users can write rules like:

```typescript
modules(project)
  .that().resideInFolder('**/domain/**')
  .should().onlyImportFrom('**/domain/**', '**/shared/**')
  .because('domain modules must not depend on infrastructure')
  .check()
```

### Design Decisions

**SourceFile as the element type.** `RuleBuilder<T>` is generic, and `ModuleRuleBuilder` binds `T = SourceFile`. SourceFile is not a `Node` subtype with `getName()` in the same way as ClassDeclaration, so the violation helpers (`getElementName`, `getElementFile`, `getElementLine`) need a module-specific adapter. We use `sourceFile.getBaseName()` for the element name and `sourceFile.getFilePath()` for the file path.

**Condition<SourceFile> not Condition<Node>.** The existing `elementCondition` helper in `src/conditions/helpers.ts` is constrained to `T extends Node`. SourceFile does extend Node in ts-morph, so this works. However, dependency conditions need custom violation reporting (listing the offending import path), so they implement the `Condition<SourceFile>` interface directly rather than using the `elementCondition` helper.

**Import specifier resolution.** `sourceFile.getImportDeclarations()` returns all import statements. Each import's module specifier (e.g., `'./base-service.js'`, `'@shared/utils'`) is resolved to an absolute path using `importDecl.getModuleSpecifierSourceFile()?.getFilePath()`. If resolution fails (external package), the raw specifier is matched against globs. This handles both relative imports and path aliases.

**Glob matching for imports.** All import path matching uses picomatch against the resolved absolute path. This is consistent with how `resideInFile` and `resideInFolder` already work in the identity predicates.

## Phase 1: Module Predicates

### `src/predicates/module.ts`

```typescript
import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'

/**
 * Resolve the import paths for a source file.
 * Returns absolute paths for resolvable imports, raw specifiers for external packages.
 */
function getImportPaths(sourceFile: SourceFile): string[] {
  return sourceFile.getImportDeclarations().map((decl) => {
    const resolved = decl.getModuleSpecifierSourceFile()
    return resolved ? resolved.getFilePath() : decl.getModuleSpecifierValue()
  })
}

/**
 * Matches modules that import from a path matching the given glob.
 *
 * The glob is matched against resolved absolute import paths.
 * For external (non-resolvable) imports, it matches against the raw specifier.
 *
 * @example
 * modules(p).that().importFrom('** /infrastructure/**')
 */
export function importFrom(glob: string): Predicate<SourceFile> {
  const isMatch = picomatch(glob)
  return {
    description: `import from "${glob}"`,
    test: (sourceFile) => getImportPaths(sourceFile).some((p) => isMatch(p)),
  }
}

/**
 * Matches modules that do NOT import from a path matching the given glob.
 *
 * @example
 * modules(p).that().notImportFrom('** /legacy/**')
 */
export function notImportFrom(glob: string): Predicate<SourceFile> {
  const isMatch = picomatch(glob)
  return {
    description: `not import from "${glob}"`,
    test: (sourceFile) => !getImportPaths(sourceFile).some((p) => isMatch(p)),
  }
}

/**
 * Matches modules that export a symbol with the given name.
 *
 * Checks the module's exported declarations for a matching name.
 *
 * @example
 * modules(p).that().exportSymbolNamed('default')
 */
export function exportSymbolNamed(name: string): Predicate<SourceFile> {
  return {
    description: `export symbol named "${name}"`,
    test: (sourceFile) => sourceFile.getExportedDeclarations().has(name),
  }
}

/**
 * Matches modules whose file path matches the given glob.
 *
 * Similar to resideInFile but semantically clearer for modules —
 * "modules that have path matching" vs "elements that reside in file".
 *
 * @example
 * modules(p).that().havePathMatching('** /services/*.ts')
 */
export function havePathMatching(glob: string): Predicate<SourceFile> {
  const isMatch = picomatch(glob)
  return {
    description: `have path matching "${glob}"`,
    test: (sourceFile) => isMatch(sourceFile.getFilePath()),
  }
}
```

The `getImportPaths` helper is extracted as a shared utility since it is also used by the dependency conditions in Phase 2.

## Phase 2: Dependency Conditions

### `src/conditions/dependency.ts`

```typescript
import picomatch from 'picomatch'
import type { SourceFile, ImportDeclaration } from 'ts-morph'
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'

/**
 * Resolve an import declaration to an absolute path or raw specifier.
 */
function resolveImportPath(decl: ImportDeclaration): string {
  const resolved = decl.getModuleSpecifierSourceFile()
  return resolved ? resolved.getFilePath() : decl.getModuleSpecifierValue()
}

/**
 * Create a violation for a source file with a specific offending import.
 */
function importViolation(
  sourceFile: SourceFile,
  importPath: string,
  message: string,
  context: ConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: sourceFile.getBaseName(),
    file: sourceFile.getFilePath(),
    line: 1, // File-level violation
    message,
    because: context.because,
  }
}

/**
 * Every import in the module must resolve to a path matching at least one of the globs.
 * Imports that don't match any glob produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /domain/**')
 *   .should().onlyImportFrom('** /domain/**', '** /shared/**')
 *   .check()
 */
export function onlyImportFrom(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  return {
    description: `only import from ${globs.map((g) => `"${g}"`).join(', ')}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          const importPath = resolveImportPath(decl)
          if (!matchers.some((m) => m(importPath))) {
            violations.push(
              importViolation(
                sf,
                importPath,
                `${sf.getBaseName()} imports "${importPath}" which does not match any of [${globs.join(', ')}]`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * No import in the module may resolve to a path matching any of the globs.
 * Imports that match a glob produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /features/**')
 *   .should().notImportFrom('** /legacy/**')
 *   .check()
 */
export function notImportFrom(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  return {
    description: `not import from ${globs.map((g) => `"${g}"`).join(', ')}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          const importPath = resolveImportPath(decl)
          if (matchers.some((m) => m(importPath))) {
            violations.push(
              importViolation(
                sf,
                importPath,
                `${sf.getBaseName()} imports "${importPath}" which matches forbidden [${globs.join(', ')}]`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}

/**
 * Imports from paths matching the given globs must use `import type`, not `import`.
 * Non-matching imports are ignored. Matching imports that are not type-only produce violations.
 *
 * @example
 * modules(p)
 *   .that().resideInFolder('** /api/**')
 *   .should().onlyHaveTypeImportsFrom('** /domain/entities/**')
 *   .check()
 */
export function onlyHaveTypeImportsFrom(...globs: string[]): Condition<SourceFile> {
  const matchers = globs.map((g) => picomatch(g))
  return {
    description: `only have type imports from ${globs.map((g) => `"${g}"`).join(', ')}`,
    evaluate(sourceFiles: SourceFile[], context: ConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []
      for (const sf of sourceFiles) {
        for (const decl of sf.getImportDeclarations()) {
          const importPath = resolveImportPath(decl)
          if (matchers.some((m) => m(importPath)) && !decl.isTypeOnly()) {
            violations.push(
              importViolation(
                sf,
                importPath,
                `${sf.getBaseName()} has a value import from "${importPath}" which should be a type-only import`,
                context,
              ),
            )
          }
        }
      }
      return violations
    },
  }
}
```

### Key behavior notes

- **`onlyImportFrom`** — allowlist. Every import must match at least one glob. Unmatched imports are violations. A module with zero imports passes (vacuously true).
- **`notImportFrom`** — denylist. Any import matching a glob is a violation.
- **`onlyHaveTypeImportsFrom`** — hybrid. Only imports matching the globs are checked; of those, any that are NOT `import type` are violations. Imports to paths not matching the globs are ignored entirely.
- All three produce one violation per offending import (not per file), so the user sees exactly which imports are problematic.

## Phase 3: ModuleRuleBuilder

### `src/builders/module-rule-builder.ts`

```typescript
import type { SourceFile } from 'ts-morph'
import { RuleBuilder } from '../core/rule-builder.js'
import type { ArchProject } from '../core/project.js'
import {
  resideInFile as resideInFilePredicate,
  resideInFolder as resideInFolderPredicate,
  haveNameMatching as haveNameMatchingPredicate,
} from '../predicates/identity.js'
import {
  importFrom as importFromPredicate,
  notImportFrom as notImportFromPredicate,
  exportSymbolNamed as exportSymbolNamedPredicate,
  havePathMatching as havePathMatchingPredicate,
} from '../predicates/module.js'
import {
  onlyImportFrom as onlyImportFromCondition,
  notImportFrom as notImportFromCondition,
  onlyHaveTypeImportsFrom as onlyHaveTypeImportsFromCondition,
} from '../conditions/dependency.js'
import {
  notExist,
} from '../conditions/structural.js'

/**
 * Rule builder for module-level (SourceFile) architecture rules.
 *
 * Each .ts file in the project is treated as a module. Predicates filter
 * which modules to check, conditions assert constraints on their imports.
 *
 * @example
 * modules(project)
 *   .that().resideInFolder('** /domain/**')
 *   .should().onlyImportFrom('** /domain/**', '** /shared/**')
 *   .because('domain must not depend on infrastructure')
 *   .check()
 */
export class ModuleRuleBuilder extends RuleBuilder<SourceFile> {
  protected getElements(): SourceFile[] {
    return this.project.getSourceFiles()
  }

  // --- Identity predicates (from predicates/identity.ts) ---

  /**
   * Filter modules whose file name matches the given regex.
   * The regex is tested against the base file name (e.g., "user-service.ts").
   */
  haveNameMatching(pattern: RegExp | string): this {
    // SourceFile has getName() which returns the base name — satisfies Named
    return this.addPredicate(haveNameMatchingPredicate<SourceFile>(pattern))
  }

  /**
   * Filter modules that reside in a file matching the given glob.
   * Matched against the absolute file path.
   */
  resideInFile(glob: string): this {
    return this.addPredicate(resideInFilePredicate<SourceFile>(glob))
  }

  /**
   * Filter modules that reside in a folder matching the given glob.
   * Matched against the directory portion of the absolute file path.
   */
  resideInFolder(glob: string): this {
    return this.addPredicate(resideInFolderPredicate<SourceFile>(glob))
  }

  // --- Module-specific predicates (from predicates/module.ts) ---

  /**
   * Filter modules that import from a path matching the given glob.
   */
  importFrom(glob: string): this {
    return this.addPredicate(importFromPredicate(glob))
  }

  /**
   * Filter modules that do NOT import from a path matching the given glob.
   */
  notImportFrom(glob: string): this {
    return this.addPredicate(notImportFromPredicate(glob))
  }

  /**
   * Filter modules that export a symbol with the given name.
   */
  exportSymbolNamed(name: string): this {
    return this.addPredicate(exportSymbolNamedPredicate(name))
  }

  /**
   * Filter modules whose file path matches the given glob.
   */
  havePathMatching(glob: string): this {
    return this.addPredicate(havePathMatchingPredicate(glob))
  }

  // --- Dependency conditions (from conditions/dependency.ts) ---

  /**
   * Every import must resolve to a path matching at least one of the globs.
   */
  onlyImportFrom(...globs: string[]): this {
    return this.addCondition(onlyImportFromCondition(...globs))
  }

  /**
   * No import may resolve to a path matching any of the globs.
   * Note: This is the condition variant (used after .should()).
   * The predicate variant (used after .that()) is notImportFrom().
   */
  notImportFromCondition(...globs: string[]): this {
    return this.addCondition(notImportFromCondition(...globs))
  }

  /**
   * Imports from matching paths must use `import type`.
   */
  onlyHaveTypeImportsFrom(...globs: string[]): this {
    return this.addCondition(onlyHaveTypeImportsFromCondition(...globs))
  }

  /**
   * The filtered module set must be empty.
   */
  notExist(): this {
    return this.addCondition(notExist<SourceFile>())
  }
}

/**
 * Entry point: create a module-level rule builder.
 *
 * @param p - The loaded ArchProject
 * @returns A ModuleRuleBuilder operating on all source files in the project
 *
 * @example
 * modules(project)
 *   .that().resideInFolder('** /services/**')
 *   .should().onlyImportFrom('** /services/**', '** /shared/**')
 *   .check()
 */
export function modules(p: ArchProject): ModuleRuleBuilder {
  return new ModuleRuleBuilder(p)
}
```

### Design note: predicate vs. condition name collision

Both predicates and conditions have a `notImportFrom` concept. The predicate version filters which modules to check (`.that().notImportFrom(glob)`), while the condition version asserts that no imports match (`.should().notImportFromCondition(glob)`). The condition method is named `notImportFromCondition` on the builder to avoid the collision. Users can also use the standalone condition function directly:

```typescript
import { notImportFrom } from 'ts-archunit/conditions/dependency'
modules(p).should().addCondition(notImportFrom('**/legacy/**')).check()
```

## Phase 4: Test Fixtures

### `tests/fixtures/modules/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

### `tests/fixtures/modules/src/domain/order.ts`

```typescript
import type { Entity } from './entity.js'
import { validate } from '../shared/validation.js'

export interface Order extends Entity {
  items: string[]
  total: number
}

export function createOrder(items: string[]): Order {
  validate(items)
  return { id: '1', items, total: items.length * 10 }
}
```

### `tests/fixtures/modules/src/domain/entity.ts`

```typescript
export interface Entity {
  id: string
}
```

### `tests/fixtures/modules/src/shared/validation.ts`

```typescript
export function validate(items: unknown[]): void {
  if (items.length === 0) {
    throw new Error('Items cannot be empty')
  }
}
```

### `tests/fixtures/modules/src/shared/logger.ts`

```typescript
export function log(message: string): void {
  console.log(message)
}
```

### `tests/fixtures/modules/src/infra/database.ts`

```typescript
import { log } from '../shared/logger.js'

export function connect(): void {
  log('Connecting to database')
}
```

### `tests/fixtures/modules/src/infra/api-client.ts`

```typescript
import { Order } from '../domain/order.js'
import { log } from '../shared/logger.js'

export function fetchOrders(): Order[] {
  log('Fetching orders')
  return []
}
```

### `tests/fixtures/modules/src/bad/leaky-domain.ts`

A domain module that incorrectly imports from infrastructure (for testing violations):

```typescript
import { connect } from '../infra/database.js'
import type { Entity } from '../domain/entity.js'

export function initDomain(): Entity {
  connect()
  return { id: 'leak' }
}
```

### `tests/fixtures/modules/src/bad/non-type-import.ts`

A module that should use `import type` but uses a value import (for testing `onlyHaveTypeImportsFrom`):

```typescript
import { Entity } from '../domain/entity.js'
import { log } from '../shared/logger.js'

export function printEntity(e: Entity): void {
  log(e.id)
}
```

## Phase 5: Tests

### `tests/predicates/module.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  importFrom,
  notImportFrom,
  exportSymbolNamed,
  havePathMatching,
} from '../../src/predicates/module.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getSourceFile(relativePath: string) {
  const fullPath = path.join(fixturesDir, relativePath)
  const sf = tsMorphProject.getSourceFile(fullPath)
  if (!sf) throw new Error(`Fixture not found: ${fullPath}`)
  return sf
}

describe('module predicates', () => {
  describe('importFrom', () => {
    it('matches a module that imports from a matching glob', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = importFrom('**/shared/**')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module that has no matching imports', () => {
      const sf = getSourceFile('src/domain/entity.ts')
      const pred = importFrom('**/shared/**')
      expect(pred.test(sf)).toBe(false)
    })

    it('matches against resolved absolute paths', () => {
      const sf = getSourceFile('src/infra/api-client.ts')
      const pred = importFrom('**/domain/**')
      expect(pred.test(sf)).toBe(true)
    })
  })

  describe('notImportFrom', () => {
    it('matches a module that does not import from the glob', () => {
      const sf = getSourceFile('src/domain/entity.ts')
      const pred = notImportFrom('**/infra/**')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module that imports from the glob', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const pred = notImportFrom('**/infra/**')
      expect(pred.test(sf)).toBe(false)
    })
  })

  describe('exportSymbolNamed', () => {
    it('matches a module that exports the named symbol', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = exportSymbolNamed('Order')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module that does not export the symbol', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = exportSymbolNamed('NonExistent')
      expect(pred.test(sf)).toBe(false)
    })
  })

  describe('havePathMatching', () => {
    it('matches a module whose path matches the glob', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const pred = havePathMatching('**/domain/**')
      expect(pred.test(sf)).toBe(true)
    })

    it('does not match a module whose path does not match', () => {
      const sf = getSourceFile('src/shared/logger.ts')
      const pred = havePathMatching('**/domain/**')
      expect(pred.test(sf)).toBe(false)
    })
  })
})
```

### `tests/conditions/dependency.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import {
  onlyImportFrom,
  notImportFrom,
  onlyHaveTypeImportsFrom,
} from '../../src/conditions/dependency.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getSourceFile(relativePath: string) {
  const fullPath = path.join(fixturesDir, relativePath)
  const sf = tsMorphProject.getSourceFile(fullPath)
  if (!sf) throw new Error(`Fixture not found: ${fullPath}`)
  return sf
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('dependency conditions', () => {
  describe('onlyImportFrom', () => {
    it('passes when all imports match the allowed globs', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const condition = onlyImportFrom('**/domain/**', '**/shared/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violations for imports that do not match any allowed glob', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const condition = onlyImportFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('infra'))).toBe(true)
    })

    it('passes for a module with no imports (vacuously true)', () => {
      const sf = getSourceFile('src/domain/entity.ts')
      const condition = onlyImportFrom('**/nonexistent/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('checks multiple modules and reports violations per import', () => {
      const sf1 = getSourceFile('src/domain/order.ts')
      const sf2 = getSourceFile('src/bad/leaky-domain.ts')
      const condition = onlyImportFrom('**/domain/**')
      const violations = condition.evaluate([sf1, sf2], ctx)
      // order.ts imports from shared — violation
      // leaky-domain.ts imports from infra — violation
      expect(violations.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('notImportFrom', () => {
    it('passes when no imports match the forbidden globs', () => {
      const sf = getSourceFile('src/domain/order.ts')
      const condition = notImportFrom('**/infra/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violations for imports matching forbidden globs', () => {
      const sf = getSourceFile('src/bad/leaky-domain.ts')
      const condition = notImportFrom('**/infra/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('infra'))).toBe(true)
    })
  })

  describe('onlyHaveTypeImportsFrom', () => {
    it('passes when imports from matching paths are type-only', () => {
      const sf = getSourceFile('src/domain/order.ts')
      // order.ts has: import type { Entity } from './entity.js'
      const condition = onlyHaveTypeImportsFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations).toHaveLength(0)
    })

    it('reports violations when a matching import is not type-only', () => {
      const sf = getSourceFile('src/bad/non-type-import.ts')
      // non-type-import.ts has: import { Entity } from '../domain/entity.js' (value import)
      const condition = onlyHaveTypeImportsFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations.some((v) => v.message.includes('type-only'))).toBe(true)
    })

    it('ignores imports from non-matching paths', () => {
      const sf = getSourceFile('src/bad/non-type-import.ts')
      // non-type-import.ts also imports from shared — not checked
      const condition = onlyHaveTypeImportsFrom('**/domain/**')
      const violations = condition.evaluate([sf], ctx)
      // Only the domain import is checked, not the shared import
      expect(violations).toHaveLength(1)
    })
  })
})
```

### `tests/builders/module-rule-builder.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { modules, ModuleRuleBuilder } from '../../src/builders/module-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('modules() entry point', () => {
  const p = loadTestProject()

  it('returns a ModuleRuleBuilder', () => {
    expect(modules(p)).toBeInstanceOf(ModuleRuleBuilder)
  })

  it('getElements returns all source files', () => {
    // Verify the builder has access to project source files
    // by running a rule that touches all modules
    expect(() => {
      modules(p).should().notExist().check()
    }).toThrow(ArchRuleError)
  })
})

describe('ModuleRuleBuilder fluent chain', () => {
  const p = loadTestProject()

  describe('predicate methods', () => {
    it('.resideInFolder() filters modules by folder', () => {
      // domain modules exist, so notExist should fail
      expect(() => {
        modules(p).that().resideInFolder('**/domain/**').should().notExist().check()
      }).toThrow(ArchRuleError)

      // no modules in nonexistent folder, so notExist should pass
      expect(() => {
        modules(p).that().resideInFolder('**/nonexistent/**').should().notExist().check()
      }).not.toThrow()
    })

    it('.importFrom() filters modules that import from a glob', () => {
      expect(() => {
        modules(p).that().importFrom('**/infra/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.havePathMatching() filters modules by path', () => {
      expect(() => {
        modules(p).that().havePathMatching('**/shared/**').should().notExist().check()
      }).toThrow(ArchRuleError)
    })

    it('.exportSymbolNamed() filters modules exporting a symbol', () => {
      expect(() => {
        modules(p).that().exportSymbolNamed('Order').should().notExist().check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('condition methods', () => {
    it('.onlyImportFrom() passes when domain imports are allowed', () => {
      expect(() => {
        modules(p)
          .that().resideInFolder('**/domain/**')
          .should().onlyImportFrom('**/domain/**', '**/shared/**')
          .check()
      }).not.toThrow()
    })

    it('.onlyImportFrom() fails when imports violate the constraint', () => {
      expect(() => {
        modules(p)
          .that().resideInFolder('**/bad/**')
          .should().onlyImportFrom('**/domain/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.notImportFromCondition() passes when no forbidden imports exist', () => {
      expect(() => {
        modules(p)
          .that().resideInFolder('**/domain/**')
          .should().notImportFromCondition('**/infra/**')
          .check()
      }).not.toThrow()
    })

    it('.notImportFromCondition() fails when forbidden imports exist', () => {
      expect(() => {
        modules(p)
          .that().resideInFolder('**/bad/**')
          .should().notImportFromCondition('**/infra/**')
          .check()
      }).toThrow(ArchRuleError)
    })

    it('.onlyHaveTypeImportsFrom() validates type-only imports', () => {
      expect(() => {
        modules(p)
          .that().havePathMatching('**/bad/non-type-import.ts')
          .should().onlyHaveTypeImportsFrom('**/domain/**')
          .check()
      }).toThrow(ArchRuleError)
    })
  })

  describe('full chain with .because()', () => {
    it('includes reason in error message', () => {
      try {
        modules(p)
          .that().resideInFolder('**/bad/**')
          .should().onlyImportFrom('**/domain/**')
          .because('bad modules should only use domain')
          .check()
        expect.unreachable('should have thrown')
      } catch (error) {
        const archError = error as ArchRuleError
        expect(archError.message).toContain('bad modules should only use domain')
      }
    })
  })

  describe('named selections', () => {
    it('supports reusing a predicate chain across multiple rules', () => {
      const domainModules = modules(p).that().resideInFolder('**/domain/**')

      expect(() => {
        domainModules.should().onlyImportFrom('**/domain/**', '**/shared/**').check()
      }).not.toThrow()

      expect(() => {
        domainModules.should().notImportFromCondition('**/infra/**').check()
      }).not.toThrow()
    })
  })
})
```

## Phase 6: Public API Export

### `src/index.ts` additions

```typescript
// Module predicates
export {
  importFrom,
  notImportFrom as predicateNotImportFrom,
  exportSymbolNamed,
  havePathMatching,
} from './predicates/module.js'

// Dependency conditions
export {
  onlyImportFrom,
  notImportFrom as conditionNotImportFrom,
  onlyHaveTypeImportsFrom,
} from './conditions/dependency.js'

// Module entry point
export { modules, ModuleRuleBuilder } from './builders/module-rule-builder.js'
```

## Files Changed

| File | Change |
|------|--------|
| `src/predicates/module.ts` | New — `importFrom`, `notImportFrom`, `exportSymbolNamed`, `havePathMatching` predicates |
| `src/conditions/dependency.ts` | New — `onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom` conditions |
| `src/builders/module-rule-builder.ts` | New — `ModuleRuleBuilder` class + `modules()` entry function |
| `src/index.ts` | Modified — export module predicates, dependency conditions, and `modules()` entry point |
| `tests/fixtures/modules/` | New — fixture project with domain/shared/infra/bad module structure |
| `tests/predicates/module.test.ts` | New — 8 tests for module predicates |
| `tests/conditions/dependency.test.ts` | New — 8 tests for dependency conditions |
| `tests/builders/module-rule-builder.test.ts` | New — 13 tests for builder + entry point |

## Test Inventory

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `importFrom` matches module with matching import | Predicate: positive match |
| 2 | `importFrom` rejects module with no matching import | Predicate: negative match |
| 3 | `importFrom` resolves absolute import paths | Import resolution works |
| 4 | `notImportFrom` matches module without forbidden import | Predicate: positive |
| 5 | `notImportFrom` rejects module with forbidden import | Predicate: negative |
| 6 | `exportSymbolNamed` matches module exporting the symbol | Export predicate |
| 7 | `exportSymbolNamed` rejects module not exporting it | Export predicate negative |
| 8 | `havePathMatching` matches by file path | Path glob predicate |
| 9 | `onlyImportFrom` passes when all imports are allowed | Allowlist condition: pass |
| 10 | `onlyImportFrom` reports violations for disallowed imports | Allowlist condition: fail |
| 11 | `onlyImportFrom` passes for modules with no imports | Vacuous truth |
| 12 | `onlyImportFrom` checks multiple modules, reports per import | Multi-element evaluation |
| 13 | `notImportFrom` condition passes when no forbidden imports | Denylist condition: pass |
| 14 | `notImportFrom` condition reports forbidden import violations | Denylist condition: fail |
| 15 | `onlyHaveTypeImportsFrom` passes for type-only imports | Type import: pass |
| 16 | `onlyHaveTypeImportsFrom` fails for value imports from matching paths | Type import: fail |
| 17 | `onlyHaveTypeImportsFrom` ignores non-matching paths | Selective checking |
| 18 | `modules()` returns ModuleRuleBuilder | Entry point type |
| 19 | `modules()` has access to project source files | getElements wiring |
| 20 | `.resideInFolder()` filters modules by folder | Identity predicate wiring |
| 21 | `.importFrom()` filters modules by import | Module predicate wiring |
| 22 | `.havePathMatching()` filters by path | Module predicate wiring |
| 23 | `.exportSymbolNamed()` filters by export | Module predicate wiring |
| 24 | `.onlyImportFrom()` passes valid dependency rules | Condition wiring: pass |
| 25 | `.onlyImportFrom()` fails invalid dependency rules | Condition wiring: fail |
| 26 | `.notImportFromCondition()` passes when clean | Condition wiring: pass |
| 27 | `.notImportFromCondition()` fails when dirty | Condition wiring: fail |
| 28 | `.onlyHaveTypeImportsFrom()` validates type-only imports | Condition wiring |
| 29 | Full chain with `.because()` includes reason | End-to-end with rationale |
| 30 | Named selections reuse predicates across rules | Fork semantics with real modules |

## Out of Scope

- **Class, function, and other entry points** (`classes()`, `functions()`, etc.) — plans 0008-0012
- **Barrel file / re-export detection** — future plan; would add `reExportFrom(glob)` predicate
- **Circular dependency detection** — separate concern, likely plan 0014+; requires graph analysis across the entire project, not per-module conditions
- **Path alias resolution** (`@/` style imports) — ts-morph handles this via tsconfig `paths`; no extra work needed. If a tsconfig has `paths` configured, `getModuleSpecifierSourceFile()` resolves through them automatically
- **External package import conditions** (e.g., "must not import lodash") — the raw specifier matching covers this partially, but a dedicated `onlyImportPackages(...)` condition would be cleaner; deferred
- **`.orShould()` OR conditions** — deferred per plan 0005 decision
- **Custom predicate/condition extension API** — plan 0013
