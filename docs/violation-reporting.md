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

### When to Use Which

| Scenario                                  | Method                                                         |
| ----------------------------------------- | -------------------------------------------------------------- |
| Hard constraint the team agreed on        | `.check()`                                                     |
| Aspirational rule being gradually adopted | `.warn()`                                                      |
| New rule with many existing violations    | `.warn()` or use [baseline mode](/core-concepts#baseline-mode) |
| Deprecated code tracking                  | `.warn()`                                                      |

## Rule Metadata with `.rule()`

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
import { detectFormat } from 'ts-archunit'

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
import { detectFormat, isCI } from 'ts-archunit'

const format = detectFormat() // auto-detects environment
const ci = isCI() // true in any CI environment
```

## Error Structure

When `.check()` throws, it throws an `ArchRuleError`:

```typescript
import { ArchRuleError } from 'ts-archunit'

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

| Property    | Type     | Description                          |
| ----------- | -------- | ------------------------------------ |
| `message`   | `string` | Human-readable violation description |
| `filePath`  | `string` | Absolute path to the source file     |
| `line`      | `number` | Line number of the violation         |
| `codeFrame` | `string` | Surrounding source code              |

## Programmatic Access

For custom reporting, catch the error and process violations:

```typescript
import {
  ArchRuleError,
  formatViolations,
  formatViolationsPlain,
  formatViolationsJson,
} from 'ts-archunit'

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
import { generateCodeFrame } from 'ts-archunit'

const frame = generateCodeFrame(sourceText, lineNumber, {
  // options
})
```
