# ADR-007: Isolate the AST Engine Behind a Thin Boundary

## Status

**Proposed** (July 2026)

Amends the Notes section of [ADR-002](./002-ts-morph-ast-engine.md), which flagged: _"If TS7 breaks ts-morph compatibility, this ADR should be revisited."_ This ADR is that revisit. ADR-002 stands — ts-morph remains our engine **today**. This ADR governs how the rest of the codebase is allowed to _touch_ it.

## Context

ADR-002 chose ts-morph as our sole AST and type-checking engine. That decision is sound today. But research in mid-2026 surfaced a concrete, dependency-level risk that ADR-002 could not have priced in:

1. **The engine underneath ts-morph is being replaced.** Microsoft's native TypeScript compiler ("Corsa" / TypeScript 7, Go-based, ~10x faster) reached RC in June 2026. It **does not support the existing (Strada) compiler API** that ts-morph is built on. The stable programmatic API is deferred to TypeScript 7.1.

2. **ts-morph's own maintainer is not confident it survives the transition.** From [dsherret/ts-morph#1621](https://github.com/dsherret/ts-morph/issues/1621): _"I don't think ts-morph will continue to exist because the API sounds like it will be limited and require IPC … it would be a massive task that I don't have the bandwidth to take on."_ The problem is architectural: the Go compiler runs out-of-process, so every call crosses an IPC boundary with a fixed toll. ts-morph's design — millions of small, lazy, per-node calls — is the worst possible access pattern for that boundary. The 10x compiler speedup gets eaten by boundary latency, and ts-morph loses browser support (no in-process subprocess).

3. **A native rewrite is not an escape hatch.** Rewriting ts-archunit in Go to link the compiler in-process is blocked: the compiler's AST/binder/checker live under Go `internal/` packages, which the language forbids external modules from importing, and Microsoft has said a public embeddable Go API is _"on the unlikely side"_ ([typescript-go#481](https://github.com/microsoft/typescript-go/discussions/481)). It would also break the product's identity — architecture rules that run as **TypeScript tests in vitest/jest** (spec §14.2). This is not a language problem; it is an access-pattern problem.

4. **The tools that survive share one trait.** typescript-eslint, Volar, and Deno all consume the compiler as a **coarse-grained, batched service**, not a chatty per-node API. typescript-eslint extracted this into a standalone [`@typescript-eslint/project-service`](https://typescript-eslint.io/blog/project-service/) package, explicitly _"usable for any linter."_ The consumers at risk are the chatty ones (ts-morph). The lesson is not "pick a faster language" — it is "talk to the engine in bulk, and don't let the engine's shape leak into your codebase."

Today, ts-morph types (`ClassDeclaration`, `Node`, `Type`, `SourceFile`) flow directly through predicates, conditions, builders, and helpers. **The entire codebase is coupled to a dependency whose maintainer doubts its future.** If ts-morph is deprecated or becomes unacceptably slow post-TS-7, migration would be a rewrite touching every module — under duress, on someone else's timeline.

## Decision

**We will confine all ts-morph access behind a single internal engine boundary, and design that boundary to be batch-first (engine-neutral, coarse-grained), so the engine is swappable without touching the DSL, predicates, or conditions.**

Two rules, both binding:

### Rule 1 — Confinement: one module owns ts-morph

All `import … from 'ts-morph'` statements live in a single adapter layer (`src/core/engine/`). No predicate, condition, builder, helper, or smell detector imports ts-morph directly. They import ts-archunit's **own** engine-neutral types.

```typescript
// src/core/engine/types.ts — ts-archunit's own vocabulary, no ts-morph leakage
export interface EngineClass {
  readonly name: string | undefined
  readonly filePath: string
  readonly startLine: number
  extendsName(): string | undefined
  methods(): readonly EngineMethod[]
}

export interface Engine {
  loadFromTsConfig(path: string): void
  classes(): readonly EngineClass[]
  // ... the operations ts-archunit actually needs, and only those
}
```

```typescript
// src/core/engine/ts-morph-engine.ts — THE ONLY place ts-morph is imported
import { Project, SyntaxKind, Node } from 'ts-morph'
import type { Engine, EngineClass } from './types.js'

export class TsMorphEngine implements Engine {
  // wraps ts-morph; nothing outside this file knows ts-morph exists
}
```

```typescript
// src/predicates/extends.ts — talks to the boundary, never to ts-morph
import type { EngineClass } from '../core/engine/types.js'

export const extendsClass =
  (name: string) =>
  (cls: EngineClass): boolean =>
    cls.extendsName() === name
```

### Rule 2 — Batch-first: the boundary assumes calls are expensive

The engine interface exposes **coarse-grained, collected results** ("give me all classes matching X"), not live lazy node handles that callers walk chattily. Predicates and conditions receive already-materialized data, not cursors into a live AST.

This is the non-negotiable design lesson from the ts-morph/Corsa problem: a boundary that leaks the per-node chatty pattern (`cls.getMethods()[0].getBody().getDescendants()…`) does **not** survive migration to an out-of-process or batched engine — it just relocates the coupling. The interface must be shaped so that a future implementation could satisfy it by crossing a process boundary **once** and returning a bulk result, exactly as `@typescript-eslint/project-service` does.

We build the **seam**, not a second engine. There is only one implementation (`TsMorphEngine`) until a viable alternative API actually exists. This ADR is about isolation, not premature abstraction.

### Enforcement (dogfooding)

The confinement rule is itself an architecture rule — so **ts-archunit enforces it on ts-archunit**. A rule in our own test suite asserts that no file outside `src/core/engine/` imports `ts-morph`:

```typescript
entry(project)
  .that()
  .resideOutsideFolder('src/core/engine')
  .should()
  .notDependOn('ts-morph')
  .check()
```

This is both a correctness guarantee and a first-class example for our docs.

## Consequences

### Positive

- **Migration becomes a contained swap, not a rewrite.** When a viable engine appears (Corsa-native wrapper, a Wasm build, a batched service, or ts-morph itself adapting), we implement one new class behind `Engine`. The DSL, predicates, conditions, ADR-003, and users' rule files are untouched.
- **Insurance against a maintainer-acknowledged risk.** We stop being one dependency-deprecation away from a full rewrite.
- **The batch-first shape is portable by construction.** Designed against the exact pattern (out-of-process, pay-per-crossing) that TS 7 introduces — so we align with the surviving-tools camp (typescript-eslint, Volar) rather than the at-risk camp.
- **Dogfooding.** The boundary is enforced by ts-archunit's own rules — proof the tool works, and a canonical `notDependOn` example.
- **Clearer internal contract.** The `Engine` interface documents exactly which compiler capabilities ts-archunit actually depends on — a much smaller surface than "all of ts-morph."

### Negative

- **Up-front cost.** Introducing the boundary means wrapping the ts-morph operations currently used inline, and refactoring predicates/conditions to the neutral types. This is real work with no immediate user-visible benefit.
- **Leaky-abstraction risk.** ts-morph's API is large. Some conveniences (precise source positions for code frames, on-demand type-checker queries per spec §13.3) must be represented in the neutral interface without simply re-exporting ts-morph types. Getting the type-checker surface (`isString()`, `isUnionOfLiterals()`, structural matching) engine-neutral is the hard part.
- **Indirection tax.** One more layer between a predicate and the AST. Mitigated by keeping the interface thin and the wrapper dumb.
- **Guardrail against convenience.** Contributors will occasionally want to reach for a ts-morph method directly. The dogfooded rule blocks it, which is the point, but it adds friction.

## Alternatives Considered

### Alternative 1: Do nothing — keep ts-morph types throughout (status quo)

Let ts-morph types flow through the whole codebase, as today.

**Rejected because:** it leaves every module coupled to a dependency whose maintainer publicly doubts its post-TS-7 survival. If that risk materializes, migration is a rewrite of predicates, conditions, builders, and helpers simultaneously — the exact situation ADR-002's Notes told us to avoid.

### Alternative 2: Rewrite the engine natively in Go now

Reimplement ts-archunit in Go to link the compiler in-process, eliminating the IPC boundary.

**Rejected because:** there is nothing to link against — the Go compiler's checker is in `internal/` packages (language-forbidden to import) and Microsoft is unlikely to ship a public embeddable Go API. It would also destroy the product's core model (rules as TypeScript tests in vitest/jest, spec §14.2) and every language-dependent ADR (001, 003, 005). This is a different product, not a migration.

### Alternative 3: Full engine-agnostic abstraction with multiple engines maintained now

Build the boundary _and_ a second implementation (e.g., raw compiler API, or a stub) immediately to "prove" swappability.

**Rejected because:** YAGNI. No viable alternative engine exists yet (the stable API lands earliest in TS 7.1). Maintaining a second implementation against a hypothetical is pure cost. We build the seam and one implementation; the second arrives only when a real target does.

### Alternative 4: Confinement only, keep the chatty per-node API

Introduce the boundary (Rule 1) but let it expose live lazy node handles that callers walk node-by-node (skip Rule 2).

**Rejected because:** it relocates the coupling instead of removing it. A boundary that leaks the chatty access pattern still cannot be satisfied by an out-of-process or batched engine — the very failure mode that breaks ts-morph on Corsa. The batch-first shape (Rule 2) is what makes the seam actually portable; without it, the boundary is cosmetic.

## Notes

- **This does not deprecate ts-morph.** Per ADR-002, ts-morph is our engine today and `TsMorphEngine` is the only implementation. This ADR governs coupling, not engine choice.
- **Signals that should trigger implementing a second engine** (watch, in order): (a) the TypeScript **7.1** public API ships; (b) ts-morph — or anyone — announces a Corsa-backed build; (c) a Wasm build of the Go compiler appears (preserves in-process speed _and_ browser support); (d) `@typescript-eslint/project-service` or Volar factor out a reusable batched compiler-access layer we could sit on.
- **Scope of first implementation:** define `Engine` from the operations the current predicates/conditions already use — do not speculatively add methods. Grow the interface as rules need it.
- **Relationship to ADR-006:** framework rule packages consume ts-archunit's public API, not the engine, so they are unaffected by an engine swap — another reason the boundary belongs here, in core.
- Research backing this ADR (July 2026): [ts-morph#1621](https://github.com/dsherret/ts-morph/issues/1621), [typescript-go#455](https://github.com/microsoft/typescript-go/discussions/455), [typescript-go#481](https://github.com/microsoft/typescript-go/discussions/481), [typescript-eslint Project Service](https://typescript-eslint.io/blog/project-service/).
