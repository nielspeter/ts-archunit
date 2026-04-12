# Proposal 003 — noDeadModules() Should Skip .d.ts Files by Default

**Status:** Closed — docs-only (use `.excluding()` recipe)
**Closed:** 2026-04-12
**Reason:** The workaround `.excluding(/\.d\.ts$/)` is one line and composes
with everything. Pushing `.d.ts` filtering into `beImported()` is the wrong
layer — `beImported()` is a generic condition ("module must be imported"),
not an opinionated wrapper. Adding `BeImportedOptions` starts a per-condition
options pattern that doesn't exist today and would pressure every other
condition to add its own options type. The correct fix is a docs recipe
showing the one-liner exclusion.

**Priority:** ~~Medium~~ N/A
**Affects:** `noDeadModules()` / `beImported()` in `conditions/reverse-dependency`

## Problem

Ambient type declaration files (`.d.ts`) are included in the project via
tsconfig's `include` glob, not via `import` statements. They provide
global type augmentations (e.g., `declare module 'fastify' { ... }`,
`declare global { ... }`, or `/// <reference types="vite/client" />`).
Nothing imports them — that's by design.

`noDeadModules()` flags these as "not imported by any other module"
because it only checks import declarations. Every TypeScript project with
ambient declarations hits this false positive.

## Evidence

Common `.d.ts` files that trigger false positives:

- `src/types/env.d.ts` — environment variable augmentations
- `src/types/global.d.ts` — global type extensions
- `src/vite-env.d.ts` — Vite client types
- `src/types/*.d.ts` — framework type augmentations (Express, Fastify, etc.)

Any project using framework type augmentations or global declarations
will see these false positives.

## Proposed Fix

Add an options parameter to `beImported()` (the underlying condition in
`src/conditions/reverse-dependency.ts`) and have `noDeadModules()` pass
it through:

```ts
// conditions/reverse-dependency.ts
interface BeImportedOptions {
  /** Include .d.ts files in dead-module detection. Default: false. */
  includeDts?: boolean
}

export function beImported(options?: BeImportedOptions): Condition<SourceFile> {
  // ...
  if (!options?.includeDts && sf.getFilePath().endsWith('.d.ts')) {
    continue // ambient declarations are loaded via tsconfig include
  }
}

// rules/hygiene.ts
export function noDeadModules(options?: BeImportedOptions): Condition<SourceFile> {
  return beImported(options)
}
```

Options live on `beImported()` (the condition), not only on the
`noDeadModules()` wrapper, so the layering is consistent — users who
call `beImported()` directly get the same options.

Users who want to check `.d.ts` files can opt in:

```ts
modules(p)
  .should()
  .satisfy(noDeadModules({ includeDts: true }))
```

## Workaround

```ts
modules(p)
  .should()
  .satisfy(noDeadModules())
  .excluding(/\.d\.ts$/)
  .check()
```

Works but produces "Unused exclusion" warnings in workspaces that don't
have any `.d.ts` files (see Proposal 006).

## Backwards Compatibility

The no-arg call `noDeadModules()` changes behavior — `.d.ts` files are
no longer flagged. This is in the "fewer false positives" direction and
is unlikely to break anyone's tests (nobody wants `.d.ts` files flagged
as dead). The opt-in `{ includeDts: true }` preserves the old behavior
for anyone who needs it.
