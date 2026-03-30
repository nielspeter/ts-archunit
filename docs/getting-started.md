# Getting Started

## Prerequisites

- **Node.js** >= 24
- A TypeScript project with a `tsconfig.json`
- A test runner: [vitest](https://vitest.dev/) (recommended) or [jest](https://jestjs.io/)

## Installation

```bash
npm install -D @nielspeter/ts-archunit
```

## Quick Start with Presets

The fastest way to add architecture rules. One function call enforces an entire architecture pattern:

```typescript
import { describe, it } from 'vitest'
import { project } from '@nielspeter/ts-archunit'
import { layeredArchitecture } from '@nielspeter/ts-archunit/presets'

const p = project('tsconfig.json')

describe('Architecture', () => {
  it('enforces layered architecture', () => {
    layeredArchitecture(p, {
      layers: {
        routes: 'src/routes/**',
        services: 'src/services/**',
        repositories: 'src/repositories/**',
      },
      shared: ['src/shared/**'],
      strict: true,
    })
  })
})
```

This generates 5 coordinated rules: layer ordering, cycle detection, innermost isolation, type-import enforcement, and package restrictions. See [Architecture Presets](/presets) for the full API.

## Your First Custom Rule

For project-specific constraints, use the fluent API directly:

```typescript
import { describe, it } from 'vitest'
import { project, modules } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

describe('Architecture Rules', () => {
  it('domain must not import from infrastructure', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .because('Domain must be independent of infrastructure')
      .check()
  })
})
```

## Running It

```bash
npx vitest run arch.test.ts
```

That's it. Architecture rules are regular tests. They run alongside your unit tests.

## What Happens When a Rule Fails

When a module in `domain/` imports from `infrastructure/`, you see:

```
Architecture Violation [1 of 1]

  Rule: Modules in '**/domain/**' should only import from '**/domain/**', '**/shared/**'

  src/domain/order.service.ts:3 — order.service.ts

  Why: Domain must be independent of infrastructure

    2 | import { OrderEntity } from './order.entity'
  > 3 | import { db } from '../infrastructure/database'
    4 | import { validate } from '../shared/validation'
```

The test fails, your CI blocks the PR, the violation is caught before code review.

## Adding Rich Metadata

Every rule can include context about why it exists and how to fix it:

```typescript
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .onlyImportFrom('**/domain/**', '**/shared/**')
  .rule({
    id: 'layer/domain-isolation',
    because: 'Domain must be independent of infrastructure for testability',
    suggestion: 'Move the import to a service that bridges domain and infrastructure',
    docs: 'https://example.com/adr/clean-architecture',
  })
  .check()
```

## Organizing Rules

Use `describe` blocks to group rules by concern:

```typescript
import { describe, it } from 'vitest'
import { project, modules, classes, slices, call, newExpr } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

describe('Layer Dependencies', () => {
  it('domain must not import from infrastructure', () => {
    /* ... */
  })
  it('repositories must not import from controllers', () => {
    /* ... */
  })
})

describe('Naming Conventions', () => {
  it('controllers must end with Controller', () => {
    /* ... */
  })
  it('services must end with Service', () => {
    /* ... */
  })
})

describe('Body Analysis', () => {
  it('repositories must not call parseInt directly', () => {
    /* ... */
  })
  it('services must use typed errors', () => {
    /* ... */
  })
})
```

### Named Selections

Save a predicate chain for reuse across multiple rules:

```typescript
const repositories = classes(p).that().extend('BaseRepository')

repositories.should().notContain(call('parseInt')).check()
repositories.should().notContain(newExpr('Error')).check()
repositories.should().beExported().check()
```

### Multiple Rule Files

Split rules across files for larger projects:

```
tests/
├── arch/
│   ├── layers.test.ts
│   ├── naming.test.ts
│   ├── body-analysis.test.ts
│   └── type-safety.test.ts
```

## CI Integration

Architecture rules are tests. If your CI already runs tests, it already runs architecture rules. No extra setup needed.

```yaml
# .github/workflows/ci.yml
- run: npm test
```

### GitHub Actions Annotations

Violations appear inline on PR diffs automatically when running in GitHub Actions:

```typescript
import { detectFormat } from '@nielspeter/ts-archunit'

const format = detectFormat() // 'github' in CI, 'terminal' locally

modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .onlyImportFrom('**/domain/**', '**/shared/**')
  .check({ format })
```

## CLI

ts-archunit also runs standalone without a test runner — for pre-commit hooks, CI pipelines, or one-off audits. See the [CLI documentation](/cli) for all commands, options, watch mode, and config file setup.

```bash
npx ts-archunit check arch.rules.ts
npx ts-archunit check arch.rules.ts --watch
```

## Next Steps

- [What to Check](/what-to-check) — scan the recipe gallery to see what ts-archunit can enforce
- [Core Concepts](/core-concepts) — understand the fluent chain and how rules work
- [API Reference](/api-reference) — full list of every export
