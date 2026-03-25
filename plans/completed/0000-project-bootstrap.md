# Plan 0000: Project Bootstrap & Package Setup

## Status

- **State:** Complete
- **Priority:** P0 — Everything depends on this
- **Effort:** 2-3 hours
- **Created:** 2026-03-25
- **Completed:** 2026-03-25
- **Depends on:** None

### Deviations from plan

1. **ESLint needs `jiti`** — ESLint 10 requires the `jiti` package to load TypeScript config files (`eslint.config.ts`). Added as devDependency.
2. **Two tsconfig files** — `tsconfig.json` includes both `src/` and `tests/` (for type-checking and ESLint). `tsconfig.build.json` extends it but only includes `src/` (for emitting to `dist/`). Build script changed to `tsc -p tsconfig.build.json`.
3. **ESLint `projectService` needs `tsconfigRootDir`** — Added `tsconfigRootDir: import.meta.dirname` to parserOptions for correct tsconfig discovery.

## Purpose

Set up the ts-archunit npm package from scratch: package.json, tsconfig, vitest, eslint, prettier, directory structure. After this plan, the project compiles, lints, formats, and runs an empty test suite.

All decisions follow the project's ADRs:

- ADR-001: Node.js + Vitest + ESLint + Prettier
- ADR-002: ts-morph as AST engine
- ADR-004: ESM-only package

## Phase 1: Package Initialization

```bash
npm init -y
```

**`package.json`:**

```json
{
  "name": "ts-archunit",
  "version": "0.0.1",
  "description": "Architecture testing for TypeScript",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "engines": {
    "node": ">=24.0.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src/ tests/",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit"
  },
  "keywords": ["typescript", "architecture", "testing", "archunit", "static-analysis"],
  "license": "MIT"
}
```

**Notes:**

- `"type": "module"` per ADR-004 (ESM-only)
- `"node": ">=24.0.0"` — Node 24 LTS (consistent with cmless project)

## Phase 2: Dependencies

Pinned to latest stable versions as of 2026-03-25:

```bash
# Runtime dependencies
npm install ts-morph@27 picomatch@4

# Dev dependencies
npm install -D "typescript@~5.9.3" vitest@4 eslint@10 prettier@3 typescript-eslint@8 eslint-config-prettier@10 @eslint/js@10 @types/picomatch@4
```

| Package                  | Version | Purpose                                                        | Type          |
| ------------------------ | ------- | -------------------------------------------------------------- | ------------- |
| `ts-morph`               | 27.0.2  | AST analysis + type checker (ADR-002)                          | dependency    |
| `picomatch`              | 4.0.4   | Glob pattern matching                                          | dependency    |
| `typescript`             | ~5.9.3  | Compilation + type checking (pinned to ts-morph compatibility) | devDependency |
| `vitest`                 | 4.1.1   | Test runner (ADR-001)                                          | devDependency |
| `eslint`                 | 10.1.0  | Linting (ADR-001)                                              | devDependency |
| `prettier`               | 3.8.1   | Formatting (ADR-001)                                           | devDependency |
| `typescript-eslint`      | 8.57.2  | TypeScript-aware ESLint (unified package)                      | devDependency |
| `@eslint/js`             | 10.x    | ESLint recommended JS rules                                    | devDependency |
| `eslint-config-prettier` | 10.1.8  | Disable ESLint rules that conflict with Prettier               | devDependency |
| `@types/picomatch`       | 4.0.2   | Type definitions for picomatch                                 | devDependency |

**Note:** Using `typescript-eslint` unified package (not separate `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser`). The unified package is the recommended approach since v8.

## Phase 3: TypeScript Configuration

**`tsconfig.json`:**

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests", "poc"]
}
```

**Key choices:**

- `strict: true` + `noUncheckedIndexedAccess: true` — strictest possible (ADR-001)
- `target: "ES2024"` — Node 24 supports ES2024 fully
- `module: "Node16"` + `moduleResolution: "Node16"` — ESM with `.js` extensions in imports (ADR-004)
- `declaration: true` — ship `.d.ts` files for consumers
- `rootDir: "src"` — only `src/` compiles to `dist/`

## Phase 4: ESLint Configuration

**`eslint.config.ts`** (flat config, ESLint 10, typescript-eslint v8):

```typescript
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  prettierConfig,
)
```

**Key choices:**

- `tseslint.config()` helper — the recommended approach for typescript-eslint v8+
- `recommendedTypeChecked` — enables type-aware linting rules (catches unsafe `any` usage, etc.)
- `projectService: true` — automatic tsconfig discovery (replaces `project: './tsconfig.json'`)
- `eslint.config.ts` (not `.js`) — ESLint 10 supports TypeScript config files natively

## Phase 5: Prettier Configuration

**`.prettierrc`:**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

**`.prettierignore`:**

```
dist/
node_modules/
coverage/
poc/fixtures/
```

**Note:** `poc/fixtures/` is ignored because fixture files need intentionally "bad" code (e.g., inconsistent formatting) for testing.

## Phase 6: Vitest Configuration

**`vitest.config.ts`:**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
})
```

## Phase 7: Directory Structure

```bash
mkdir -p src/core src/builders src/predicates src/conditions src/helpers src/smells
mkdir -p tests/fixtures tests/predicates tests/conditions tests/integration
```

**`src/index.ts`** (placeholder):

```typescript
// ts-archunit — Architecture testing for TypeScript
// Public API will be exported here
export {}
```

**`tests/smoke.test.ts`** (verify setup works):

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'

describe('smoke test', () => {
  it('ts-morph loads a project', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile('test.ts', 'export class Foo extends Bar {}')
    const classes = sourceFile.getClasses()
    expect(classes).toHaveLength(1)
    expect(classes[0].getName()).toBe('Foo')
    expect(classes[0].getExtends()?.getText()).toBe('Bar')
  })
})
```

## Phase 8: Git Setup

**`.gitignore`:**

```
node_modules/
dist/
coverage/
*.tsbuildinfo
.DS_Store
```

```bash
git init
git add .
git commit -m "chore: initial project setup"
```

## Verification

After all phases, these commands must pass:

```bash
npm run typecheck     # tsc --noEmit — zero errors
npm run lint          # eslint — zero errors
npm run format:check  # prettier — all files formatted
npm run test          # vitest — smoke test passes
npm run build         # tsc — compiles to dist/
```

## Files Created

| File                  | Purpose                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `package.json`        | Package metadata, scripts, dependencies                            |
| `tsconfig.json`       | TypeScript 5.9 strict config, ESM, Node16 module                   |
| `eslint.config.ts`    | ESLint 10 flat config with typescript-eslint v8 type-checked rules |
| `.prettierrc`         | Prettier 3.8 formatting rules                                      |
| `.prettierignore`     | Exclude dist, node_modules, fixtures                               |
| `vitest.config.ts`    | Vitest 4 test configuration                                        |
| `.gitignore`          | Git ignore rules                                                   |
| `src/index.ts`        | Empty placeholder for public API                                   |
| `tests/smoke.test.ts` | Smoke test verifying ts-morph works                                |

## Out of Scope

- Any actual library code — that starts in plan 0001 (PoC) and plan 0002+
- CI/CD (GitHub Actions) — separate plan when we're ready to publish
- README.md — not needed until we have something to document
- npm publish configuration — premature until MVP
