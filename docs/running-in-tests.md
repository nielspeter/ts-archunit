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

### Presets in a test file — `checkAll`

Presets return an array of rules. `checkAll` is the test-file terminal: it runs the whole array and throws one aggregated error if any **error**-severity violation is found (warns are reported but never fail — except a _configuration_ finding, which is `error` regardless of severity: a dead glob since 0.34.0, or a rule that examined **zero units** since 0.59.0):

```typescript
import { checkAll } from '@nielspeter/ts-archunit'
import { recommended } from '@nielspeter/ts-archunit/presets'
import { layeredArchitecture } from '@nielspeter/ts-archunit/presets'

it('architecture holds', () => {
  checkAll([...recommended(p), ...layeredArchitecture(p, { layers })])
})
```

`checkAll` also takes `{ baseline, diff, format }` — the same options as `.check()`.

For a non-failing warning, use the terminal `.warn()` (logs, does not throw with one exception ([configuration findings](/violation-reporting#the-one-thing-warn-cannot-silence))):

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

## The pre-flight for this form

A rule that asserts nothing — a selector with no condition after `.should()`, or a
predicate like `areAsync()` used _after_ `.should()`, where it filters instead of
asserting — can never fail. **Since 0.23.0 it is a hard failure** that nothing can
suppress, so find them before you upgrade.

**The cheapest pre-flight for this form is the upgrade itself.** Install 0.23.0 on a
scratch branch and run your suite: every offender fails in its own test, with its own
file, line and code frame — better attribution than any diagnostic can give you, because
vitest reports the frame that built the rule. Then fix, and merge the fixes before you
merge the upgrade.

`doctor` cannot help here: it loads a rule file as a module, and a file that imports a
test runner cannot be loaded that way. Use `diagnose()` in-process instead — same
findings, same remedies, and it takes the builders you already have:

```typescript
import { diagnose } from '@nielspeter/ts-archunit'

it('every architecture rule asserts something', () => {
  const rules = [
    classes(p).that().extend('BaseRepository').should().beExported(),
    modules(p).that().resideInFolder('**/src/domain/**').should().notImportFrom('**/src/http/**'),
  ]
  expect(diagnose(rules)).toEqual([])
})
```

That is itself an architecture rule about your architecture rules, and it fails with the
specific remedy for whichever shape is wrong. The `checkAll([...])` form above already
holds its rules in an array, so it can pass the same array to `diagnose()`.

**It only sees the rules in the array.** Written as above — a second, hand-copied list
beside the rules the tests actually run — it is green for every rule you forgot to copy,
which is the same hand-maintained-list problem the rules themselves exist to catch. Hoist
each builder so the test and the array share one object, or prefer the scratch-branch
upgrade above, which cannot miss a rule because it runs all of them.

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
A builder that ends in `.check()` (or `.warn()`) inside a CLI rule file's `export default [...]` array executes immediately and returns `undefined` — the CLI **silently skips it**. Worse, if that `.check()` _fails_, it throws while the array is still being built, so **every other rule in the same file is dropped too** — a passing run that was actually enforcing nothing. In a rule file, leave builders un-terminated and use `.asSeverity('warn')` for warnings. (The reverse is safe: a bare builder in a test does nothing until you call `.check()`.)
:::
