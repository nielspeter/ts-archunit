# How It Fits

ts-archunit is an **architecture** tester. It is **not** a linter or a formatter, and it does not replace one. It assumes you already run a linter (eslint or Biome) for per-file style and hygiene, and adds the layer above them: rules that are only definable across files, against your project's structure.

This page draws the line honestly — including where the tools genuinely overlap.

## The three layers

The durable distinction between these tools is not their rule inventory (which changes every release) — it's the **level at which each one analyzes your code**.

| Layer                   | Tools                    | Scope of analysis                                                                                                                         | Feedback loop               |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Formatter**           | Prettier, Biome (format) | Whitespace, quotes, layout — no semantics                                                                                                 | On save                     |
| **Single-file linter**  | eslint, Biome (lint)     | One file at a time: syntax patterns, style, unused vars, filename casing, some type-aware rules                                           | Author-time, in your editor |
| **Architecture tester** | **ts-archunit**          | The whole project: dependency graph, layer boundaries, body/content comparison, type-level relationships, element→location correspondence | CI-time                     |

Overlap between tools is normal — Biome is itself a re-implementation of eslint + Prettier, and nobody treats that as a defect. The point of this page is not "we do what they can't." It's to help you decide _which tool a given rule belongs in_.

## The one test that decides it

For any rule you want to enforce, ask:

> **Can this rule be decided by looking at a single file in isolation?**

- **Yes** → it belongs in your linter (eslint or Biome). It'll run in your editor, faster than any CI test.
- **No — it needs the dependency graph, the folder layout, or a relationship _between_ files** → it belongs in ts-archunit.

"This file must be kebab-case" is a one-file question → your linter. "A class that _extends `BaseRepository`_ must live in `**/repositories/**`" needs to know what the class extends _and_ where it sits → ts-archunit.

## The honest map (including the overlap)

The line isn't a clean partition — there's a genuinely shared middle. Pretending otherwise wouldn't help you choose.

| Clearly your linter's                                                | Shared / contested                                         | Clearly ts-archunit's                                                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filename casing, unused vars, style, per-file syntax bans, `no-eval` | Folder-scoped rule bans; **dependency & layer boundaries** | Cross-file body/content comparison (duplicate bodies, inconsistent siblings); type-level _relationships_; semantic element→location correspondence |

**On the contested middle — be deliberate, not accidental:**

- **Folder-scoped bans.** eslint flat config can already scope any rule to a folder (`files: ['src/domain/**']` + `no-restricted-syntax`). ts-archunit's version reads better and carries rationale, but the capability overlaps — don't reach for us _only_ to fold a rule to a folder.
- **Dependency & layer boundaries.** This is the real overlap. [`eslint-plugin-boundaries`](https://github.com/javierbrea/eslint-plugin-boundaries), `eslint-plugin-import`'s `no-restricted-paths`, and [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) all enforce "layer A must not import layer B." If one of those is working for your team, keep it. Reach for ts-archunit's boundary rules when you want them in the **same tested, baseline-able suite** as your body-level and type-level rules — architecture as one executable spec, with per-rule `.because()` rationale and gradual-adoption baselines — rather than scattered across linter config and a separate graph tool.

**Only ts-archunit** covers the right-hand column, because those need the whole-project graph _and_ semantic/type understanding at once:

- **Cross-file content comparison** — [duplicate function bodies](/smell-detection), "these sibling methods are inconsistent," empty stubs. Linters lint one file; they don't diff bodies across the project.
- **Type-level relationships** — "every type in this folder must extend `X`," structural assertions resolved through the type checker across files.
- **Semantic element→location correspondence** — gating a class's _location_ on what it _extends_ or _implements_, not on a name regex.

## Do I need a linter too?

**Yes.** ts-archunit does not replace one, and its built-in floor is not a substitute for `eslint:recommended` or Biome's defaults.

The [`recommended` preset](/presets) is a **deliberately tiny safety floor** — a handful of high-severity patterns (`no-eval`, `no-function-constructor`, and two warnings: silent catch, empty bodies) that are dangerous regardless of project shape and fire ~never on healthy code. Every one of them _also_ exists in a linter. Its value is not that it's unique or comprehensive — it's _where_ those checks live: gated in CI, baseline-able, and surfaced to AI agents via [`explain --format agent`](/ai-agents). It is a floor, not a baseline of basics.

So run both:

- **A linter** (eslint or Biome) for per-file hygiene — unused vars, undefined references, style, filename casing.
- **ts-archunit** for architecture — boundaries, body-level rules, type-level relationships, and cross-file consistency.

They compose cleanly and don't conflict. ts-archunit picks up exactly where a single-file linter's understanding ends.

## Filename conventions: a worked example

The two sides of the line, on one concern:

- **Filename _casing_** — "every file is kebab-case," "no `.spec.ts`." A one-file question → your linter. eslint (`eslint-plugin-unicorn`'s `filename-case`, `eslint-plugin-check-file`) and Biome (`useFilenamingConvention`, built in) both do this at author-time. ts-archunit deliberately does not.
- **Filename↔element _correspondence_** — "a class ending in `Controller` must live in a `*-controller.ts` file," "repositories belong in the repositories folder." This couples the _code element_ to its location, which needs semantic understanding of the element — and it's expressible today:

```typescript
// A controller must live in a *-controller.ts file — a linter can't express this
classes(p)
  .that()
  .haveNameEndingWith('Controller')
  .should()
  .resideInFile('**/*-controller.ts')
  .check()

// Repositories belong in the repositories folder, by what they extend — not by name
classes(p).that().extend('BaseRepository').should().resideInFolder('**/repositories/**').check()
```

For pure casing, use your linter. For "the file must match the thing it exports," use ts-archunit.
