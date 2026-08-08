# Bug 0075: `agentGuardrails`' copy-paste rule ignores `src`, so it scans everything the tsconfig loads

**Reported:** 2026-08-08 · **Fixed:** not yet
**Found in:** the five-persona review of [plan 0089](../plans/completed/0089-presets-forward-their-options.md)
(customer persona, round 1). Pre-existing — 0089 did not introduce it, but 0089's new documentation
teaches users to make a statement about the scope this rule does not use.
**Severity:** **Low today, and it becomes an expiry hazard when
[plan 0099](../plans/0099-the-floor-no-family-can-be-born-below.md) lands.**

## What happens

Every other rule `agentGuardrails` constructs is scoped by `options.src`:

```ts
functions(p, COLLECT_ALL).that().resideInFile(options.src).should()…
```

The copy-paste rule is not — verified in `src/presets/agent-guardrails.ts`:

```ts
smells.duplicateBodies(p).withMinSimilarity(0.9)
```

No `inFolder(options.src)`, no `resideInFile`. So `preset/agent/no-copy-paste` reports duplicates
anywhere the tsconfig loads them: test fixtures, scripts, generated code, `tests/` — files the caller
scoped **out** by writing `src: '**/src/**'`.

A caller reading the preset's own option list has every reason to believe `src` scopes the preset. It
scopes five rules of six.

## Why it is filed now rather than left as a wart

`docs/presets.md`'s worked `expectEmpty` example is:

```ts
agentGuardrails(project, {
  src: '**/src/**',
  noCopyPaste: true,
  // This package has no duplicate-body surface yet — say so, rather than
  // disabling the rule and forgetting.
  expectEmpty: ['preset/agent/no-copy-paste'],
})
```

The comment states a fact **about `src`**, and the rule the declaration names does not read `src`. So
the documented example asserts something narrower than what the rule measures. Once 0099 makes the
declaration expire, it will expire on a duplicate in a test fixture or a build script — code the author
deliberately excluded — and the remedy will name a scope that had no effect.

That interacts with [bug 0073](./0073-a-declaration-binds-to-a-smell-rule-that-ignores-it.md), which is
about the same rule and the same example from the other direction: 0073 is "the declaration does
nothing", this is "and when it does something, it will be measuring the wrong files".

## Fix

Scope it like its five siblings — `smells.duplicateBodies(p).inFolder(options.src)` (or whichever
spelling the smell builder accepts for a glob), so `src` means the same thing for every rule in the
preset. Guard it with a fixture holding a duplicate **outside** `src`: the rule must not report it when
`src` is set, and must report it when `src` widens to include it — a row that reads differently per
value, per this plan's own standard.
