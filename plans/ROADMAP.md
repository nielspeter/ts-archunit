# ts-archunit Development Roadmap

**Created:** 2026-03-25
**Updated:** 2026-03-26
**Spec:** `ts-archunit-spec.md`
**Total Plans:** 16 completed, ~9 remaining

---

## Priority Matrix

| Priority | Plan                                                                             | Effort    | Status               |
| -------- | -------------------------------------------------------------------------------- | --------- | -------------------- |
| **P0**   | ~~Project Bootstrap & Package Setup (0000)~~                                     | 2-3 hours | COMPLETED 2026-03-25 |
| **P0**   | ~~Exploratory PoC & Technical Validation (0001)~~                                | 0.5 day   | COMPLETED 2026-03-25 |
| **P0**   | ~~Project Loader & Query Engine (0002)~~                                         | 0.5 day   | COMPLETED 2026-03-25 |
| **P0**   | ~~Predicate Engine & Identity Predicates (0003)~~                                | 1 day     | COMPLETED 2026-03-25 |
| **P0**   | ~~Condition Engine & Structural Conditions (0004)~~                              | 1 day     | COMPLETED 2026-03-25 |
| **P0**   | ~~Fluent Rule Builder & `.check()` / `.warn()` (0005)~~                          | 1 day     | COMPLETED 2026-03-25 |
| **P1**   | ~~Violation Reporting & Code Frames (0006)~~                                     | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Module Entry Point & Dependency Conditions (0007)~~                            | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Class Entry Point & Class Predicates/Conditions (0008)~~                       | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Function Entry Point & Function Predicates (0009)~~                            | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Type Entry Point & Type-Level Conditions (0010)~~                              | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Body Analysis: `call()`, `access()`, `newExpr()`, `expression()` (0011)~~      | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Slice Entry Point & Cycle/Layer Conditions (0012)~~                            | 1 day     | COMPLETED 2026-03-26 |
| **P1**   | ~~Custom Predicates, Conditions & `definePredicate` / `defineCondition` (0013)~~ | 0.5 day   | COMPLETED 2026-03-26 |
| **P2**   | ~~Standard Rules Library (0024)~~                                                | 1 day     | COMPLETED 2026-03-26 |
| **P2**   | User Guide with VitePress (0023)                                                 | 1-2 days  | Not Started          |
| **P2**   | ~~Baseline Mode & Diff-Aware Mode (0016)~~                                       | 1 day     | COMPLETED 2026-03-26 |
| **P2**   | Output Formats: JSON, GitHub Annotations (0019)                                  | 1 day     | Not Started          |
| **P2**   | Call Entry Point & Call Predicates (0014)                                        | 2-3 days  | Not Started          |
| **P2**   | Named Selections, `within()` & Scoped Rules (0015)                               | 1-2 days  | Not Started          |
| **P3**   | Pattern Templates & `definePattern` / `followPattern` (0017)                     | 1-2 days  | Not Started          |
| **P3**   | Smell Detectors: Duplicate Bodies & Inconsistent Siblings (0018)                 | 2-3 days  | Not Started          |
| **P3**   | CLI Standalone Runner & Watch Mode (0020)                                        | 1-2 days  | Not Started          |
| **P3**   | GraphQL Extension: Schema & Resolver Rules (0021)                                | 3-5 days  | Not Started          |
| **P4**   | Cross-Layer Validation (0022)                                                    | 3-5 days  | Not Started          |

---

## Recommended Execution Order

### P0 + P1: Foundation + MVP (COMPLETED)

```
✅ 0000 → 0001 → 0002 → 0003 → 0004 → 0005 (foundation)
✅ 0006 → 0007-0013 (entry points + body analysis + slices + custom rules)
✅ 0024 (standard rules library)
```

MVP is live. 480 tests. 5 entry points, body analysis, type checking, cycle detection, 14 standard rules.

### P2: Adoption — get real users

Priority order: documentation first, then gradual adoption, then CI integration.

```
0023 - User Guide (can't adopt what you can't learn)
  └─► 0016 - Baseline Mode (teams adopt gradually in existing codebases)
        └─► 0019 - Output Formats (JSON for CI, GitHub annotations for PRs)
              └─► 0014 - Call Entry Point (framework-specific rules)
                    └─► 0015 - within() scoped rules (depends on 0014)
```

**Why this order:**

- **0023 first** — no docs = no users. The README is good for discovery, but a user guide is needed for adoption.
- **0016 second** — without baseline mode, teams can't turn on rules in existing codebases. "Fix 500 violations before your first rule works" kills adoption.
- **0019 third** — JSON output enables tooling integration. GitHub annotations make violations appear inline on PR diffs — this is the "wow" moment.
- **0014 + 0015 last in P2** — useful for framework-specific rules (Express routes, Fastify handlers), but `functions()` + naming predicates covers 80% of use cases already.

### P3: Nice-to-have features

```
0017 - Pattern Templates (defineCondition already covers this; sugar for common shapes)
0018 - Smell Detectors (advisory tools — duplicate bodies, inconsistent siblings)
0020 - CLI Standalone Runner & Watch Mode
0021 - GraphQL Extension
```

Build when users ask for them.

### P4: Research

```
0022 - Cross-Layer Validation (hardest extension, needs real-world validation)
```

---

## What's Shipped (v0.1.0)

Users can today:

- Load a TypeScript project via `project('tsconfig.json')`
- Write rules using `modules()`, `classes()`, `functions()`, `types()`, `slices()`
- Filter with identity predicates + type-specific predicates
- Assert dependency rules, structural rules, and body analysis rules
- Check property types through aliases, `Partial<>`, `Pick<>` via type matchers
- Detect cycles between feature modules and enforce layer ordering
- Get actionable violation reports with code frames and ANSI colors
- Define custom predicates and conditions with the same API as built-in ones
- Use 14 standard rules via `ts-archunit/rules/*` sub-path exports
- Run rules in vitest/jest with `.check()` and `.warn()`

**What's NOT shipped yet:**

- Baseline mode for gradual adoption in existing codebases
- JSON/GitHub output formats for CI integration
- `calls()` entry point for framework-agnostic route matching
- `within()` for scoping rules to specific contexts
- CLI standalone runner
- User guide / documentation site
