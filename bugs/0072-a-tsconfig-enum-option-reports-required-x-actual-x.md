# Bug 0072: a tsconfig enum option reports "required ES2022, actual ES2022"

**Reported:** 2026-08-08 · **Fixed:** not yet
**Found in:** measuring `TsconfigBuilder`'s examined unit for
[plan 0098](../plans/completed/0098-the-evidence-seam-and-the-floor.md). Incidental — the plan was
verifying that `examined === 0` iff the rule asserts nothing, and one probe case produced a violation
whose two values were printed identically.
**Severity:** **Medium, and it is the message that makes it medium.** The comparison being wrong is
ordinary; a finding that says the required and actual values are the same, with a `Fix:` telling you to
set what is already set, is [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 2 — a remedy that
does not remediate. An agent following it changes nothing, re-runs, and gets the same failure.

## What happens

```ts
tsconfig(project).requires({ target: 'ES2022' }).check()
```

on a project whose tsconfig already sets `"target": "ES2022"`:

```
compiler option "target": required ES2022, actual ES2022
Fix: Set "target": "ES2022" in compilerOptions.
```

Measured on the `tests/fixtures/modules` project:

| call                             | violations | note                                  |
| -------------------------------- | ---------- | ------------------------------------- |
| `requires({ target: 'ES2022' })` | **1**      | message prints both sides as `ES2022` |
| `requires({ target: 9 })`        | 0          | the only spelling that works          |
| `requires({ strict: true })`     | 0          | booleans are unaffected               |

## Why

ts-morph returns the **numeric enum** for enum-valued options — measured: `target` is `9`, `module` is
`7`, while `strict` is a plain `true`. `valuesEqual()` ends at `deepEqual(a, b)`, so `'ES2022' !== 9` and
a violation is produced. `displayValue(key, …)` then renders **both** sides through the enum's name
table, so the message prints `ES2022` twice.

The two halves are individually reasonable — compare raw, display friendly — and their combination is
what produces a self-contradicting sentence. That is the interesting part: neither function is wrong on
its own.

## Why no test catches it

Every case in `tests/config/tsconfig.test.ts` passes the **enum**: `requires({ target: ScriptTarget.ES2022 })`,
`mk({ target: ScriptTarget.ES2020 })`, and so on. The string form — the spelling a user copies out of
their own `tsconfig.json`, and the one the `Fix:` line tells them to write — is never exercised. The
suite and the documentation disagree about what the API takes, and the suite is what runs.

## What a fix has to decide

- **Which spellings are supported.** Accepting the string means normalising expected-vs-actual for every
  enum-valued option (`target`, `module`, `moduleResolution`, `jsx`, `newLine`, …), not just `target`.
  Refusing the string means failing at build time with a message naming the enum — loud, and honest.
  Silently accepting only the enum is the current state and is the worst of the three.
- **Whether `displayValue` may ever render two unequal values identically.** Independent of the fix
  above: if a comparison fails, the message must show a difference, or it is not a finding a reader can
  act on. A cheap guard is to assert `expectedText !== actualText` whenever a violation is emitted.
- Whether the same shape exists for other option families — `lib` (an array of strings) is a candidate,
  and `SET_VALUED_KEYS` suggests someone has already thought about arrays.

## Not measured

- Whether `module`, `moduleResolution`, `jsx` and the other enum options reproduce it. `module` is
  stored as `7`, so almost certainly — but that is inference, not measurement, and the count of affected
  options is what decides how the fix is scoped.
- Whether the docs anywhere show the string form. If they do, the docs are currently teaching a call
  that produces a false failure.
