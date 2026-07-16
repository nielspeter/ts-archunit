# ts-archunit

**Architecture testing for TypeScript.** Encode structural rules as executable checks that run in CI and catch violations on the PR that introduces them — not 18 months later in a manual audit.

Inspired by Java's [ArchUnit](https://www.archunit.org/). Powered by [ts-morph](https://ts-morph.com/).

```bash
npm install -D @nielspeter/ts-archunit
npx ts-archunit init        # scaffold config + rules, then `npm run arch`
```

[Get Started →](/getting-started) · [What Can It Check?](/what-to-check) · [GitHub](https://github.com/NielsPeter/ts-archunit)

---

## Rules read like English

If you can read this sentence, you can write architecture rules:

```typescript
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt'))
```

- **`classes(p).that()`** — select which classes
- **`.extend('BaseRepository')`** — filter to subclasses
- **`.should().notContain(call('parseInt'))`** — assert what must be true

Spread rules into `arch.rules.ts` and run `npm run arch`, or [run them inside vitest/jest](/running-in-tests) — same rules, your choice of runner.

## What other tools can't do

Every existing tool checks **which files import which**. That's useful, but it misses what happens **inside** your functions — the real source of architecture rot:

```typescript
// "Repositories must use the shared helper, not inline parseInt"
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt'))

// "Query options must use typed unions, not bare string"
types(p).that().haveProperty('orderBy').should().havePropertyType('orderBy', not(isString()))

// "No circular dependencies between feature modules"
slices(p).matching('src/features/*/').should().beFreeOfCycles()
```

| Capability                                          | ts-archunit | dependency-cruiser | eslint-plugin-boundaries |
| --------------------------------------------------- | ----------- | ------------------ | ------------------------ |
| Import path rules                                   | ✅          | ✅                 | ✅                       |
| **Body analysis** (what's called inside functions)  | ✅          | ❌                 | ❌                       |
| **JSX element rules** (design system, a11y)         | ✅          | ❌                 | ❌                       |
| **Type checking** (string vs typed union)           | ✅          | ❌                 | ❌                       |
| Cycle detection                                     | ✅          | ✅                 | ❌                       |
| **Smell detection** (duplicates, inconsistencies)   | ✅          | ❌                 | ❌                       |
| **Config enforcement** (`strict: true` can't drift) | ✅          | ❌                 | ❌                       |
| Baseline (gradual adoption)                         | ✅          | ❌                 | ❌                       |
| GitHub PR annotations                               | ✅          | ❌                 | ❌                       |

ts-archunit **complements** your linter — it doesn't replace it. For the honest breakdown of where it overlaps eslint, Biome, and dependency-cruiser (and where it doesn't), see **[How It Fits](/how-it-fits)**.

## A violation tells you why and how to fix it

```
Architecture Violation [1 of 1]

  Rule: Classes extending 'BaseRepository' should not contain call to 'parseInt'

  src/repositories/webhook.repository.ts:7 — WebhookRepository

  Why: BaseRepository provides extractCount() — inline parseInt diverges
  Fix: Replace parseInt(x, 10) with this.extractCount(result)

    > 7 |     const total = parseInt(countResult.count, 10)
```

In GitHub Actions this appears **inline on the PR diff**, right where the violation was introduced.

## What it can enforce

A quick sample — see the full gallery in **[What Can It Check?](/what-to-check)**:

- **Layers & dependencies** — domain must not import infrastructure; no cycles between features
- **Code patterns** — repositories use the shared helper, not inline `parseInt`; services throw typed errors
- **Type safety** — no `any` properties, no `as` assertions; `orderBy` is a typed union, not bare `string`
- **JSX & design system** — no raw `<button>`; every `<img>` has `alt`; no `dangerouslySetInnerHTML`
- **Config drift** — `strict: true` stays on ([`tsconfig()`](/config-rules))
- **Code smells** — copy-pasted logic and inconsistent siblings, caught by AST similarity

## Adopt gradually

You don't need to fix everything to start. **Baseline mode** records existing violations and only fails on new ones — so a large legacy codebase can adopt rules incrementally and ratchet down over time. See [Setup & Best Practices](/setup-best-practices).

## AI agents need guardrails

AI-generated code doesn't know your team's conventions, and every agent PR looks correct in isolation. ts-archunit is the guardrail: rules run in CI, and violations carry the exact context — what's wrong, why, how to fix — an agent needs to self-correct. See [AI Agents](/ai-agents).

---

## Ready to start?

[Get Started →](/getting-started) — install, scaffold, and run your first rule in five minutes.
