# ADR-006: Framework Rules Architecture

## Status

**Accepted** (March 2026)

## Context

ts-archunit needs a strategy for framework-specific rules (Fastify, Drizzle, Express, NestJS, etc.). These rules are the highest-value rules for real projects but shouldn't bloat the core package.

We researched how 5 tools handle this: dependency-cruiser (JSON config + extends), ArchUnit (static Java fields in utility classes), Nx (single parameterized ESLint rule), CodeQL (query packs + suites), Biome (built-in domains with recommended/all presets).

## Decision

**Rules are code, not config. Follow the ArchUnit model.**

### Three tiers

| Tier            | Where                           | Example                                        |
| --------------- | ------------------------------- | ---------------------------------------------- |
| Core primitives | `ts-archunit`                   | `call()`, `newExpr()`, `notImportFrom()`       |
| Standard rules  | `ts-archunit/rules/*` sub-paths | `noAnyProperties()`, `noEval()`                |
| Framework rules | Separate npm packages           | `@ts-archunit/fastify`, `@ts-archunit/drizzle` |

### Individual rules are configurable factory functions

```typescript
export function routesMustHaveSchema(options?: {
  exclude?: string[]
  methods?: string[]
}): Condition<ClassDeclaration>
```

Sensible defaults, users override via options object. Backward compatible — zero-arg call uses defaults.

### Framework packages export thematic modules

```
@ts-archunit/fastify
  rules/routes.ts      — routesMustHaveSchema(), routesMustHaveAuth()
  rules/plugins.ts     — pluginsMustBeEncapsulated()
  predicates/fastify.ts — isRouteHandler(), isFastifyPlugin()
  presets/recommended.ts
  index.ts
```

### Presets are functions, not config

```typescript
export function recommended(
  p: ArchProject,
  options?: {
    overrides?: Record<string, 'error' | 'warn' | 'off'>
  },
): void
```

A preset runs a curated set of rules. Users override individual rule severity via options. No JSON config layer — TypeScript imports are the composition mechanism.

### Rules prove themselves in real projects first

1. Write rules in the consuming project using `definePredicate`/`defineCondition`
2. If a rule is general enough → extract to the framework package
3. Never add a rule to a framework package without real-world validation

## Consequences

### Positive

- **No new architecture needed** — existing `Condition<T>` factory pattern handles everything
- **TypeScript imports are composition** — autocomplete, type checking, tree-shaking all work
- **Framework packages are independently versioned** — Fastify updates don't require ts-archunit core updates
- **Users only install what they need** — no bloat from unused frameworks
- **Community can contribute packages** without touching core

### Negative

- **No centralized config file** — users can't toggle rules in a JSON file like ESLint. They write TypeScript test files instead.
  - Mitigation: This is a feature, not a bug. Test files are more powerful, type-checked, and version-controlled.
- **Discovery requires documentation** — users can't browse rules in a config UI
  - Mitigation: Good README per package + the user guide

## Alternatives Rejected

- **JSON config with extends** (dependency-cruiser model) — fights the grain of ts-archunit's function-based API. Rules are TypeScript functions, not JSON objects.
- **Built-in domains** (Biome model) — requires baking framework knowledge into core. Biome can do this because rules are in the binary. Our rules are user-authored code.
- **Tag-based constraints** (Nx model) — too narrow, only solves module boundaries. ts-archunit's existing `modules().should().onlyImportFrom()` is more expressive.
- **Pack registry** (CodeQL model) — overkill for npm packages. TypeScript compiles with the user's project; npm is the natural distribution channel.

## Notes

- Standard rules in `ts-archunit/rules/*` follow the same pattern — they're just framework-agnostic
- The cmless project is the first real-world validation ground for Fastify-specific rules
- Framework packages declare their framework as a peer dependency
