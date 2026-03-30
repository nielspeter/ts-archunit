# Plan 0043: Documentation, Explain Command, and Architecture Recipes

## Status

- **State:** COMPLETED 2026-03-30
- **Priority:** P1 — Features without docs don't exist
- **Effort:** 1 day
- **Created:** 2026-03-30
- **Depends on:** 0041 (Primitives), 0042 (Standard Rules), 0040 (Presets)

## Context

Plans 0041–0040 add significant new capabilities: phase-aware builders, module body analysis, export conditions, reverse dependency, dead code detection, function/module rule variants, presets, and aggregated error reporting. None of this is documented yet.

Additionally, 6 heuristic rules were deliberately removed from 0042 (`noDbCalls`, `noHttpCalls`, etc.) because they were too opinionated for the standard library. They are still useful as copy-paste recipes — documented examples, not shipped code.

Finally, the first evaluation surfaced a high-value feature: `ts-archunit explain` — dump all active rules as a structured JSON spec. This is small but high-impact for AI-assisted development and team onboarding.

## Phase 1: `ts-archunit explain` CLI subcommand (0.25 day)

### What it does

Runs the user's architecture test config in metadata-only mode. Collects all rule metadata (`id`, `because`, `suggestion`, `docs`) and outputs a structured JSON spec describing the project's architecture constraints.

```bash
$ npx ts-archunit explain

{
  "project": "tsconfig.json",
  "rules": [
    {
      "id": "preset/layered/layer-order",
      "description": "that reside in layer should respect layer order",
      "because": "Enforces clean architecture dependency flow",
      "suggestion": "Move logic to the appropriate layer instead of skipping layers",
      "severity": "error"
    },
    {
      "id": "preset/boundaries/no-cycles",
      "description": "that reside in boundary should be free of cycles",
      "because": "Cycles destroy modularity and make reasoning impossible",
      "severity": "error"
    }
  ],
  "generatedAt": "2026-03-30T12:00:00Z"
}
```

### Implementation

The existing CLI (`src/cli/`) already has `check` and `check --watch` subcommands with `defineConfig()` for configuration. Add `explain` as a new subcommand.

The mechanism uses the `.violations()` terminal from 0040, but in a different way: instead of collecting violations, it collects metadata from each rule builder before evaluation.

**Option A: Introspect rule builders.** Add a `.describe()` method to `RuleBuilder` and `TerminalBuilder` that returns `{ rule: string, description: string, because?: string, suggestion?: string, docs?: string, severity: 'error' | 'warn' }` without executing the rule. The `explain` command calls `.describe()` on each builder.

**Option B: Run rules, discard violations, keep metadata.** Run `.violations()` but only collect the metadata fields. Simpler but executes the full rule pipeline unnecessarily.

**Choose Option A** — it's cleaner and faster. The metadata is already stored on the builder (`_metadata`, `_reason`). No rule evaluation needed.

```ts
// src/core/rule-builder.ts
describe(): RuleDescription {
  return {
    rule: this.buildRuleDescription(),
    id: this._metadata?.id,
    because: this._reason,
    suggestion: this._metadata?.suggestion,
    docs: this._metadata?.docs,
  }
}
```

For presets, add a `{ explain: true }` option that returns descriptions instead of executing:

```ts
const descriptions = layeredArchitecture(p, {
  layers: { ... },
  explain: true,  // returns RuleDescription[] instead of executing
})
```

### CLI integration

```ts
// src/cli/explain.ts
export async function explain(configPath: string): Promise<void> {
  const config = await loadConfig(configPath)
  // Run config with explain: true on all presets
  // Collect descriptions from all rule builders
  // Output JSON to stdout
}
```

Add to the existing CLI binary:

```bash
npx ts-archunit explain                    # JSON to stdout
npx ts-archunit explain --config arch.ts   # custom config path
npx ts-archunit explain --markdown         # markdown table output
```

### Use cases

1. **AI system prompt injection:** Pipe the output into Claude Code's CLAUDE.md or as context
2. **Team onboarding:** New developer reads the explain output to understand architecture constraints
3. **CI audit:** Log the active rule set alongside test results
4. **Documentation generation:** Auto-generate a "Architecture Rules" page from the explain output

## Phase 2: VitePress documentation (0.5 day)

### New pages

| Page                   | Content                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/presets.md`      | Presets guide — `layeredArchitecture`, `dataLayerIsolation`, `strictBoundaries`. Configuration, overrides, `restrictedPackages`. When to use presets vs. custom rules.                                                                                                                                                      |
| `docs/module-rules.md` | Module body analysis — `modules().should().notContain()`, `scopeToModule` option. Export conditions — `notHaveDefaultExport()`, `haveMaxExports()`. Reverse dependency — `onlyBeImportedVia()`, `beImported()`, `haveNoUnusedExports()`. Comment matcher — `comment()`, `STUB_PATTERNS`. Empty body — `notHaveEmptyBody()`. |
| `docs/hygiene.md`      | Hygiene rules guide — `noDeadModules()`, `noUnusedExports()`, `noStubComments()`, `noEmptyBodies()`. False positive scenarios and mitigation. Recommended combinations.                                                                                                                                                     |
| `docs/recipes.md`      | Copy-paste architecture rule recipes (the 34 rules from evaluation, corrected for the real API). Organized by concern: layer enforcement, logic placement, boundary control, dead code, safety. Not shipped code — users copy and customize.                                                                                |
| `docs/explain.md`      | The `explain` command — usage, output format, integration with AI tools, CI usage.                                                                                                                                                                                                                                          |

### Updated pages

| Page                      | What changes                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/getting-started.md` | Add presets as the recommended starting point for new users. Show `layeredArchitecture` as the first example.                                          |
| `docs/rules.md`           | Add new standard rules: function/module variants of security rules, `mustCall`, `noDeadModules`, `noUnusedExports`, `noStubComments`, `noEmptyBodies`. |
| `docs/cli.md`             | Add `explain` subcommand documentation.                                                                                                                |
| `docs/api.md`             | New conditions, `.violations()` terminal, phase-aware builder methods. Note deprecated aliases.                                                        |

### Recipes page detail

The recipes page is the landing spot for the heuristic rules removed from 0042. Organized as copy-paste blocks with commentary on when they apply and how to customize:

```md
## Logic Placement

### No DB calls outside repositories

\`\`\`ts
// Customize the pattern for your ORM
const dbPattern = /prisma|knex|drizzle/

functions(p)
.that().resideInFolder('**/services/**')
.should().notContain(call(dbPattern))
.rule({ id: 'placement/no-db-in-services', because: '...' })
.check()
\`\`\`

> **Customize:** Replace the regex with your project's ORM. The pattern
> `/query|execute/` is too broad for most codebases — use specific package names.
```

Each recipe includes:

- The rule code
- Which pattern to customize and why
- Common false positives to watch for
- Which preset covers this automatically (if applicable)

## Phase 3: README update (0.25 day)

### Current README state

The README likely covers the basic API from the initial launch. It needs to showcase the library's full capabilities now that 39+ plans are shipped.

### Updated structure

```
# ts-archunit

Architecture testing for TypeScript. Encode your team's architecture rules
as executable tests. CI catches violations on the PR that introduces them.

## Quick Start (preset)
   → layeredArchitecture() example (3 lines)

## Quick Start (custom rules)
   → modules/classes/functions fluent API example

## What it catches
   → Layer violations, dependency cycles, logic placement, dead code,
     stubs/TODOs, empty functions, naming conventions, export hygiene
     — table with examples

## Features
   → Entry points (modules, classes, functions, types, calls, slices)
   → Body analysis (call, access, newExpr, expression, property)
   → Presets (layeredArchitecture, strictBoundaries, dataLayerIsolation)
   → Standard rules (security, errors, hygiene, metrics, naming)
   → Smell detection (duplicate bodies, inconsistent siblings)
   → Cross-layer validation
   → Baseline + diff-aware mode
   → CLI with watch mode and explain command
   → Output formats (terminal, JSON, GitHub annotations)

## Architecture Rules as AI Context
   → ts-archunit explain → pipe into AI tools
   → because/suggestion metadata → AI can self-correct

## Documentation
   → Link to VitePress site

## Install
```

### Key messaging changes

- **Lead with presets** — most users should start with `layeredArchitecture()`, not raw primitives
- **"Architecture testing" not "architecture linting"** — tests run in vitest/jest, not as a separate linter
- **AI integration angle** — the `explain` command and structured violation output are differentiators
- **Show the because/suggestion metadata** — this is what makes violations actionable

## Files

| File                           | Type                                   | Phase |
| ------------------------------ | -------------------------------------- | ----- |
| `src/cli/explain.ts`           | New — explain subcommand               | 1     |
| `src/cli/bin.ts`               | Modified — register explain subcommand | 1     |
| `src/core/rule-builder.ts`     | Modified — add `.describe()`           | 1     |
| `src/core/terminal-builder.ts` | Modified — add `.describe()`           | 1     |
| `docs/presets.md`              | New                                    | 2     |
| `docs/module-rules.md`         | New                                    | 2     |
| `docs/hygiene.md`              | New                                    | 2     |
| `docs/recipes.md`              | New                                    | 2     |
| `docs/explain.md`              | New                                    | 2     |
| `docs/getting-started.md`      | Modified                               | 2     |
| `docs/rules.md`                | Modified                               | 2     |
| `docs/cli.md`                  | Modified                               | 2     |
| `README.md`                    | Modified                               | 3     |
| `tests/cli/explain.test.ts`    | New                                    | 1     |

## Test strategy

### Explain command (~6 tests)

- Outputs valid JSON with rules array
- Each rule has id, description, because, suggestion fields
- Preset with `explain: true` returns descriptions without executing
- `--markdown` flag outputs table format
- Empty config produces empty rules array
- Rule count matches the number of rules in the config

### Docs

- Manual review — no automated tests for documentation content
- VitePress build must succeed (`npm run docs:build`)
- All code examples in docs must be valid TypeScript (verified by typecheck or manual review)

## Out of scope

- Interactive `explain` output (TUI, web UI) — JSON and markdown are sufficient
- Generating CLAUDE.md automatically from explain output — users pipe it themselves
- Translating docs to other languages
- Video tutorials or animated demos

## Verification

```bash
npm run test
npm run typecheck
npm run lint
npm run docs:build
```
