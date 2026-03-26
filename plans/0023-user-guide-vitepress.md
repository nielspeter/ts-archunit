# Plan 0023: User Guide with VitePress

## Status

- **State:** Not Started
- **Priority:** P2 — Important for adoption, not blocking features
- **Effort:** 1-2 days
- **Created:** 2026-03-26
- **Depends on:** MVP complete (plans 0000-0013)

## Purpose

Create a comprehensive user guide for ts-archunit using VitePress, deployed to GitHub Pages. The guide serves two audiences:

1. **New users** — install, first rule, integrate with CI
2. **Power users** — custom rules, type matchers, body analysis patterns, slice architecture

Modeled on the [ArchUnit User Guide](https://www.archunit.org/userguide/html/000_Index.html) structure but adapted for TypeScript conventions.

## Phase 1: VitePress Setup

### Install

```bash
npm install -D vitepress
```

### Directory structure

```
docs/
├── .vitepress/
│   └── config.ts          # VitePress config (sidebar, nav, metadata)
├── index.md               # Landing page
├── getting-started.md     # Install + first rule
├── what-to-check.md       # Recipe gallery — 8 rule categories as one-liners (inspired by ArchUnit Section 4)
├── core-concepts.md       # Project, predicates, conditions, the chain + before/after motivation
├── modules.md             # modules() entry point + dependency rules
├── classes.md             # classes() entry point + class predicates/conditions
├── functions.md           # functions() entry point + ArchFunction
├── types.md               # types() entry point + type matchers
├── body-analysis.md       # call(), newExpr(), access(), expression()
├── slices.md              # slices() + cycles + layer ordering
├── custom-rules.md        # definePredicate, defineCondition, .satisfy()
├── violation-reporting.md # Output formats, code frames, .warn() vs .check()
└── api-reference.md       # All exports at a glance
```

### `docs/.vitepress/config.ts`

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ts-archunit',
  description: 'Architecture testing for TypeScript',
  base: '/ts-archunit/',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'API', link: '/api-reference' },
      { text: 'GitHub', link: 'https://github.com/NielsPeter/ts-archunit' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is ts-archunit?', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'What to Check', link: '/what-to-check' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Core Concepts', link: '/core-concepts' },
          { text: 'Module Rules', link: '/modules' },
          { text: 'Class Rules', link: '/classes' },
          { text: 'Function Rules', link: '/functions' },
          { text: 'Type Rules', link: '/types' },
          { text: 'Body Analysis', link: '/body-analysis' },
          { text: 'Slices & Layers', link: '/slices' },
          { text: 'Custom Rules', link: '/custom-rules' },
          { text: 'Violation Reporting', link: '/violation-reporting' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api-reference' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
    },
  },
})
```

### Package.json scripts

```json
{
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs"
  }
}
```

### `.gitignore` addition

```
docs/.vitepress/dist/
docs/.vitepress/cache/
```

## Phase 2: Landing Page

### `docs/index.md`

```markdown
---
layout: home
hero:
  name: ts-archunit
  text: Architecture Testing for TypeScript
  tagline: Enforce structural rules across your codebase as executable tests
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/NielsPeter/ts-archunit

features:
  - title: Rules as Tests
    details: Architecture rules run in vitest/jest. CI catches violations before code review.
  - title: Body Analysis
    details: Inspect what happens inside functions — no other TS tool does this. Detect banned calls, wrong constructors, missing patterns.
  - title: Type Checking
    details: Distinguish bare string from typed unions. Resolves through aliases, Partial<>, Pick<>.
  - title: Layer Enforcement
    details: Enforce dependency direction between layers. Detect cycles between feature modules.
---
```

## Phase 3: Getting Started

### `docs/getting-started.md`

Content:
1. Prerequisites (Node 24+, tsconfig.json, vitest or jest)
2. Installation (`npm install -D ts-archunit`)
3. First rule file (`arch.test.ts`)
4. Example: domain must not import infrastructure
5. Running it (`npx vitest run arch.test.ts`)
6. What happens when a rule fails (show violation output with code frame)
7. Organizing rules (describe blocks, multiple files, named selections)
8. Integration with CI (just run your tests — nothing extra needed)

Each section has a working code example that can be copy-pasted.

## Phase 3b: What to Check (inspired by ArchUnit Section 4)

### `docs/what-to-check.md`

A recipe gallery placed before any API theory. Shows what ts-archunit can do in one-liner examples. No explanation of predicates or conditions — just "here's what you can enforce." The user should be able to scan this page in 2 minutes and know if the tool solves their problem.

Categories (each with 1-2 code snippets):

1. **Import Dependencies** — "domain must not import from infrastructure"
2. **Layer Ordering** — "dependencies flow controllers → services → domain"
3. **Cycle Detection** — "no circular dependencies between feature modules"
4. **Naming Conventions** — "controllers end with Controller, services end with Service"
5. **Class Structure** — "repositories must extend BaseRepository"
6. **Body Analysis** — "no raw parseInt, use shared helper instead"
7. **Type Safety** — "query options must use typed unions, not bare string"
8. **Custom Rules** — "define your own team conventions"

Each category is 3-5 lines: a sentence describing the rule, then the code. No chain explanation, no predicate/condition theory. Just results.

::: tip
This is the "sell" page. If a user reads only one page after the landing page, it should be this one.
:::

## Phase 4: Core Concepts

### `docs/core-concepts.md`

Content:

**Before/After motivation** (inspired by ArchUnit Section 7.1) — open with a comparison showing raw ts-morph code (10-15 lines of AST traversal from the PoC probes) vs the ts-archunit one-liner. This motivates *why* the fluent chain exists before explaining how it works.

```typescript
// WITHOUT ts-archunit: 12 lines of manual AST traversal
const project = new Project({ tsConfigFilePath: 'tsconfig.json' })
const classes = project.getSourceFiles()
  .flatMap(sf => sf.getClasses())
  .filter(cls => cls.getExtends()?.getExpression().getText() === 'BaseService')
for (const cls of classes) {
  for (const method of cls.getMethods()) {
    const calls = method.getDescendantsOfKind(SyntaxKind.CallExpression)
    if (calls.some(c => c.getExpression().getText() === 'parseInt')) {
      throw new Error(`${cls.getName()} calls parseInt`)
    }
  }
}

// WITH ts-archunit: 1 chain
classes(p).that().extend('BaseService').should().notContain(call('parseInt')).check()
```

Then the concepts:

1. **Project** — `project('tsconfig.json')` loads the project, cached per path
2. **Entry points** — `modules()`, `classes()`, `functions()`, `types()`, `slices()` — each returns a builder
3. **The chain** — `.that()` → predicates → `.should()` → conditions → `.check()` (with diagram)
4. **Predicates** — filter which elements the rule applies to (identity + type-specific)
5. **Conditions** — assert what must be true about filtered elements
6. **Violations** — what you see when a rule fails
7. **Named selections** — save a `.that()` chain, reuse with multiple `.should()` rules
8. **`.check()` vs `.warn()`** — fail CI vs advisory
9. **Composing rules** — `.and()` for predicates, `.andShould()` for conditions, `and()`/`or()`/`not()` combinators

Diagram of the chain flow. Table of all identity predicates. Table of all structural conditions.

## Phase 5: Entry Point Pages

One page per entry point, each following the same structure:

### Template for each page:

1. **When to use** — what architectural questions this entry point answers
2. **Basic usage** — simplest rule with this entry point
3. **Available predicates** — table with description and example for each
4. **Available conditions** — table with description and example for each
5. **Real-world examples** — 3-5 rules you'd actually write
6. **Combining with other entry points** — e.g., use `modules()` for imports + `classes()` for body analysis on the same codebase

### `docs/modules.md` — Module Rules

- Import/dependency enforcement
- `onlyImportFrom`, `notImportFrom`, `onlyHaveTypeImportsFrom`
- Example: domain layer isolation
- Example: feature module boundaries

### `docs/classes.md` — Class Rules

- Inheritance, decorators, methods, properties
- `extend`, `implement`, `haveDecorator`, `areAbstract`
- Condition versions: `shouldExtend`, `shouldHaveMethodNamed`
- Example: repository patterns, service conventions

### `docs/functions.md` — Function Rules

- Handles both `function` declarations and `const` arrow functions
- `areAsync`, `haveParameterCount`, `haveReturnType`
- Example: ban copy-pasted parsers (`notExist`)
- Example: route handlers must be async

### `docs/types.md` — Type Rules

- Interfaces + type aliases
- Type matchers: `isString`, `isUnionOfLiterals`, `notType`, `matching`
- `havePropertyType` with `getNonNullableType` (explained for users)
- Example: query options must use typed unions
- Example: API response types must have a `data` property

### `docs/body-analysis.md` — Body Analysis

The signature feature. Detailed page:

1. **What body analysis is** — inspecting AST inside method/function bodies
2. **Matchers** — `call()`, `newExpr()`, `access()`, `expression()`
3. **String vs regex** — `call('parseInt')` vs `call(/^parse/)`
4. **Optional chaining** — `this?.foo` matches `this.foo` automatically
5. **Conditions** — `contain()`, `notContain()`, `useInsteadOf()`
6. **Class vs function scope** — class body = all methods; function body = the function
7. **Known limitations** — destructured calls not matched, no cross-file tracing
8. **Examples:**
   - Ban `parseInt`, require `this.extractCount()`
   - Ban `new Error()`, require typed domain errors
   - Ban `new URLSearchParams()`, require `buildQueryString()`
   - Ban `console.log` in production code

### `docs/slices.md` — Slices & Layers

1. **What slices are** — logical groupings of files
2. **Defining slices** — `matching('src/features/*/')` vs `assignedFrom({ ... })`
3. **Cycle detection** — `beFreeOfCycles()` with Tarjan's SCC
4. **Layer ordering** — `respectLayerOrder('controllers', 'services', 'domain')`
5. **Isolation** — `notDependOn('legacy')`
6. **Examples:**
   - Feature module independence
   - Clean architecture layers
   - Monorepo package boundaries

## Phase 6: Custom Rules

### `docs/custom-rules.md`

1. **Why custom rules** — encode team-specific conventions
2. **`definePredicate()`** — filter with custom logic
3. **`defineCondition()`** — assert with custom logic + violation creation
4. **`.satisfy()`** — plug custom predicates/conditions into the chain
5. **Composing with built-in combinators** — `and()`, `or()`, `not()`
6. **Real-world examples:**
   - "Services must have a logger field"
   - "Controllers must not return entity types"
   - "All exported functions must have JSDoc"

## Phase 7: Violation Reporting

### `docs/violation-reporting.md`

1. **What you see** — code frames, file paths, line numbers, suggestions
2. **`.check()` vs `.warn()`** — when to use each
3. **`.severity('error' | 'warn')`** — programmatic severity
4. **`.because()`** — why the rule exists (shown in output)
5. **Error structure** — `ArchRuleError` with `.violations` array
6. **Programmatic access** — catch `ArchRuleError` for custom reporting

## Phase 8: API Reference

### `docs/api-reference.md`

Comprehensive table of all exports, grouped by category:

1. **Entry points** — `project`, `modules`, `classes`, `functions`, `types`, `slices`
2. **Identity predicates** — `haveNameMatching`, `resideInFolder`, `areExported`, etc.
3. **Class predicates** — `extend`, `implement`, `haveDecorator`, etc.
4. **Function predicates** — `areAsync`, `haveParameterCount`, etc.
5. **Type predicates** — `areInterfaces`, `haveProperty`, etc.
6. **Module predicates** — `importFrom`, `exportSymbolNamed`, etc.
7. **Structural conditions** — `notExist`, `beExported`, etc.
8. **Class conditions** — `shouldExtend`, `shouldHaveMethodNamed`, etc.
9. **Dependency conditions** — `onlyImportFrom`, `notImportFrom`, etc.
10. **Body analysis matchers** — `call`, `newExpr`, `access`, `expression`
11. **Body analysis conditions** — `classContain`, `functionNotContain`, `useInsteadOf`
12. **Type matchers** — `isString`, `isUnionOfLiterals`, `notType`, etc.
13. **Slice conditions** — `beFreeOfCycles`, `respectLayerOrder`, `notDependOn`
14. **Extension API** — `definePredicate`, `defineCondition`, `satisfy`
15. **Utilities** — `createViolation`, `generateCodeFrame`, `formatViolations`

Each entry: name, signature, description, one-line example.

## Phase 9: GitHub Pages Deployment

### GitHub Actions workflow

```yaml
# .github/workflows/docs.yml
name: Deploy Docs

on:
  push:
    branches: [main]
    paths: ['docs/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run docs:build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist
      - uses: actions/deploy-pages@v4
```

### Enable GitHub Pages

In repo settings: Pages → Source → GitHub Actions.

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add vitepress devDependency + docs scripts |
| `.gitignore` | Add docs/.vitepress/dist/ and docs/.vitepress/cache/ |
| `docs/.vitepress/config.ts` | VitePress configuration |
| `docs/index.md` | Landing page with hero + features |
| `docs/getting-started.md` | Install, first rule, CI integration |
| `docs/what-to-check.md` | Recipe gallery — 8 rule categories as one-liners |
| `docs/core-concepts.md` | Project, chain, predicates, conditions |
| `docs/modules.md` | Module entry point + dependency rules |
| `docs/classes.md` | Class entry point + class predicates/conditions |
| `docs/functions.md` | Function entry point + ArchFunction |
| `docs/types.md` | Type entry point + type matchers |
| `docs/body-analysis.md` | Matchers, conditions, examples |
| `docs/slices.md` | Slice resolution, cycles, layers |
| `docs/custom-rules.md` | definePredicate, defineCondition, satisfy |
| `docs/violation-reporting.md` | Output, code frames, error handling |
| `docs/api-reference.md` | All exports table |
| `.github/workflows/docs.yml` | GitHub Pages deployment |

## Out of Scope

- **API docs from JSDoc** — auto-generation with TypeDoc is a future enhancement, not needed for v0
- **Versioned docs** — one version for now, versioning when we have breaking changes
- **i18n** — English only
- **Blog** — no blog section
- **Search analytics** — VitePress local search is sufficient
- **Custom theme** — default VitePress theme is clean and professional
- **P2 features** (baseline, diff-aware, call entry point, within, patterns, smells) — pages added when those plans are implemented
