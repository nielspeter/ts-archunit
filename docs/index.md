---
layout: home
hero:
  name: ts-archunit
  text: Architecture Testing for TypeScript
  tagline: Stop architecture rot before it starts. Enforce structural rules as executable tests that run in CI.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: What Can It Check?
      link: /what-to-check
    - theme: alt
      text: GitHub
      link: https://github.com/NielsPeter/ts-archunit

features:
  - icon: 🔍
    title: Goes Beyond Import Checking
    details: 'Other tools only check which files import which. ts-archunit inspects what happens <em>inside</em> your functions: banned calls, wrong constructors, missing patterns. No other TypeScript tool does this.'
  - icon: 🛡️
    title: Catches What Code Review Misses
    details: 'Every PR looks correct in isolation. But across 40 repositories, you get 6 different pagination patterns, copy-pasted parsers, and orderBy fields that accept bare strings. ts-archunit catches the drift automatically.'
  - icon: 🤖
    title: AI Agent Guardrails
    details: "AI agents generating code don't know your team's conventions. ts-archunit enforces them in CI — with clear messages explaining what's wrong, why it matters, and how to fix it."
  - icon: 📐
    title: Rules Read Like English
    details: "<code>classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()</code> — if you can read this sentence, you can write architecture rules."
  - icon: 🏗️
    title: Gradual Adoption
    details: 'Baseline mode records existing violations and only fails on new ones. Teams adopt rules incrementally without fixing 500 violations in one PR.'
  - icon: ⚡
    title: Powered by the TypeScript Compiler
    details: 'Built on ts-morph — full access to the AST and type checker. Resolves through generics, Partial<>, Pick<>, and type aliases. Not a regex hack.'
---

## The Problem

Architecture decisions are documented in ADRs, discussed in reviews, agreed on in meetings — and then violated one PR at a time.

A real-world API project with 40 repositories grew organically over 18 months. A routine audit found:

- **6 copy-pasted order-parsing functions** — all identical logic, different names
- **6 different pagination patterns** — some capped at 1000, some unlimited, some didn't paginate at all
- **`orderBy?: string`** on half the query options — a SQL injection surface hiding in plain sight
- **Inline `parseInt`** in 4 repositories when a shared `extractCount()` helper existed

Each violation was introduced by a single PR that looked correct in isolation. Code review didn't catch them because no reviewer holds the full pattern inventory in their head.

**ts-archunit prevents this.** Rules run in your test suite. CI catches violations on the PR that introduces them.

## What Makes It Different

| Tool                     | Import paths | Body analysis | Type checking | Cycles | Baseline |
| ------------------------ | ------------ | ------------- | ------------- | ------ | -------- |
| **ts-archunit**          | ✅           | ✅            | ✅            | ✅     | ✅       |
| dependency-cruiser       | ✅           | ❌            | ❌            | ✅     | ❌       |
| eslint-plugin-boundaries | ✅           | ❌            | ❌            | ❌     | ❌       |
| ts-arch (npm)            | ✅           | ❌            | ❌            | ❌     | ❌       |

**Body analysis** is the key differentiator. Other tools can tell you "file A imports file B." ts-archunit can tell you "the `query()` method in `WebhookRepository` calls `parseInt` instead of `this.extractCount()`."

## 30-Second Example

```typescript
import { project, classes, call } from 'ts-archunit'

const p = project('tsconfig.json')

classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(call('parseInt'))
  .rule({
    id: 'repo/no-parseint',
    because: 'BaseRepository provides extractCount() — inline parseInt diverges',
    suggestion: 'Replace parseInt(x, 10) with this.extractCount(result)',
  })
  .check()
```

When this rule fails, you see:

```
Architecture Violation [repo/no-parseint]

  WebhookRepository.query contains call to 'parseInt' at line 7
  at src/repositories/webhook.repository.ts:7

      5 |   async query() {
      6 |     const countResult = await this.db.count('* as count').first()
    > 7 |     const total = typeof countResult.count === 'string' ? parseInt(countResult.count, 10) : countResult.count
      8 |

  Why: BaseRepository provides extractCount() — inline parseInt diverges
  Fix: Replace parseInt(x, 10) with this.extractCount(result)
```

The developer (or AI agent) knows exactly what's wrong, why, and how to fix it.

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #bd34fe 30%, #41d1ff);
}
</style>
