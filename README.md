# ts-archunit

[![npm version](https://img.shields.io/npm/v/@nielspeter/ts-archunit)](https://www.npmjs.com/package/@nielspeter/ts-archunit)
[![CI](https://github.com/nielspeter/ts-archunit/actions/workflows/ci.yml/badge.svg)](https://github.com/nielspeter/ts-archunit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 24](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org/)

**Architecture guardrails for AI coding agents.** Executable rules that catch structural violations in CI — before they reach your codebase.

Inspired by Java's [ArchUnit](https://www.archunit.org/). Powered by [ts-morph](https://ts-morph.com/).

[Documentation](https://nielspeter.github.io/ts-archunit/) · [Getting Started](https://nielspeter.github.io/ts-archunit/getting-started) · [What Can It Check?](https://nielspeter.github.io/ts-archunit/what-to-check)

## The Problem

AI coding agents don't know your architecture. They generate code that compiles, passes type checks, and looks correct in isolation — but violates the structural decisions your team spent months establishing.

An agent will:

- Call `parseInt` instead of the shared `extractCount()` helper
- Throw `new Error()` instead of your typed `NotFoundError`
- Import the database driver directly from a service instead of going through the repository
- Copy-paste a parser function instead of using the shared utility
- Skip validation in a route handler

Code review catches some of this. But at scale — with multiple agents generating PRs across a large codebase — review becomes the bottleneck. You need automated enforcement.

## The Solution

ts-archunit turns your architecture decisions into executable tests. They run in CI. Violations show up inline on the PR with clear messages explaining **what's wrong, why it matters, and how to fix it** — exactly the context an agent needs to self-correct.

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(newExpr('Error'))
  .rule({
    id: 'repo/typed-errors',
    because: 'Generic Error loses context and prevents consistent error handling',
    suggestion: 'Use NotFoundError, ValidationError, or DomainError instead',
  })
  .check()
```

When an agent violates this rule, it sees:

```
Architecture Violation [repo/typed-errors]

  WebhookRepository.findById contains new 'Error' at line 42
  at src/repositories/webhook.repository.ts:42

      41 |     if (!result) {
    > 42 |       throw new Error(`Webhook '${id}' not found`)
      43 |     }

  Why: Generic Error loses context and prevents consistent error handling
  Fix: Use NotFoundError, ValidationError, or DomainError instead
```

The `because` and `suggestion` fields give the agent everything it needs to fix the violation without human intervention.

## Why Not Just Import Rules?

Every other tool (dependency-cruiser, eslint-plugin-boundaries, ts-arch) only checks which files import which. That's necessary but insufficient.

AI agents don't violate architecture by importing wrong files. They violate it by **writing the wrong code in the right place** — inlining logic instead of delegating, using raw APIs instead of abstractions, skipping validation, throwing generic errors.

ts-archunit checks what happens **inside** your functions:

```typescript
// "Services must delegate to repositories, not hardcode data"
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(mustCall(/Repository/))
  .check()

// "No eval anywhere in production code"
modules(p).that().resideInFolder('src/**').should().satisfy(moduleNoEval()).check()

// "Route handlers must validate input"
functions(p)
  .that()
  .resideInFolder('**/handlers/**')
  .should()
  .satisfy(mustCall(/validate|parse/))
  .check()
```

| Capability                                         | ts-archunit | dependency-cruiser | eslint-plugin-boundaries |
| -------------------------------------------------- | ----------- | ------------------ | ------------------------ |
| Import path rules                                  | Yes         | Yes                | Yes                      |
| **Body analysis** (what's called inside functions) | Yes         | No                 | No                       |
| **Type checking** (string vs typed union)          | Yes         | No                 | No                       |
| Cycle detection                                    | Yes         | Yes                | No                       |
| Baseline (gradual adoption)                        | Yes         | No                 | No                       |
| GitHub PR annotations                              | Yes         | No                 | No                       |

## Quick Start with Presets

One function call enforces an entire architecture pattern — layer ordering, cycles, import direction, package restrictions:

```typescript
import { project } from '@nielspeter/ts-archunit'
import { layeredArchitecture } from '@nielspeter/ts-archunit/presets'

const p = project('tsconfig.json')

layeredArchitecture(p, {
  layers: {
    routes: 'src/routes/**',
    services: 'src/services/**',
    repositories: 'src/repositories/**',
  },
  shared: ['src/shared/**'],
  strict: true,
})
```

This generates 5 coordinated rules. Override individual rules without disabling the preset:

```typescript
layeredArchitecture(p, {
  layers: { ... },
  overrides: {
    'preset/layered/type-imports-only': 'off',
  },
})
```

Three presets available: [`layeredArchitecture`](https://nielspeter.github.io/ts-archunit/presets), [`dataLayerIsolation`](https://nielspeter.github.io/ts-archunit/presets#datalayerisolation), [`strictBoundaries`](https://nielspeter.github.io/ts-archunit/presets#strictboundaries).

## Feed Your Architecture to the Agent

The `explain` command dumps all active rules as structured JSON — pipe it into your agent's system prompt so it knows the constraints before writing code:

```bash
npx ts-archunit explain arch.rules.ts
```

```json
{
  "rules": [
    {
      "id": "repo/typed-errors",
      "rule": "that extend 'BaseRepository' should not contain new 'Error'",
      "because": "Generic Error loses context and prevents consistent error handling",
      "suggestion": "Use NotFoundError, ValidationError, or DomainError instead"
    }
  ]
}
```

The agent reads the rules, understands the constraints, and generates compliant code from the start. When it doesn't, CI catches it with actionable violation messages.

## Custom Rules

The fluent API reads like English:

```typescript
// Select → Filter → Assert → Execute
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
```

### Body Analysis

Inspect what happens inside functions — the differentiator:

```typescript
// Ban inline parseInt — use the shared helper
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .useInsteadOf(call('parseInt'), call('this.extractCount'))
  .check()

// Services must delegate to repositories
functions(p)
  .that()
  .resideInFolder('**/services/**')
  .should()
  .satisfy(mustCall(/Repository/))
  .check()

// No process.env in domain — use dependency injection
functions(p).that().resideInFolder('**/domain/**').should().satisfy(functionNoProcessEnv()).check()
```

### Layer Enforcement

```typescript
slices(p)
  .assignedFrom({
    controllers: 'src/controllers/**',
    services: 'src/services/**',
    repositories: 'src/repositories/**',
  })
  .should()
  .respectLayerOrder('controllers', 'services', 'repositories')
  .check()

slices(p).matching('src/features/*/').should().beFreeOfCycles().check()
```

### Type-Level Rules

Check property types using the TypeScript type checker:

```typescript
types(p)
  .that()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', not(isString()))
  .rule({
    because: 'Bare string orderBy is a SQL injection surface',
    suggestion: "Use a union type: orderBy?: 'created_at' | 'updated_at'",
  })
  .check()
```

### Standard Rules Library

25+ ready-to-use rules across 8 categories:

```typescript
import {
  functionNoEval,
  functionNoConsole,
  functionNoJsonParse,
} from '@nielspeter/ts-archunit/rules/security'
import { functionNoGenericErrors } from '@nielspeter/ts-archunit/rules/errors'
import { mustCall } from '@nielspeter/ts-archunit/rules/architecture'
import { noDeadModules, noStubComments, noEmptyBodies } from '@nielspeter/ts-archunit/rules/hygiene'

functions(p).that().resideInFolder('src/**').should().satisfy(functionNoEval()).check()
functions(p).that().resideInFolder('src/**').should().satisfy(noEmptyBodies()).check()
functions(p).that().resideInFolder('src/**').should().satisfy(noStubComments()).check()
```

Categories: `rules/typescript`, `rules/security`, `rules/errors`, `rules/naming`, `rules/dependencies`, `rules/code-quality`, `rules/metrics`, `rules/architecture`, `rules/hygiene`.

### Baseline Mode

Adopt rules in existing codebases without fixing every pre-existing violation:

```typescript
const baseline = withBaseline('arch-baseline.json')

// Only NEW violations fail — existing ones are recorded
classes(p).should().notContain(call('parseInt')).check({ baseline })
```

### GitHub Actions Annotations

Violations appear inline on PR diffs — automatically detected in GitHub Actions:

```typescript
classes(p).should().notContain(call('eval')).check({ format: detectFormat() })
```

### Smell Detection

Find code drift — duplicate function bodies and inconsistent patterns:

```typescript
smells.duplicateBodies(p).inFolder('src/routes/**').withMinSimilarity(0.9).warn()

smells
  .inconsistentSiblings(p)
  .inFolder('src/repositories/**')
  .forPattern(call('this.extractCount'))
  .warn()
```

### More Features

- **[Call matching](https://nielspeter.github.io/ts-archunit/calls)** — framework-agnostic route/handler inspection (Express, Fastify, Hono)
- **[Scoped rules](https://nielspeter.github.io/ts-archunit/body-analysis)** — `within(routes).functions()` for callback-level rules
- **[Pattern templates](https://nielspeter.github.io/ts-archunit/patterns)** — enforce return type shapes (`{ items, total, skip, limit }`)
- **[GraphQL rules](https://nielspeter.github.io/ts-archunit/graphql)** — schema and resolver conventions
- **[Cross-layer validation](https://nielspeter.github.io/ts-archunit/cross-layer)** — route/schema/SDK consistency
- **[Custom predicates and conditions](https://nielspeter.github.io/ts-archunit/custom-rules)** — `definePredicate()`, `defineCondition()`, `and`/`or`/`not` combinators
- **[Metrics](https://nielspeter.github.io/ts-archunit/metrics)** — cyclomatic complexity, lines of code, method count limits
- **[CLI](https://nielspeter.github.io/ts-archunit/cli)** — `check`, `baseline`, `explain`, `--watch` mode

## Entry Points

| Function       | Operates on                               | Use case                                        |
| -------------- | ----------------------------------------- | ----------------------------------------------- |
| `modules(p)`   | Source files                              | Import/dependency rules                         |
| `classes(p)`   | Class declarations                        | Inheritance, decorators, methods, body analysis |
| `functions(p)` | Functions, arrow functions, class methods | Naming, parameters, body analysis               |
| `types(p)`     | Interfaces + type aliases                 | Property types, type safety                     |
| `slices(p)`    | Groups of files                           | Cycles, layer ordering                          |
| `calls(p)`     | Call expressions                          | Framework-agnostic route/handler matching       |
| `within(sel)`  | Scoped callbacks                          | Rules inside matched call callbacks             |

## Compared to Other Tools

| Capability                                        | ts-archunit | [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) |
| ------------------------------------------------- | ----------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| Import path rules                                 | Yes         | Yes                                                                  | Yes                                                      |
| **Body analysis** (calls, access, constructors)   | Yes         | No                                                                   | No                                                       |
| **Type checking** (resolved types via ts-morph)   | Yes         | No                                                                   | No                                                       |
| Class rules (inheritance, decorators, members)    | Yes         | No                                                                   | No                                                       |
| Function rules (params, return types, async)      | Yes         | No                                                                   | No                                                       |
| Cycle detection                                   | Yes         | Yes                                                                  | Yes                                                      |
| Parameterized presets                             | Yes         | Flat config                                                          | No                                                       |
| Baseline / gradual adoption                       | Yes         | No                                                                   | No                                                       |
| GitHub PR annotations                             | Yes         | No                                                                   | No                                                       |
| Violation messages with fix suggestions           | Yes         | No                                                                   | No                                                       |
| `explain` command (dump rules as JSON for agents) | Yes         | No                                                                   | No                                                       |
| OO metrics (LCOM, coupling, instability)          | No          | No                                                                   | Yes                                                      |
| PlantUML diagram compliance                       | No          | No                                                                   | Yes                                                      |
| Dependency graph visualization                    | No          | Yes (dot, HTML)                                                      | No                                                       |
| License checking                                  | No          | Yes                                                                  | No                                                       |
| Nx monorepo support                               | No          | No                                                                   | Yes                                                      |

**Use ts-archunit** when you need to enforce what happens _inside_ functions — call patterns, error types, missing delegation, stub comments — and when AI agents are generating code that needs architectural guardrails. This is the only tool that catches "service calls parseInt instead of extractCount()".

**Use dependency-cruiser** when you only need import direction rules and want fast graph visualization, license compliance checking, or stability metrics. It's faster (no ts-morph project load) and has mature HTML/dot reporting.

**Use ArchUnitTS** when you need OO metrics (LCOM cohesion, coupling factor, distance from main sequence), PlantUML diagram validation, or Nx monorepo project-graph awareness.

**Use ts-archunit + dependency-cruiser together** if you want both body-level enforcement and dependency graph visualization.

## Install

```bash
npm install -D @nielspeter/ts-archunit
```

Requires Node.js >= 24 and a `tsconfig.json`. Works with vitest (recommended) or jest.

## License

MIT
