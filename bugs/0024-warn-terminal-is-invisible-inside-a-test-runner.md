# Bug 0024: `.warn()` inside a test reports nothing — vitest drops it

**Reported:** 2026-07-29
**Found in:** all versions through v0.21.0
**Severity:** High — `.warn()` is the documented way to run an advisory rule in a test
file, and in a passing test it produces **no output at all**. A team adopting the
warn-then-ratchet path documented in `docs/running-in-tests.md` sees nothing, concludes
there is nothing to fix, and the rule silently certifies nothing for as long as it stays
green. ADR-008 rule 1 is about exactly this: a finding nobody reads has not been
reported.

## Description

`executeWarn` and the stale-exclusion / expression warnings write through `console.warn`
(`src/core/execute-rule.ts` — five sites, including `:271` and `:275` for the violation
report itself). Vitest's default reporter **intercepts** console output and replays it
only for **failing** tests. `.warn()` never fails a test, so its output is always
dropped.

The CLI path is unaffected: `writeReport` uses `process.stderr.write`
(`src/core/execute-rule.ts:207`), so `ts-archunit check` prints warnings correctly. The
defect is specific to the in-test terminal.

## Reproduction

A passing vitest test, default reporter (no flags), against `tests/fixtures/poc`:

```
functions(p).that().haveNameMatching(/^parse/).should().notExist().warn()
  4 real violations   ->  NOTHING printed

.excluding('NoSuchThing')  (stale exclusion, matches 0 violations)
  the stale-exclusion warning  ->  NOTHING printed
```

Both appear under `--reporter=verbose`, and both appear if the test fails for any other
reason. Neither appears in the configuration a consumer actually runs.

## Why no test caught it

Every test of the warn path asserts that `console.warn` was **called**, via
`vi.spyOn(console, 'warn')`. A spy proves the call; it cannot prove delivery. Ask
ADR-008's question of those tests — _what would they do if vitest swallowed the channel
entirely?_ — and the answer is: pass, which is the shipped state.

## How it was found

Two reviewers measured it independently while reviewing plan 0070's 0.22.0 branch, which
had proposed emitting a new diagnostic through the same channel. That diagnostic was
withdrawn for this reason (see the plan's Implementation notes); this bug is the
pre-existing half, which was not in that plan's scope.

## Suggested fix

Route every library-originated message through one helper that writes to
`process.stderr` — the channel `writeReport` already uses — rather than `console.warn`.
One place, five call sites.

Two things the fix must handle, both measured:

- **EPIPE.** Node's `Console` is constructed with `ignoreErrors: true` and attaches a
  one-shot `error` listener around each write; a bare `process.stderr.write` does not, so
  `ts-archunit check 2>&1 | head` exits 1 with an uncaught EPIPE. `try/catch` does not
  help (the error is asynchronous) and neither does the write callback. Only
  `process.stderr.once('error', () => {})` does — which is what `Console` does
  internally.
- **Test attribution.** vitest annotates intercepted console output with the test that
  produced it (`stderr | file > test name`); a direct stderr write loses that. For a
  violation report the rule's own identity is in the message, so the loss is acceptable —
  but it is a real trade and belongs in the release note.

## Guard this needs

A spy cannot see this. The guard has to be a child process: spawn a real `vitest run`
(default reporter, non-TTY, `CI=true`) over a fixture with one passing test that calls
`.warn()` on a rule with real violations, and assert the output reaches the captured
stdout/stderr. That test fails today, which is the finding stated as a test.

Sabotage it in both directions: with the channel restored to `console.warn` it must fail;
with the fixture's test made to fail it must still pass (otherwise it is measuring the
failure path, not the channel).

## Relationship to plan 0070

Out of scope for 0070, which is about rules that assert **nothing**; this is about a rule
that asserts something and reports it where nobody looks. They share a cause, and 0070's
0.22.0 is the release that documented the mechanism — so this should not be left for
someone to rediscover from that document.
