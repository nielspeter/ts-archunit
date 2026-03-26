# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ts-archunit is an architecture testing library for TypeScript, inspired by Java's ArchUnit. It lets teams encode architectural rules as executable tests using a fluent DSL, powered by ts-morph. Rules run in vitest/jest — CI catches violations on the PR that introduces them.

**Spec:** `ts-archunit-spec.md` is the design specification. All implementation must align with it.

**Origin:** This project was motivated by real architecture rot in the cmless headless CMS project, documented in `cmless/plans/0212-sdk-list-endpoint-standardization.md`. The spec's Section 1.1 code examples are based on real cmless patterns (copy-pasted parsers, inconsistent pagination, inline parseInt, untyped orderBy).

## Architecture Decision Records (ADRs)

**CRITICAL:** All architectural decisions are documented in `/adr/`. These decisions are **binding** and must be followed in all plans and code. Read relevant ADRs before implementing features.

| ADR                                                       | Title         | Key Takeaway                                                                                       |
| --------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| [001](./adr/001-toolchain-node-vitest-eslint-prettier.md) | Toolchain     | Node 24 + TS ~5.9 (pinned to ts-morph) + Vitest 4 + ESLint 10 + Prettier 3.8. No Bun.              |
| [002](./adr/002-ts-morph-ast-engine.md)                   | AST Engine    | ts-morph 27 for all AST and type checking. No tree-sitter/SWC/raw TS API.                          |
| [003](./adr/003-fluent-builder-dsl.md)                    | DSL Pattern   | Fluent builder with method chaining. `entry(p).that().<predicate>.should().<condition>.check()`    |
| [004](./adr/004-esm-only-package.md)                      | Module Format | ESM only. `"type": "module"`, Node.js >=24. No dual CJS/ESM.                                       |
| [005](./adr/005-no-any-no-type-assertions.md)             | Type Safety   | No `any`, no `as` casts. Use ts-morph type guards. Only `eslint-disable` at JS interop boundaries. |
| [006](./adr/006-framework-rules-architecture.md)          | Framework Rules | Rules are code, not config. Separate npm packages per framework. Presets are functions. |

## IMPORTANT: ADR Compliance

**Before writing ANY code or plan, check the ADRs.** Every ADR is binding. Specifically:

- **ADR-005 (Type Safety):** Never use `any`. Never use `as` type assertions. Use ts-morph `Node.isClassDeclaration()` etc. for type narrowing. Use explicit type annotations instead of `as` on literals. Only `eslint-disable` at unavoidable JS interop boundaries (with explanation).
- Reference ADRs by number when making design decisions in plans or code comments.

## Plans

Implementation plans are in `/plans/`. Completed plans move to `/plans/completed/`. The roadmap is `/plans/ROADMAP.md`.

Plans follow a specific format: Status/Priority/Effort header, Problem section, phased implementation with real code examples, Files Changed per phase, Test inventory, Out of Scope section. See existing plans for examples.

## Key Implementation Rules

From the ADRs:

- **TypeScript strict mode** with `noUncheckedIndexedAccess: true` (ADR-001)
- **ESM only** — `"type": "module"`, `module: "Node16"`, `moduleResolution: "Node16"` (ADR-004)
- **ts-morph for all AST operations** — never use raw `typescript` compiler API directly (ADR-002)
- **Fluent builder pattern** — rules read like English: `.that().extend('X').should().notContain(call('Y')).check()` (ADR-003)
- **Vitest for tests** — fixture-based, no mocking of ts-morph (spec Section 14.2)
- **No `any`, no `as` type assertions** — use ts-morph type guards (`Node.isClassDeclaration()` etc.) for narrowing, explicit type annotations instead of `as` on literals. Only `eslint-disable` at unavoidable JS interop boundaries with explanation. (ADR-005)

## Dependencies

| Package                | Purpose                                                | Required in    |
| ---------------------- | ------------------------------------------------------ | -------------- |
| `ts-morph` ^27         | TypeScript AST analysis, type checker                  | Core           |
| `picomatch` ^4         | Glob pattern matching                                  | Core           |
| `vitest` ^4            | Test runner                                            | Dev / peer dep |
| `typescript` ~5.9      | Type checking, compilation (pinned to ts-morph compat) | Dev            |
| `eslint` ^10           | Linting (flat config, `eslint.config.ts`)              | Dev            |
| `typescript-eslint` ^8 | Type-checked ESLint rules (unified package)            | Dev            |
| `prettier` ^3.8        | Formatting                                             | Dev            |

No runtime dependencies beyond ts-morph and picomatch. The tool is a dev dependency.

## Project Structure (target)

```
ts-archunit/
├── adr/                    # Architecture Decision Records
├── plans/                  # Implementation plans
│   └── completed/          # Completed plans
├── src/
│   ├── core/               # project loader, query engine, rule builder, predicate/condition interfaces
│   ├── builders/           # entry-point-specific rule builders (class, function, type, module, call, slice)
│   ├── predicates/         # predicate implementations per entry point
│   ├── conditions/         # condition implementations (structural, dependency, body analysis, type-level, slice)
│   ├── helpers/            # call(), access(), newExpr(), expression(), type matchers, within(), baseline
│   ├── smells/             # built-in smell detectors (duplicate bodies, inconsistent siblings)
│   └── index.ts            # public API
├── graphql/                # GraphQL extension (Phase 3, separate entry point)
├── tests/
│   ├── fixtures/           # small TypeScript fixture files for testing
│   ├── predicates/         # predicate unit tests
│   ├── conditions/         # condition unit tests
│   └── integration/        # end-to-end rule chain tests
├── ts-archunit-spec.md     # design specification
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

## Common Commands

```bash
npm run test          # run vitest
npm run lint          # eslint
npm run format        # prettier --write
npm run typecheck     # tsc --noEmit
npm run build         # tsc (emit to dist/)
```

## Commit Messages

- Use conventional commits (feat:, fix:, refactor:, test:, docs:, chore:)
- First line under 72 characters
- No AI attribution in commits or PRs
