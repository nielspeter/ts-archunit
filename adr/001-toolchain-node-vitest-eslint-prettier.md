# ADR-001: Use Node.js + Vitest + ESLint + Prettier

## Status

**Accepted** (March 2026)

## Context

ts-archunit is a TypeScript architecture testing library built on ts-morph (which wraps the TypeScript compiler API). We need to choose:

1. **Runtime**: Node.js vs Bun vs Deno
2. **Test runner**: Vitest vs Jest
3. **Linting**: ESLint vs Biome
4. **Formatting**: Prettier vs Biome
5. **Build tool**: Vite (via vitest) vs tsc-only

The library's core dependency — ts-morph — calls `ts.createProgram()` and uses the full TypeScript compiler internally. This constrains the runtime choice: compatibility with the TypeScript compiler API is non-negotiable.

## Decision

**We will use Node.js + Vitest + ESLint + Prettier.**

```json
{
  "devDependencies": {
    "typescript": "~5.9.3",
    "vitest": "^4.1",
    "eslint": "^10.1",
    "prettier": "^3.8",
    "typescript-eslint": "^8.57",
    "@eslint/js": "^10.1",
    "eslint-config-prettier": "^10.1"
  },
  "dependencies": {
    "ts-morph": "^27.0",
    "picomatch": "^4.0"
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

**Note:** Using `typescript-eslint` unified package (not separate `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser`). The unified package is the recommended approach since v8.

TypeScript strict mode with type checking in CI:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "outDir": "dist"
  }
}
```

## Consequences

### Positive

**Node.js runtime:**

- ts-morph is built for Node.js — zero compatibility risk
- ts-morph uses `ts.createProgram()`, `ts.createLanguageService()`, and Node.js `fs` APIs internally
- Same runtime as the target audience (TypeScript developers running vitest/jest)
- npm ecosystem — the library ships as an npm package

**Vitest over Jest:**

- Native ESM support — no `ts-jest` transformer needed
- Built on Vite — fast startup, native TypeScript
- Same assertion API as Jest (easy migration)
- ts-archunit's spec prescribes vitest as the primary integration target
- Watch mode with HMR for fast feedback during development

**ESLint over Biome:**

- `@typescript-eslint` provides type-aware linting rules
- Mature ecosystem — more rules, more plugins
- Industry standard for TypeScript projects
- Biome's TS support is improving but not yet at parity for type-aware rules

**Prettier for formatting:**

- Zero-config opinionated formatting
- Integrates with ESLint via `eslint-config-prettier`
- Industry standard — contributors know it

### Negative

**Node.js:**

- Slower startup than Bun — irrelevant for a library (users run it in their own test suite)
- No built-in TypeScript execution — mitigated by vitest handling TS natively

**Vitest:**

- Less mature than Jest — mitigated by Vite ecosystem stability
- Some Jest plugins don't work — we don't need any

**ESLint + Prettier (two tools):**

- Biome could replace both — but Biome's TypeScript type-aware rules are not mature enough
- Slightly more config files — acceptable tradeoff for rule quality

## Alternatives Considered

### Alternative 1: Bun

**Pros:**

- Faster startup and npm install
- Built-in TypeScript execution
- Built-in test runner

**Cons:**

- ts-morph uses Node.js `fs` and `path` APIs extensively — Bun compatibility is "mostly works" not "guaranteed"
- ts-morph calls `ts.createProgram()` which uses the TypeScript compiler's internal file resolution — untested on Bun's module system
- Bun's test runner is less mature than vitest
- Users of ts-archunit run it in Node.js (vitest/jest) — testing on Bun doesn't validate the real environment

**Rejected because:** ts-morph's deep integration with the TypeScript compiler API makes Bun a risk surface with zero benefit. The library runs in the user's test suite, not as a standalone binary — Bun's startup speed is irrelevant.

### Alternative 2: Deno

**Pros:**

- Built-in TypeScript
- Security sandbox
- Modern runtime

**Cons:**

- ts-morph doesn't support Deno
- npm compatibility layer adds friction
- Target audience uses Node.js

**Rejected because:** ts-morph is a Node.js library. Deno support would require a fork or compatibility shim.

### Alternative 3: Jest

**Pros:**

- Most widely used test runner
- Mature, stable

**Cons:**

- Requires `ts-jest` or SWC transformer for TypeScript
- ESM support still experimental (--experimental-vm-modules)
- Slower than Vitest for TypeScript projects
- More configuration needed

**Rejected because:** Vitest handles TypeScript natively and is faster. The spec targets vitest as the primary integration. Jest compatibility is maintained because ts-archunit's `.check()` throws standard errors — it works in any test runner.

### Alternative 4: Biome (replacing ESLint + Prettier)

**Pros:**

- Single tool for linting + formatting
- Faster than ESLint
- Zero config

**Cons:**

- No type-aware linting rules (can't use TypeScript type checker for lint rules)
- Smaller rule set than `@typescript-eslint`
- Rapidly evolving — more breaking changes

**Rejected because:** Type-aware linting rules from `@typescript-eslint` are valuable for a library that wraps the TypeScript compiler. Biome may be reconsidered when its TypeScript support matures.

## Notes

- ts-archunit ships as an npm package with `"type": "module"` (ESM)
- Node.js >= 24 (LTS, consistent with cmless project)
- The library has two peer dependencies: vitest or jest (users choose)
- TypeScript ~5.9 (pinned to ts-morph compatibility) with `strict: true` + `noUncheckedIndexedAccess: true` from day one
- ESLint 10 flat config (`eslint.config.ts`) with `typescript-eslint` v8 unified package and `recommendedTypeChecked`
- CI runs: `tsc --noEmit` (type check) + `eslint` (lint) + `vitest` (test) + `prettier --check` (format)
