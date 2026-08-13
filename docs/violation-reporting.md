# Violation Reporting

When an architecture rule fails, ts-archunit produces rich violation messages with code frames, file paths, line numbers, and optional context about why the rule exists and how to fix it.

## What You See

A violation includes:

1. **Rule ID** (if provided via `.rule()`)
2. **Violation message** -- what was found and why it's wrong
3. **File path and line number** -- exact location
4. **Code frame** -- surrounding source code with the violating line highlighted
5. **Why** -- reason the rule exists (from `.because()` or `.rule({ because })`)
6. **Fix** -- suggested remediation (from `.rule({ suggestion })`)
7. **Docs** -- link to documentation (from `.rule({ docs })`)

Example output:

```
Architecture Violation [repo/typed-errors]

  WebhookRepository.findById contains new 'Error' at line 42
  at src/repositories/webhook.repository.ts:42

    41 |     if (!result) {
  > 42 |       throw new Error(`Webhook '${id}' not found`)
    43 |     }

  Why: Generic Error loses context and prevents consistent error handling
  Fix: Replace new Error(msg) with new NotFoundError(entity, id)
  Docs: https://example.com/adr/011#error-handling
```

## `.check()` vs `.warn()`

### `.check()`

Throws an `ArchRuleError` when violations are found. The test fails, CI blocks the PR.

```typescript
classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
```

### `.warn()`

Logs violations to stderr but does not throw. The test passes. Use for advisory rules.

```typescript
classes(p).that().haveDecorator('Deprecated').should().notExist().warn()
```

#### The one thing `.warn()` cannot silence

A **configuration finding** — one that reports the rule enforces _nothing_, such as an empty selector, an empty slice discovery, or [a rule that asserts nothing](#a-rule-must-assert-something) — always throws, whatever terminal you use, and is always reported at `error` severity.

`.warn()` says "this rule's violations are advisory". A rule that cannot fire has no violations to be advisory about: the finding is not that your code is wrong, it is that the rule is not checking anything. Three of the four ways to quiet a finding already refused these — `.excluding()` says so out loud, and both baseline and diff skip them — and `.warn()` was the gap.

The thrown error carries **only** the configuration findings; ordinary violations are still logged exactly as before. `.violations()` remains the non-throwing programmatic surface if you need to inspect rather than fail.

This applies to `.severity('warn')` and to `.asSeverity('warn')` too — both reach the same place.

### A warning that can fail

Plain `.asSeverity('warn')` is **advisory**: permanent, and correctly so for a finding you want a
reader to judge rather than have the build refuse — a silent-catch probe, a style preference, anything
ADR-008 rule 1 calls a judgement call. It never fails, however long it lives.

That is also the trap a warning can become: `.asSeverity('warn')` used to defer a rule you _meant_ to
enforce, with no way to tell the two apart and no way to catch a **new** violation arriving while it
sits at `warn`. This project shipped exactly that once — `arch/no-cycles` sat at `.warn()` for months
waiting on an unrelated fix, and a genuinely new cycle landed, unenforced, because nothing could fail
while the rule was there.

`.asSeverity('warn', { accepted })` is the accountable version — a **deferred** warning:

```typescript
classes(p)
  .that()
  .resideInFolder('**/src/repositories/**')
  .should()
  .extend('BaseRepository')
  .asSeverity('warn', {
    accepted: [
      'LegacyOrderRepository::LegacyOrderRepository does not extend "BaseRepository"',
      'LegacyUserRepository::LegacyUserRepository does not extend "BaseRepository"',
    ],
  })
```

A violation stays `warn` only while its subject (`identity`, or `element::message` when a producer sets
no identity) is in `accepted`. Anything not in the list — a repository added tomorrow that also skips
the base class — escalates to `error` and fails `.violations()`/`checkAll()`/the CLI `check` command,
the same surfaces `.asSeverity()` already governs. `.check()`/`.warn()` called directly on one builder
are unaffected either way — they always hardcoded their own severity, before this existed.

**Identity-based, not a count.** `accepted` is a list of the exact findings you are choosing to defer,
not a number. A ceiling like "warn while there are ≤ 2 findings" cannot tell a fixed violation from a
different, brand-new one that happens to arrive at the same time — the count stays the same and the
regression passes unnoticed, which is precisely the failure this exists to close.

`ts-archunit doctor` previews a breach before `check()` discovers it — a `'deferred-warning'` finding
names exactly which current violations are not in `accepted`, so you see the same list `check()` would
fail on, before running it.

**Choosing between the two.** `.asSeverity('warn')` alone for something a person should read and decide
about, every time. `.asSeverity('warn', { accepted })` for something you are actively deferring — real
debt, named, that must not silently grow. Neither is a general escape hatch: a
[configuration finding](#the-one-thing-warn-cannot-silence) still cannot be suppressed by either.

### A rule must assert something

Since 0.23.0, a rule that never states a condition is a configuration finding too — it fails, on every terminal, with the remedy for its particular shape:

```typescript
// ❌ fails: reached .should(), no condition follows
functions(p)
  .that()
  .haveNameMatching(/^parse/)
  .should()
  .check()

// ❌ fails: `areAsync` is a predicate, so nothing after .should() is asserted
functions(p)
  .that()
  .haveNameMatching(/^parse/)
  .should()
  .areAsync()
  .check()

// ❌ fails: `areAsync` narrowed the selection AFTER the condition was stated,
//    so `notExist` was checked against an empty set and held vacuously
functions(p)
  .that()
  .haveNameMatching(/^parse/)
  .should()
  .notExist()
  .areAsync()
  .check()

// ❌ fails: never reached .should()
functions(p)
  .that()
  .haveNameMatching(/^parse/)
  .check()

// ✅ asserts something
functions(p)
  .that()
  .haveNameMatching(/^parse/)
  .should()
  .notExist()
  .check()
```

A rule with no condition selects some code and then asserts nothing about it, so it can never fail — and a suite full of them reports coverage it does not have. The finding names which of those shapes you wrote and what to add.

The third example is the one worth studying, because it does not look broken. Predicates filter and conditions assert; a predicate written **after** `.should()` still filters, so it narrows the set the conditions are evaluated over — and if that leaves nothing, every condition holds vacuously. The rule's own description reads as if it were deliberate (`that have name matching /^parse/ and are async should not exist`), which is why nobody goes looking. Its remedy is to move the predicate, not to add a condition: it already has one.

**There is no opt-out.** Not `.warn()`, not `.asSeverity('warn')`, not `.excluding()`, not baseline, not diff-aware mode. If a rule is a placeholder, delete it or leave it commented out; if it is generated from configuration, skip generating it when there is nothing to assert. A rule that is present and green is a claim that something is checked.

Run [`ts-archunit doctor`](/cli#doctor) to find these across a whole rule set without evaluating their conditions.

### When to Use Which

| Scenario                                  | Method                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Hard constraint the team agreed on        | `.check()`                                                                               |
| Aspirational rule being gradually adopted | `.warn()` (still fails on a [configuration finding](#the-one-thing-warn-cannot-silence)) |
| New rule with many existing violations    | `.warn()` or use [baseline mode](/core-concepts#baseline-mode)                           |
| Deprecated code tracking                  | `.warn()`                                                                                |

## Rule Metadata with `.rule()`

When a rule fails, developers need to know not just what broke but why it exists and how to fix it. The `.rule()` method attaches structured metadata -- ID, rationale, fix suggestion, and docs link -- that appears directly in violation output. This turns cryptic failures into actionable guidance.

Attach context to any rule:

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(newExpr('Error'))
  .rule({
    id: 'repo/typed-errors',
    because: 'Generic Error loses context and prevents consistent error handling',
    suggestion: 'Replace new Error(msg) with new NotFoundError(entity, id)',
    docs: 'https://example.com/adr/011#error-handling',
  })
  .check()
```

All fields are optional:

| Field        | Description            | Shown in output as            |
| ------------ | ---------------------- | ----------------------------- |
| `id`         | Unique rule identifier | Header: `[repo/typed-errors]` |
| `because`    | Why the rule exists    | `Why: ...`                    |
| `suggestion` | How to fix a violation | `Fix: ...`                    |
| `docs`       | Link to documentation  | `Docs: ...`                   |

`id` and `because` appear on every finding the rule produces. `suggestion` and
`docs` appear on **violations of the rule** only — a configuration finding, which
reports that the rule enforces nothing, carries its own remedy instead. Your fix
for "the cycle should be split" is not the fix for "this rule discovered no
slices to look for cycles in", and the `Fix:` line is the one an agent obeys.

### `.because()` Shorthand

For simple reasons without the full `.rule()` object:

```typescript
classes(p)
  .that()
  .extend('BaseRepository')
  .should()
  .notContain(call('parseInt'))
  .because('BaseRepository provides extractCount() for safe type coercion')
  .check()
```

## Excluding Intentional Violations

Not every rule violation is a bug. Some code legitimately needs to break a general rule -- a wrapper that constructs `URLSearchParams`, a legacy adapter that calls `parseInt`. Exclusions let you suppress these known-good violations permanently while keeping the rule enforced everywhere else. Unlike baseline mode (which tracks temporary debt), exclusions are for code that is correct as-is.

Some violations are intentional -- they'll never be "fixed" because the code is correct. Use exclusions to suppress them while keeping the rule enforced for everything else.

### Chain-level exclusion

Suppress specific violations in the rule definition. Patterns match against the violation's **element name**, **file path**, or **message**:

```typescript
// Match by element name
functions(p)
  .that()
  .resideInFolder('**/wrappers/**')
  .should()
  .notContain(newExpr('URLSearchParams'))
  .excluding('Asset.getImageUrl', 'Environment.sync')
  .check() // enforced — excluded elements silently skipped
```

```typescript
// Match by file path (useful for defineCondition violations)
functions(p)
  .should()
  .satisfy(routeMustHavePreHandler())
  .excluding(/images\.ts/, /platform\/index\.ts/)
  .check()
```

```typescript
// Match by message content
classes(p)
  .should()
  .notContain(call('parseInt'))
  .excluding(/LegacyRepo/, /extractCount/)
  .check()
```

Supports exact strings and regex patterns. String matching is exact (`===`). Use regex for partial matching.

Patterns are tested against three fields — the first match wins:

- `violation.element` — qualified name like `MyService.doWork`, `Config.constructor`, or `handler` (for standalone functions). Inner AST nodes (e.g., `AsExpression`) are resolved to their nearest enclosing class/method/function.
- `violation.file` — absolute file path
- `violation.message` — full violation description

If an exclusion pattern matches zero violations, a warning is emitted to help detect stale exclusions after renames.

### Inline exclusion comments

Inline comments live next to the code, which is their advantage. They have no
staleness signal, which is their cost: `.excluding()` warns when a pattern matches
nothing, and an inline comment cannot -- comments are only parsed in files that
already produced a violation, so one naming a renamed rule id is inert forever and
silently. Prefer `.excluding()` when the exemption is about a rule rather than a
line.

Exclude at the code level -- the exclusion moves with the code:

```typescript
// ts-archunit-exclude sdk/no-manual-urlsearchparams: builds image transform URL, not list pagination
async getImageUrl() {
  const params = new URLSearchParams()  // <- not flagged
}
```

Block exclusions cover a range of lines:

```typescript
// ts-archunit-exclude-start sdk/no-manual-urlsearchparams: image URL builder
async getImageUrl() {
  const params = new URLSearchParams()
  return params.toString()
}
// ts-archunit-exclude-end
```

Multiple rule IDs on one line:

```typescript
// ts-archunit-exclude rule-a, rule-b: shared reason for both rules
doSomething()
```

Requires a `.rule({ id })` -- exclusion comments reference the rule by ID.
A reason is expected -- an undocumented exclusion still applies and emits a warning.

### Where the comment has to go

A single-line directive covers **exactly the line below it**, and the line that
counts is the one the finding reports -- which is not always the line you were
looking at.

- A **class-level** condition reports at the class declaration, so the comment goes
  above `export class Foo {`, not above the offending statement inside a method.
  A finding whose message says "at line 12" may be reported at line 3.
- A **file-level** condition (`notHaveDefaultExport`, `haveMaxExports`) reports at
  line 1. No single-line comment can cover it -- that would need a comment on line 0. Use the block form.
- Nothing warns you when a comment matches no violation, so a misplaced one is
  silent. Check `check --format json` -> `commentSuppressed`, which lists every
  suppression by rule and file.

### Exclusions vs Baseline

| Mechanism       | Purpose                               | Where defined               |
| --------------- | ------------------------------------- | --------------------------- |
| `.excluding()`  | Permanent intentional exceptions      | Test file (rule definition) |
| Inline comments | Permanent exceptions at code level    | Source file                 |
| Baseline        | Temporary violations to fix over time | `arch-baseline.json`        |

## Output Formats

### Terminal (Default)

Colored output with code frames, used when running locally:

```typescript
// Automatically detected
classes(p).should().notContain(call('eval')).check()
```

### GitHub Actions Annotations

When running in GitHub Actions, violations appear as inline annotations on PR diffs:

```typescript
import { detectFormat } from '@nielspeter/ts-archunit'

const format = detectFormat() // 'github' in CI, 'terminal' locally

classes(p).should().notContain(call('eval')).check({ format })
```

### JSON

Machine-readable output for custom integrations:

```typescript
classes(p).should().notContain(call('eval')).check({ format: 'json' })
```

### Programmatic Format Detection

```typescript
import { detectFormat, isCI } from '@nielspeter/ts-archunit'

const format = detectFormat() // auto-detects environment
const ci = isCI() // true in any CI environment
```

## Error Structure

When `.check()` throws, it throws an `ArchRuleError`:

```typescript
import { ArchRuleError } from '@nielspeter/ts-archunit'

try {
  classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
} catch (error) {
  if (error instanceof ArchRuleError) {
    console.log(error.violations) // ArchViolation[]
    console.log(error.message) // Formatted violation report
  }
}
```

### `ArchViolation` Shape

Each violation contains:

| Property     | Type                  | Description                                                  |
| ------------ | --------------------- | ------------------------------------------------------------ |
| `rule`       | `string`              | Human-readable rule description from the fluent chain        |
| `ruleId`     | `string \| undefined` | Unique rule identifier from `.rule({ id })`                  |
| `element`    | `string`              | Element identifier, e.g. `"OrderService"` or `"parseConfig"` |
| `file`       | `string`              | Absolute path to the source file                             |
| `line`       | `number`              | Line number where the violating element starts               |
| `message`    | `string`              | Human-readable description of what went wrong                |
| `because`    | `string \| undefined` | Rationale provided via `.because()`                          |
| `suggestion` | `string \| undefined` | Actionable suggestion for fixing the violation               |
| `docs`       | `string \| undefined` | Link to documentation (ADR, wiki, style guide)               |
| `codeFrame`  | `string \| undefined` | Source code snippet around the violation line                |

A **configuration finding** — one reporting that the rule itself enforces
nothing — carries `file: ''` and a `line` that means nothing, because it
describes a rule rather than a place in your code. In the programmatic object
those stay as they are, for backwards compatibility. In `check --format json`
they are emitted as `null` and the finding carries `"kind": "configuration"`.

Note that the CLI attributes most of them to the **rule file** that declared the
rule before rendering, so in `check --format json` you will usually see that path
with `line: 1` rather than `null`. Either way, `kind` is the field to test — an
empty or null `file` is not a reliable signal.

## Programmatic Access

For custom reporting, catch the error and process violations:

```typescript
import {
  ArchRuleError,
  formatViolations,
  formatViolationsPlain,
  formatViolationsJson,
} from '@nielspeter/ts-archunit'

try {
  classes(p).that().extend('BaseRepository').should().notContain(call('parseInt')).check()
} catch (error) {
  if (error instanceof ArchRuleError) {
    // Re-format violations
    const plain = formatViolationsPlain(error.violations)
    const json = formatViolationsJson(error.violations)

    // Send to external system
    await reportToSlack(plain)

    // Or just count them
    console.log(`Found ${error.violations.length} violations`)
  }
}
```

## Code Frame Customization

The `generateCodeFrame()` utility can be used directly for custom formatting:

```typescript
import { generateCodeFrame } from '@nielspeter/ts-archunit'

const frame = generateCodeFrame(sourceText, lineNumber, {
  // options
})
```
