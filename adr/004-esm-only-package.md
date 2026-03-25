# ADR-004: ESM-Only Package

## Status

**Accepted** (March 2026)

## Context

npm packages can ship as:
1. **CommonJS only** (`require()`)
2. **ESM only** (`import`)
3. **Dual CJS/ESM** (both formats via conditional exports)

ts-archunit is a dev dependency that runs in test suites (vitest, jest). The choice affects:
- How users import the library
- Build complexity
- Compatibility with test runners
- Future-proofing

## Decision

**We will ship as ESM only.**

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "engines": {
    "node": ">=24.0.0"
  }
}
```

tsconfig:
```json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022"
  }
}
```

## Consequences

### Positive

- **No dual-build complexity** — one output format, one tsconfig, no CJS/ESM interop issues
- **Vitest is ESM-native** — the primary integration target works perfectly
- **Node.js 20+ has stable ESM** — no `--experimental-modules` flags needed
- **ts-morph ships as ESM** — no CJS interop needed for our core dependency
- **Future-proof** — CJS is legacy, ESM is the standard
- **Simpler package.json** — no conditional exports dance

### Negative

- **Jest CJS projects need configuration** — Jest users with `"type": "commonjs"` must configure `transformIgnorePatterns` or use `--experimental-vm-modules`
- Mitigation: Jest 30+ improves ESM support. Document the required Jest config in README.
- **Older Node.js excluded** — Node 20/22 work but we target Node 24 LTS
- Mitigation: Node 24 is the current LTS. `"engines": ">=24"` is reasonable for a 2026 library.

## Alternatives Considered

### Alternative 1: Dual CJS/ESM

**Pros:**
- Maximum compatibility — works everywhere

**Cons:**
- Dual package hazard — CJS and ESM versions can be loaded simultaneously, causing singleton issues
- Complex build (two tsconfig files or bundler)
- More surface area for bugs
- ts-morph itself is ESM-only since v21

**Rejected because:** The complexity is not justified. Our target audience (TypeScript projects using vitest/jest in 2026) supports ESM.

### Alternative 2: CJS only

**Rejected because:** CJS is legacy. ts-morph is ESM. Vitest is ESM. Swimming against the current.

## Notes

- The `graphql` extension (Phase 3) ships as a separate entry point: `ts-archunit/graphql` — also ESM
- Users of `require()` can use dynamic `import()` as an escape hatch
