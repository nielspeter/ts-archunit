# Setup & Best Practices

How to roll ts-archunit out on a real project without drowning in violations or fighting the tool. The short version: start with a thin floor, add shape-specific rules gradually, baseline before you gate CI, and save project-specific custom rules for last.

## The adoption ladder

Add rules in this order. Each rung is safe to stop on.

1. **Floor** — `npx ts-archunit init` gives you [`recommended`](/presets#recommended): a handful of universally-dangerous checks that fire on almost no healthy code. This is your green baseline.
2. **Shape** — add a [preset](/presets) that matches your architecture: `layeredArchitecture` for layers, `strictBoundaries` for feature modules, `dataLayerIsolation` for the repository pattern. One function call, several coordinated rules.
3. **Baseline** — on an existing codebase, run `npm run arch:baseline` and commit `arch-baseline.json` so only _new_ violations fail. See [Adopting on existing code](#adopting-on-an-existing-codebase).
4. **CI** — wire `npx ts-archunit check --format github` into your PR pipeline (see [Getting Started](/getting-started)). Only gate CI _after_ the baseline is committed.
5. **Custom rules — last** — encode the conventions specific to your team with [`definePredicate` / `defineCondition`](/custom-rules). These are the highest-value rules, but they're also the ones only you can write, so add them once the scaffolding is stable.

## Severity: error vs warn

Every rule is an **error** by default — a violation fails the run (and CI). Mark a rule as a non-failing **warning** with the non-terminal `.asSeverity('warn')`:

```typescript
export default [
  ...recommended(p),
  functions(p)
    .that()
    .resideInFile('**/src/**')
    .should()
    .satisfy(noEmptyBodies())
    .asSeverity('warn'),
]
```

`check` exits non-zero only when there are **error**-severity violations; warnings are reported but never fail the build. Use `warn` for rules with legitimate exceptions (best-effort cleanup, no-op callbacks) or for a rule you're rolling out gradually before promoting it to `error`.

## Enforce your compiler options upstream

Every code-level rule assumes your TypeScript strict flags are on. Nothing stops a teammate from flipping `strict: false` to make `tsc` green — your rules keep passing because they inspect code `tsc` already let slide. Close that hole with [`tsconfig()`](/config-rules):

```typescript
export default [
  tsconfig(p).requires({ strict: true, noUncheckedIndexedAccess: true }),
  ...recommended(p),
]
```

## Adopting on an existing codebase

The empty baseline that `init` creates does **not** protect the first run — it's a placeholder. `recommended` ships error rules (`no-eval`, `no-function-constructor`) that will fail on legacy code. So on any non-trivial existing project:

```bash
npm run arch:baseline   # snapshot current violations as accepted legacy debt
git add arch-baseline.json && git commit
# only NOW gate CI on `npm run arch`
```

As you fix legacy violations, regenerate the baseline to ratchet down — it can only shrink. Baseline identity is content-based and path-relative, so it's stable across machines and CI checkouts.

## Suppressing individual violations

Baseline is for _"accept this legacy debt for now."_ For a _permanent, intentional_ exception, use `.excluding()` on the rule itself — and match on the right thing:

| You want to exclude by… | Pass to `.excluding()`             | Example                      |
| ----------------------- | ---------------------------------- | ---------------------------- |
| Element name            | the qualified name (string/RegExp) | `'OrderService.legacyParse'` |
| File path               | a path glob                        | `'**/legacy/**'`             |
| A specific message      | a RegExp against the message       | `/parseInt/`                 |

`.excluding()` warns if a pattern matches nothing (a stale exclusion). Wrap a pattern in `silent()` to suppress that warning when you know the exclusion is forward-looking. Rule of thumb: **baseline for temporary debt, `.excluding()` for permanent by-design exceptions.**

## Monorepos

Use [`workspace()`](/core-concepts#monorepo-workspace) to unify the import graph across packages so cross-package imports are visible to dependency rules:

```typescript
const ws = workspace(['apps/web/tsconfig.json', 'packages/shared/tsconfig.json'])
```

`workspace()` uses the alphabetically-first tsconfig's compiler options. For per-package strictness (a `tsconfig()` rule against one package), load that package directly: `tsconfig(project('./packages/x/tsconfig.json'))`.

## AI-agent projects

If AI agents write code in your repo, add the [`agentGuardrails`](/presets#agentguardrails) preset and feed `explain --format agent` into the agent's instructions — see the [AI Agents](/ai-agents) workflow. The guardrails catch the mistakes agents make most; the check-in-loop lets the agent self-correct.

## Anti-patterns

- **Don't start with 50 rules.** A wall of red on day one gets the tool disabled. Floor first, then grow.
- **Don't gate CI before baselining an existing codebase.** The first PR will fail on legacy code nobody touched.
- **Don't put project-specific rules in a preset.** Presets are generic and shared; your `"OrderService must call the pricing gateway"` rule belongs in `arch.rules.ts`, not a reusable preset.
- **Don't reach for `.excluding()` when you mean baseline.** Excluding a violation forever hides real regressions in that spot; baseline lets new ones surface.
