# ts-archunit

**Architecture testing for TypeScript.** Enforce structural rules across your codebase as executable tests that run in CI.

Inspired by Java's [ArchUnit](https://www.archunit.org/). Powered by [ts-morph](https://ts-morph.com/).

[Get Started →](/getting-started) · [What Can It Check?](/what-to-check) · [GitHub](https://github.com/NielsPeter/ts-archunit)

---

## Does This Sound Familiar?

**"The domain layer imports from the database layer."**

Someone added a quick import to get a type. Then another. Now your clean architecture has 15 backdoors.

```typescript
// ts-archunit catches this on the PR that introduces it:
modules(p)
  .that()
  .resideInFolder('**/domain/**')
  .should()
  .notImportFrom('**/repositories/**')
  .check()
```

**"Half the repositories throw `new Error()` instead of typed errors."**

A shared `NotFoundError` exists. But 12 out of 40 repositories still throw generic `Error`. Code review didn't catch it because each PR only touched one file.

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(newExpr('Error'))
  .because('use NotFoundError, ValidationError, etc.')
  .check()
```

**"Feature modules depend on each other in circles."**

The auth module imports from billing, billing imports from notifications, notifications imports from auth. Nobody planned this. It just happened.

```typescript
slices(p).matching('src/features/*/').should().beFreeOfCycles().check()
```

**ts-archunit turns these rules into tests.** They run in CI. Violations are caught on the PR that introduces them — not 18 months later during a manual audit.

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
