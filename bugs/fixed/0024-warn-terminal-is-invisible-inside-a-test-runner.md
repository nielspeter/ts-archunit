# Bug 0024: `.warn()` inside a test reports nothing — vitest drops it

**Reported:** 2026-07-29
**Fixed:** 2026-07-29 (v0.26.0)
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

## How it was fixed

**v0.26.0.** One channel — `writeStderr` in `src/core/stderr.ts` — and every
library-originated message routed through it. Reproduced first, on a real child
`vitest run` with the default reporter: a **passing** test whose rule has 4 real
violations printed **nothing**, zero occurrences of the violation text.

**The scope was wider than this report's five sites: ten calls across five files.**
`executeWarn`'s report and the exclusion warnings were the reported half, but the
same silence covered the exclusion-comment parse warnings, `matchers.ts`'s
`expression()` escape-hatch warning, `presets/shared.ts`, `diff-aware.ts`'s
git-fallback warning and `baseline.ts`'s invalid-file warning. A stale
`.excluding()` in a passing test — the one signal that an exclusion has rotted
after a rename — said nothing at all in the runner where rules are written.

`writeReport` and `doctor`'s seven writes were moved onto the channel too. They
were already on stderr, so they were visible; what they lacked was the EPIPE
guard.

**Both cautions in this report were re-measured and both held.**

- **EPIPE.** Over 20 000 lines to a closed pipe: bare `process.stderr.write`
  exits **1**, an attached `'error'` listener exits **0**, `console.warn` exits
  **0**. A persistent listener rather than `once` — `once` removes itself after
  the first error, leaving a second EPIPE uncaught, and re-adding per write leaks
  listeners. Note this was a **live defect before the fix**: `writeReport`
  already wrote to stderr unguarded, so a piped `check` could fail for EPIPE
  rather than for findings, and the exit code cannot tell them apart.
- **Test attribution.** Accepted and stated, as this report asked. vitest
  annotates intercepted output with the test that produced it; a direct write
  loses that. For a violation report the rule's identity is in the message, and
  being attributed to a test that never printed would be worse.

## The guard, and what it took

`tests/core/warn-survives-the-test-runner.test.ts` spawns a real `vitest run`
with the default reporter and `CI=true`, in both directions this report asked
for: the **passing** test must show the output, and the **failing** test must
still show it — the latter exists because vitest replays intercepted output for
failing tests, so a guard written only that way passes with the defect fully
restored.

Two things had to be measured rather than assumed:

- The probe is generated **inside** `tests/`, not in a temp directory:
  `vitest.config.ts` sets `include: ['tests/**/*.test.ts']`, so a probe in
  `os.tmpdir()` is filtered out and the child exits 1 with "No test files found"
  — which reads exactly like the assertion failing.
- The `writeReport`-specific wiring could not be tested behaviourally at all.
  Bare node cannot import these modules (`.js` specifiers resolving to `.ts`),
  and running the probe under vitest hands stdio to vitest, so the closed pipe
  stops being real. That one is a **source-level tripwire**, labelled as such and
  paired with the behavioural channel test: `process.stderr.write` may appear
  only in `stderr.ts`. `console.error` in `src/cli/` is exempt and the exemption
  is stated — `Console` is EPIPE-safe by construction and a terminal command is
  not inside a test runner.

**5 reverts, all caught** — the channel reverting to `console.warn`, the EPIPE
guard removed, the newline dropped, the newline always added, and `writeReport`
bypassing the channel. The last three were caught by nothing on the first round
and have guards now.

## Fallout, recorded

**57 existing tests spied on `console.warn`**, which is this bug stated as a
number: the whole warn path was covered by assertions that prove the call and
cannot prove the delivery. All were moved to `process.stderr.write`. Six also
asserted `expect(console.warn)` directly and had to be rebound to a named spy —
`expect(process.stderr.write)` passes an unbound method reference, which this
repo's lint config rejects.
