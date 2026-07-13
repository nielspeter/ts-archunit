# Running Rules in Tests

The [golden path](/getting-started) runs rules through the CLI (`arch.rules.ts` + `npm run arch`). That's the default because it needs no test runner and carries baseline, diff-aware checks, and CI output out of the box.

But architecture rules are also **just tests** — if your project already runs [vitest](https://vitest.dev/) or [jest](https://jestjs.io/), you can run them there instead, with zero extra tooling. This page is the first-class alternative. Pick whichever fits how your team already works; they enforce exactly the same rules.

## When to prefer the test-file form

- Your CI already runs your test suite — architecture rules ride along with no new step.
- You want per-rule output in your test reporter (each rule is its own `it()`).
- You want vitest's watch mode and failure formatting.

Prefer the CLI form when you want diff-aware checks (`--changed`), machine-readable output (`--format json`/`github`), or a single aggregated report — see [CLI](/cli).

## The test-file form

Rules go in a normal test file and end in `.check()`, which throws on a violation (failing the test):

```typescript
import { describe, it } from 'vitest'
import { project, modules, classes, call } from '@nielspeter/ts-archunit'

const p = project('tsconfig.json')

describe('Architecture', () => {
  it('domain must not import from infrastructure', () => {
    modules(p)
      .that()
      .resideInFolder('**/domain/**')
      .should()
      .onlyImportFrom('**/domain/**', '**/shared/**')
      .because('Domain must stay independent of infrastructure')
      .check()
  })

  it('repositories must use the shared helper, not inline parseInt', () => {
    classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
  })
})
```

Run it with your test runner:

```bash
npx vitest run arch.test.ts
```

A violation throws an `ArchRuleError` with the same rich message (why + fix + code frame) you get from the CLI — it just surfaces as a failing test.

### Presets and warnings in a test file

Presets return builders, so call `.check()` (or `.warn()`) on each, or iterate:

```typescript
import { recommended } from '@nielspeter/ts-archunit/presets'

it('recommended floor holds', () => {
  for (const rule of recommended(p)) rule.check()
})
```

For a non-failing warning, use the terminal `.warn()` (logs, does not throw):

```typescript
it('no empty catches (advisory)', () => {
  functions(p).that().resideInFile('**/src/**').should().satisfy(functionNoSilentCatch()).warn()
})
```

### Baseline in a test file

Pass the baseline through `.check()`:

```typescript
import { withBaseline } from '@nielspeter/ts-archunit'

const baseline = withBaseline('arch-baseline.json')

it('only new violations fail', () => {
  classes(p)
    .that()
    .extend('BaseRepository')
    .should()
    .notContain(call('parseInt'))
    .check({ baseline })
})
```

## Converting between the two forms

The forms differ only in how a rule is **terminated** and **run**. When you move a rule between them, swap both:

| Concern      | CLI rule file (`arch.rules.ts`)                  | Test file (vitest/jest)             |
| ------------ | ------------------------------------------------ | ----------------------------------- |
| Rule ends in | **nothing** — the bare builder goes in the array | `.check()`                          |
| File shape   | `export default [ rule1, rule2 ]`                | `it('...', () => { rule.check() })` |
| Warning      | `.asSeverity('warn')` (non-terminal)             | `.warn()`                           |
| Baseline     | `--baseline` flag or config                      | `.check({ baseline })`              |
| Run with     | `npm run arch` (`ts-archunit check`)             | `npx vitest run`                    |

::: warning Don't paste a `.check()` rule into a rule file
A builder that ends in `.check()` (or `.warn()`) inside a CLI rule file's `export default [...]` array executes immediately and returns `undefined` — the CLI **silently skips it and the rule never runs**. In a rule file, leave builders un-terminated and use `.asSeverity('warn')` for warnings. (The reverse is safe: a bare builder in a test does nothing until you call `.check()`.)
:::
