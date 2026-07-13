# Getting Started

From zero to enforcing architecture rules in about five minutes.

## Prerequisites

- **Node.js** ≥ 24
- A TypeScript project with a `tsconfig.json`

That's it — no test runner required. (Already run vitest/jest and prefer your rules there? See [Running Rules in Tests](/running-in-tests). This guide uses the CLI, the default path.)

## 1. Install and scaffold

```bash
npm install -D @nielspeter/ts-archunit
npx ts-archunit init
```

`init` generates a working setup in the current directory:

- **`ts-archunit.config.ts`** — points `check` at your rules and baseline.
- **`arch.rules.ts`** — a rule file seeded with the [`recommended`](/presets#recommended) safety floor, ready for your own rules.
- **`arch-baseline.json`** — an empty baseline placeholder.
- **`arch` / `arch:baseline`** npm scripts.

Building with an AI coding agent? Scaffold the agent guardrails instead — `npx ts-archunit init --preset agent-guardrails` — and see the [AI Agents](/ai-agents) guide.

## 2. First run

The `recommended` floor is thin — its only failing rules are no `eval` and no `Function` constructor, so a healthy codebase is usually green out of the gate. But as you add shape presets and your own rules (next steps), an existing codebase _will_ surface legacy violations. Get in the habit now — it's the safe default and costs nothing:

**New or small project** — just run it. You'll almost certainly be green:

```bash
npm run arch
```

**Existing codebase** — snapshot current violations first, so your first gated run isn't a wall of red for legacy code you haven't cleaned up yet:

```bash
npm run arch:baseline   # records today's violations as accepted debt
git add arch-baseline.json && git commit -m "chore: arch baseline"
npm run arch            # now only NEW violations fail
```

> **First run reported a lot of violations?** That's expected on an existing codebase — baseline them (above), then fix them down over time. See [Setup & Best Practices](/setup-best-practices) and [Troubleshooting](/troubleshooting).

## 3. What you just got

The generated `arch.rules.ts` looks roughly like this (trimmed — the real file also has commented examples and an `agentGuardrails` pointer):

```typescript
import { project } from '@nielspeter/ts-archunit'
import { recommended } from '@nielspeter/ts-archunit/presets'

const p = project('tsconfig.json')

export default [
  ...recommended(p),
  // add your own rules below
]
```

`recommended` is a deliberately thin, universal safety floor (no `eval`, no `Function` constructor, no silent catches, no empty bodies) — see [Presets](/presets#recommended). It's the starting point, not the whole architecture; the rules that matter most are the ones specific to _your_ project, which you add next.

## 4. Add your first rule

Rules are builders spread into the default export — **no `.check()`**; the CLI runs them:

```typescript
import { project, modules } from '@nielspeter/ts-archunit'
import { recommended } from '@nielspeter/ts-archunit/presets'

const p = project('tsconfig.json')

export default [
  ...recommended(p),

  // Domain code must not reach into infrastructure
  modules(p)
    .that()
    .resideInFolder('**/domain/**')
    .should()
    .onlyImportFrom('**/domain/**', '**/shared/**')
    .because('Domain must stay independent of infrastructure'),
]
```

Run `npm run arch` again. When a `domain/` module imports from `infrastructure/`, you get:

```
Architecture Violation [1 of 1]

  Rule: Modules in '**/domain/**' should only import from '**/domain/**', '**/shared/**'

  src/domain/order.service.ts:3 — order.service.ts

  Why: Domain must stay independent of infrastructure

    2 | import { OrderEntity } from './order.entity'
  > 3 | import { db } from '../infrastructure/database'
    4 | import { validate } from '../shared/validation'
```

Want a rule to _warn_ instead of fail the build? Append `.asSeverity('warn')`.

## 5. Iterate locally

Re-run on every change while you write rules or fix violations:

```bash
npm run arch -- --watch
```

## 6. Run in CI

A complete GitHub Actions job — the `github` format renders violations inline on the PR diff:

```yaml
# .github/workflows/arch.yml
name: architecture
on: [pull_request]
jobs:
  arch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx ts-archunit check --format github
```

Violations are now caught on the PR that introduces them — not 18 months later in a manual audit.

## Where to go next

- **[Setup & Best Practices](/setup-best-practices)** — the recommended adoption ladder: floor → shape presets → baseline → CI → custom rules last.
- **[Presets](/presets)** — one-liner setups for layered architecture, feature boundaries, and the repository pattern.
- **[What Can It Check?](/what-to-check)** — a gallery of copy-paste rules by pain point.
- **[Custom Rules](/custom-rules)** — encode team-specific conventions with `definePredicate` / `defineCondition`.
- **[AI Agents](/ai-agents)** — guardrails and the check-in-loop workflow for AI-generated code.
- **[Running Rules in Tests](/running-in-tests)** — run rules inside vitest/jest instead of the CLI.
