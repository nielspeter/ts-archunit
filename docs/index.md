# ts-archunit

**Architecture testing for TypeScript.** Enforce structural rules across your codebase as executable tests that run in CI.

Inspired by Java's [ArchUnit](https://www.archunit.org/). Powered by [ts-morph](https://ts-morph.com/).

[Get Started →](/getting-started) · [What Can It Check?](/what-to-check) · [GitHub](https://github.com/NielsPeter/ts-archunit)

---

## The Problem

Architecture decisions are documented in ADRs, discussed in reviews, agreed on in meetings — and then violated one PR at a time.

A real-world API project with 40 repositories grew organically over 18 months. A routine audit found:

```typescript
// File A — manual Number(), no limit cap
const skip = Number(request.query.skip) || 0
const limit = Number(request.query.limit) || 100

// File B — manual Number() with Math.min cap
const skip = Number(request.query.skip) || 0
const limit = Math.min(Number(request.query.limit) || 100, 1000)

// File C — conditional Number(), no cap
skip: skip !== undefined ? Number(skip) : undefined,
limit: limit !== undefined ? Number(limit) : undefined,
```

A shared utility `normalizePagination()` existed. Some endpoints used it. Most didn't.

**Six different pagination patterns across 30 routes.** Each was introduced by a single PR that looked correct in isolation. Code review didn't catch them because no reviewer holds the full pattern inventory in their head.

The audit plan — just documenting what's wrong — was 433 lines. Before writing a single line of fix code.

**ts-archunit prevents this.** Write the rule once, CI enforces it forever:

```typescript
functions(p)
  .that()
  .haveNameMatching(/^parse\w+Order$/)
  .and()
  .resideInFolder('**/routes/**')
  .should()
  .notExist()
  .rule({
    id: 'route/no-copy-paste',
    because: 'Copy-pasted parsers diverge over time',
    suggestion: 'Use the shared parseOrder() utility with a column map',
  })
  .check()
```

---

## What Other Tools Can't Do

Every existing tool checks **which files import which**. That's useful, but it misses the real problems.

ts-archunit checks what happens **inside** your functions:

```typescript
// "Repositories must use the shared helper, not inline parseInt"
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
```

```typescript
// "Query options must use typed unions, not bare string"
types(p)
  .that()
  .haveProperty('orderBy')
  .should()
  .havePropertyType('orderBy', notType(isString()))
  .check()
```

```typescript
// "No circular dependencies between feature modules"
slices(p).matching('src/features/*/').should().beFreeOfCycles().check()
```

| Capability                                         | ts-archunit | dependency-cruiser | eslint-plugin-boundaries |
| -------------------------------------------------- | ----------- | ------------------ | ------------------------ |
| Import path rules                                  | ✅          | ✅                 | ✅                       |
| **Body analysis** (what's called inside functions) | ✅          | ❌                 | ❌                       |
| **Type checking** (string vs typed union)          | ✅          | ❌                 | ❌                       |
| Cycle detection                                    | ✅          | ✅                 | ❌                       |
| Baseline (gradual adoption)                        | ✅          | ❌                 | ❌                       |
| GitHub PR annotations                              | ✅          | ❌                 | ❌                       |

---

## What a Violation Looks Like

When a rule fails, you don't just get "error." You get **why it matters and how to fix it**:

```
Architecture Violation [repo/no-parseint]

  WebhookRepository.query contains call to 'parseInt' at line 7
  at src/repositories/webhook.repository.ts:7

      5 |   async query() {
      6 |     const countResult = await this.db.count('* as count').first()
    > 7 |     const total = typeof countResult.count === 'string'
              ? parseInt(countResult.count, 10) : countResult.count
      8 |

  Why: BaseRepository provides extractCount() — inline parseInt diverges
  Fix: Replace parseInt(x, 10) with this.extractCount(result)
```

In GitHub Actions, this appears **inline on the PR diff** — right where the violation was introduced.

---

## Rules Read Like English

If you can read this sentence, you can write architecture rules:

```typescript
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
```

The fluent API maps directly to the intent:

- **`classes(p).that()`** — select which classes
- **`.extend('BaseRepository')`** — filter to subclasses
- **`.should().notContain(call('parseInt'))`** — assert what must be true
- **`.check()`** — run and fail if violated

---

## Adopt Gradually

You don't need to fix every violation to start. **Baseline mode** records existing violations and only fails on new ones:

```typescript
const baseline = withBaseline('arch-baseline.json')

classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check({ baseline }) // only NEW violations fail
```

Teams adopt rules incrementally. As they fix legacy code, they regenerate the baseline to ratchet down.

---

## AI Agents Need Guardrails

AI agents generating code don't know your team's conventions. Every agent PR looks correct in isolation — just like every human PR did.

ts-archunit is the guardrail. Rules run in CI. Violations show up inline on the PR with clear messages explaining **what's wrong, why it matters, and how to fix it** — exactly the context an agent needs to self-correct.

---

## Ready to Start?

[Get Started →](/getting-started) — install, write your first rule, run it in 5 minutes.

[What Can It Check?](/what-to-check) — browse 8 categories of rules as one-liner examples.
